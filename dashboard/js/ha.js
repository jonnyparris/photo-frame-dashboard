// Home Assistant integration (LAN-only). The frame is served over HTTPS but talks to HA over
// plain HTTP on the home network (kiosk allows mixed content). The URL + long-lived token come
// from the Worker's guarded /api/ha/config — never shipped in the bundle. The page origin is
// https://home-dashboard.jonnyparris.workers.dev, so HA needs CORS configured (see README):
//   http:
//     cors_allowed_origins:
//       - https://home-dashboard.jonnyparris.workers.dev
(function () {
  'use strict';
  var D = window.DATA;
  var cfg = { url: '', token: '' };

  var inFlight = 0, resyncTimer = null, failCount = 0;
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function withTimeout(p, ms, label) {
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error((label || 'HA call') + ' timed out')); }, ms);
    })]);
  }

  App.ha = {
    ready: false,
    call: function (domain, service, data) {
      if (!cfg.url) return Promise.reject(new Error('HA not configured'));
      var body = JSON.stringify(data || {});
      var url = cfg.url + '/api/services/' + domain + '/' + service;
      function once() {
        return withTimeout(fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + cfg.token },
          body: body,
          keepalive: true
        }).then(function (r) { if (!r.ok) throw new Error(domain + '.' + service + ' HTTP ' + r.status); return r.json(); }),
          8000, domain + '.' + service);
      }
      // Transient Wi-Fi / HA hiccups get two quick retries, so one tap feels reliable.
      function attempt(n) {
        return once().catch(function (e) {
          if (n < 2) return wait(600 * (n + 1)).then(function () { return attempt(n + 1); });
          throw e;
        });
      }
      inFlight++;
      return attempt(0).then(function (res) {
        inFlight--;
        scheduleResync();
        return res;
      }, function (e) {
        inFlight--;
        throw e;
      });
    },
    states: function () {
      if (!cfg.url) return Promise.reject(new Error('HA not configured'));
      return withTimeout(fetch(cfg.url + '/api/states', {
        headers: { 'authorization': 'Bearer ' + cfg.token },
        cache: 'no-store'
      }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('states HTTP ' + r.status)); }),
        6000, 'states');
    }
  };

  function first(states, domain) {
    var list = states.filter(function (s) { return s.entity_id.indexOf(domain + '.') === 0; });
    return list.length ? list[0] : null;
  }
  function attr(s, name, dflt) { return (s && s.attributes && s.attributes[name] != null) ? s.attributes[name] : dflt; }

  // ------------------------------------------------------------ map entities to the app model
  function buildDevices(states) {
    // A device's room: HA area when assigned, else a known room prefix, else Home.
    var ROOM_RE = /^(living room|kitchen|annex|bedroom|hallway|hall\b|office|studio|dining room|dining|bathroom|nursery|roaming room|playroom|garage|loft|conservatory|utility)\b/i;
    function roomFor(s) {
      var a = attr(s, 'area_id', '');
      if (a) return a;
      var n = attr(s, 'friendly_name', '') || '';
      var m = n.match(ROOM_RE);
      return m ? m[1] : 'Home';
    }
    var devices = [];
    function add(d, st) { d.room = roomFor(st); d.entity = d.id; d.domain = d.id.split('.')[0]; devices.push(d); }
    states.forEach(function (s) {
      var name = attr(s, 'friendly_name', s.entity_id);
      if (s.entity_id.indexOf('light.') === 0) {
        var on = s.state === 'on';
        add({ id: s.entity_id, type: 'light', name: name, on: on, level: on ? Math.round((attr(s, 'brightness', 255) || 255) / 255 * 100) : 0 }, s);
      } else if (s.entity_id.indexOf('lock.') === 0) {
        add({ id: s.entity_id, type: 'lock', name: name, locked: s.state === 'locked' }, s);
      } else if (s.entity_id.indexOf('cover.') === 0) {
        var dc = attr(s, 'device_class', '');
        var pos = attr(s, 'current_position', attr(s, 'current_tilt_position', 0));
        if (dc === 'garage' || /garage|door/i.test(name) && dc !== 'blind') {
          add({ id: s.entity_id, type: 'garage', name: name, state: s.state === 'open' ? 'open' : 'closed' }, s);
        } else {
          add({ id: s.entity_id, type: 'blind', name: name, pos: pos }, s);
        }
      } else if (s.entity_id.indexOf('switch.') === 0 && /lamp|light|socket|bulb/i.test(name)) {
        // Lamp-like switches (e.g. "Annex desks lamp Socket 1") behave as lights.
        add({ id: s.entity_id, type: 'light', name: name, on: s.state === 'on', level: s.state === 'on' ? 100 : 0 }, s);
      }
    });
    var seen = {}, rooms = [];
    devices.forEach(function (d) { if (!seen[d.room]) { seen[d.room] = true; rooms.push(d.room); } });
    var roomIds = {};
    rooms.forEach(function (r, i) { roomIds[r] = 'r' + i; });
    devices.forEach(function (d) { d.room = roomIds[d.room]; });
    return { rooms: rooms.map(function (r, i) { return { id: 'r' + i, name: r }; }), devices: devices };
  }

  function buildClimate(states) {
    var s = first(states, 'climate');
    if (!s) return null;
    return {
      current: Math.round(attr(s, 'current_temperature', 0) * 10) / 10,
      set: Math.round(attr(s, 'temperature', 0) * 10) / 10,
      mode: s.state || 'off',
      humidity: Math.round(attr(s, 'current_humidity', 0)),
      outside: 0,
      entity: s.entity_id
    };
  }

  function buildMedia(states) {
    var s = first(states, 'media_player');
    if (!s) return null;
    return {
      room: attr(s, 'friendly_name', 'Media'),
      title: attr(s, 'media_title', attr(s, 'media_artist', '')),
      artist: attr(s, 'media_artist', ''),
      playing: s.state === 'playing',
      volume: Math.round((attr(s, 'volume_level', 0) || 0) * 100),
      seed: 'ha-media', entity: s.entity_id
    };
  }

  function buildCameras(states) {
    return states.filter(function (s) { return s.entity_id.indexOf('camera.') === 0; }).map(function (s) {
      var pic = s.attributes && s.attributes.entity_picture || '';
      if (pic && pic.indexOf('http') !== 0) pic = cfg.url + pic;
      return { id: s.entity_id, name: attr(s, 'friendly_name', s.entity_id), pic: pic };
    });
  }

  function buildScenes(states) {
    return states.filter(function (s) { return s.entity_id.indexOf('scene.') === 0; }).map(function (s, i) {
      return { id: 'h' + i, name: attr(s, 'friendly_name', s.entity_id).replace(/ scene$/i, ''), icon: 'bolt', entity: s.entity_id };
    });
  }

  // ------------------------------------------------------------ real service calls
  function patchActions() {
    var real = App.setDevice;
    App.setDevice = function (id, patch, opts) {
      var d = D.devices.filter(function (x) { return x.id === id; })[0];
      if (!d || !d.entity) return real(id, patch, opts);
      var before = Object.keys(patch).reduce(function (o, k) { o[k] = d[k]; return o; }, {});
      Object.keys(patch).forEach(function (k) { d[k] = patch[k]; });
      App.emit('data');
      var call;
      if (d.type === 'light') {
        var dom = d.domain || 'light';
        var ldata = { entity_id: id };
        if (dom === 'light') ldata.brightness_pct = patch.on ? patch.level : 100;
        call = App.ha.call(dom, patch.on ? 'turn_on' : 'turn_off', ldata);
      } else if (d.type === 'blind') call = App.ha.call('cover', patch.pos === 0 ? 'close_cover' : patch.pos >= 100 ? 'open_cover' : 'set_cover_position', { entity_id: id, position: patch.pos });
      else if (d.type === 'lock') call = App.ha.call('lock', patch.locked ? 'lock' : 'unlock', { entity_id: id });
      else if (d.type === 'garage') call = App.ha.call('cover', patch.state === 'open' ? 'open_cover' : 'close_cover', { entity_id: id });
      if (call) call.catch(function () {
        Object.keys(before).forEach(function (k) { d[k] = before[k]; });
        App.emit('data');
        App.toast('Couldn’t reach <b>' + d.name + '</b> · it may be offline', { tone: 'error', icon: 'bolt' });
      });
    };

    App.onScene = function (id) {
      var s = D.scenes.filter(function (x) { return x.id === id; })[0];
      if (s && s.entity) App.ha.call('scene', 'turn_on', { entity_id: s.entity }).catch(function () {
        App.toast('Scene <b>' + s.name + '</b> failed', { tone: 'error', icon: 'bolt' });
      });
    };
    App.onClimate = function (patch) {
      var c = D.climate;
      if (!c || !c.entity) return;
      if (patch.set != null) App.ha.call('climate', 'set_temperature', { entity_id: c.entity, temperature: patch.set }).catch(function () {});
      if (patch.mode != null) App.ha.call('climate', 'set_hvac_mode', { entity_id: c.entity, hvac_mode: patch.mode }).catch(function () {});
    };
    App.onMedia = function (playing) {
      if (D.media && D.media.entity) App.ha.call('media_player', 'media_play_pause', { entity_id: D.media.entity }).catch(function () {});
    };
    App.onGarage = function (state) {
      var g = D.devices.filter(function (d) { return d.type === 'garage'; })[0];
      if (g) App.ha.call('cover', state === 'open' ? 'open_cover' : 'close_cover', { entity_id: g.id }).catch(function () {});
    };
  }

  function applyStates(states) {
    if (!states || !states.length) return;
    var roomsDevs = buildDevices(states);
    D.rooms = roomsDevs.rooms;
    D.devices = roomsDevs.devices;
    D.climate = buildClimate(states); // null when the thermostat isn't in HA
    D.media = buildMedia(states) || D.media;
    D.cameras = buildCameras(states);
    D.scenes = buildScenes(states);
    D.config.control = true;
    App.setSectionVisible('control', true);
    patchActions();
    App.emit('data');
    App.ha.ready = true;
  }

  // Re-pull HA state just after a successful service call, so the UI reflects reality now
  // instead of after the next minute-interval poll (which can still show the pre-change state).
  function scheduleResync() {
    if (resyncTimer || inFlight) return;
    resyncTimer = setTimeout(function () {
      resyncTimer = null;
      App.ha.states().then(applyStates).catch(function () {});
    }, 1200);
  }

  // ------------------------------------------------------------ load + refresh
  function load() {
    // Skip the poll while a service call is in flight — rebuilding devices would clobber
    // the optimistic patch with (possibly stale) state; the post-call resync reconciles.
    if (inFlight) return;
    return apiConfig().then(function () { return App.ha.states(); }).then(function (states) {
      applyStates(states);
      failCount = 0;
    }).catch(function (e) {
      // A single missed poll is a blip (Wi-Fi, HA busy). Only drop the control section
      // after repeated failures, so controls don't flicker away on every network hiccup.
      failCount++;
      console.warn('HA unavailable:', e.message);
      if (failCount >= 2) {
        D.config.control = false;
        App.setSectionVisible('control', false);
      }
    });
  }

  function apiConfig() {
    var key = App.apiKey || '';
    var url = '/api/ha/config' + (key ? '?k=' + encodeURIComponent(key) : '');
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('config HTTP ' + r.status)); })
      .then(function (j) { cfg.url = j.url; cfg.token = j.token; });
  }

  App.on('ready', function () {
    load();
    setInterval(load, 60 * 1000);
  });
})();