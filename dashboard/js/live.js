// Live data loader. Replaces the static fallbacks in data.js with real calendar, weather and
// photos from the Worker's guarded /api/* endpoints, and refreshes them on a schedule.
// The shared dashboard key travels in the URL (?k=...) and is never embedded in the bundle.
(function () {
  'use strict';
  var D = window.DATA;

  var key = '';
  try { key = new URLSearchParams(location.search).get('k') || ''; } catch (e) { key = ''; }
  App.apiKey = key;

  function api(path) {
    var url = '/api/' + path;
    if (key) url += (url.indexOf('?') < 0 ? '?' : '&') + 'k=' + encodeURIComponent(key);
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' HTTP ' + r.status);
      return r.json();
    });
  }

  function matchPeople(title, loc) {
    var text = ((title || '') + ' ' + (loc || '')).toLowerCase();
    var ids = D.people.filter(function (p) {
      return p.name && text.indexOf(p.name.toLowerCase()) >= 0;
    }).map(function (p) { return p.id; });
    return ids.length ? ids : D.ALL.slice();
  }

  function applyCalendar(res) {
    D.events = (res.events || []).map(function (ev) {
      var people = null;
      if (ev.people === '*') people = D.ALL.slice();
      else if (Array.isArray(ev.people) && ev.people.length) {
        people = ev.people.filter(function (id) {
          return D.people.some(function (p) { return p.id === id; });
        });
      }
      return {
        id: ev.id || ('e' + Math.random().toString(36).slice(2)),
        start: new Date(ev.start),
        end: new Date(ev.end),
        title: ev.child ? (ev.title || '').replace(/^\[.*?\]\s*/, '') : (ev.title || '(no title)'),
        allDay: !!ev.allDay,
        loc: ev.loc || '',
        kind: ev.kind || '',
        child: ev.child || '',
        people: (people && people.length) ? people : (ev.child ? [ev.child] : matchPeople(ev.title, ev.loc))
      };
    });
    App.emit('calendar'); // activities module syncs against the fresh events first
    App.emit('data');
  }

  function applyWeather(w) {
    if (w && w.t && w.c && w.p) { D.weather = w; App.emit('data'); }
  }

  function applyPhotos(res) {
    D.photos = (res.photos || []).map(function (p) {
      return {
        url: p.url, o: p.o || 'l', date: p.date || '2026-01-01',
        place: p.place || '', from: p.from || 'ruskin', tag: p.tag || 'r2', fav: !!p.fav
      };
    });
    App.emit('data');
  }

  function applyConfig(c) {
    D.config.control = false; // ha.js shows the control view only once HA answers
    D.config.calendar = !!c.calendar;
    D.config.haConfigured = !!c.ha;
    App.emit('data');
  }

  function loadCalendar() { api('calendar').then(applyCalendar).catch(function () {}); }
  function loadWeather() { api('weather').then(applyWeather).catch(function () {}); }
  function loadPhotos() { api('photos').then(applyPhotos).catch(function () {}); }

  // Immich on the LAN is plain HTTP (the kiosk WebView allows mixed content); only use the
  // configured scheme if the host already includes one.
  function immichBase(c) {
    return (c.host.indexOf('http') === 0 ? c.host : 'http://' + c.host).replace(/\/$/, '');
  }

  // The family Immich server (LAN-only) — the frame fetches it directly; the guarded
  // /api/immich/config hands it host + key, exactly like /api/ha/config.
  // Photo priority: today's Memories (on this day, across the years). Fallback: a few of the
  // most recently updated albums, mixed. Immich v2 API: /api/memories, POST /api/search/metadata.
  // Image tags can't carry the x-api-key header, so <img> URLs carry ?apiKey= instead
  // (accepted by Immich); fetches keep the header.
  function immichMap(c, items, tag) {
    var kq = '?apiKey=' + encodeURIComponent(c.key);
    return items.filter(function (x) { return x.type === 'IMAGE'; }).map(function (x) {
      var when = (x.fileCreatedAt || x.localDateTime || '').slice(0, 10) || '2026-01-01';
      var w = x.width, h = x.height;
      return {
        id: x.id,
        url: immichBase(c) + '/api/assets/' + x.id + '/thumbnail' + kq,
        full: immichBase(c) + '/api/assets/' + x.id + '/original' + kq,
        o: (w != null && h != null && w < h) ? 'p' : 'l',
        date: when, from: 'ruskin', tag: tag, fav: !!x.isFavorite
      };
    });
  }

  function setPhotos(c, photos) {
    if (!photos.length) return;
    photos.sort(function (a, b) { return b.date < a.date ? -1 : b.date > a.date ? 1 : 0; });
    D.photos = photos;
    App.emit('data');
  }

  function loadImmich() {
    api('immich/config').then(function (c) {
      if (!c || !c.configured) return;
      var headers = { 'x-api-key': c.key };
      // POST bodies never reach the kiosk's request interceptor, so the search goes as a GET
      // carrying ?postBody= — the kiosk converts it to a real POST upstream.
      var search = function (body) {
        return fetch(immichBase(c) + '/api/search/metadata?postBody=' + encodeURIComponent(JSON.stringify(body)), {
          headers: { 'x-api-key': c.key }
        }).then(function (r) { return r.ok ? r.json() : null; });
      };
      // Memories shown today come first; the rest of the memories pool fills it out.
      return fetch(immichBase(c) + '/api/memories', { headers: headers })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (mems) {
          var now = new Date().toISOString();
          var today = [], older = [];
          (mems || []).forEach(function (m) {
            var active = m.showAt && m.hideAt && m.showAt <= now && now <= m.hideAt;
            (active ? today : older).push(m);
          });
          if (!today.length && !older.length) {
            // No memories at all — fall back to a few recently updated albums, mixed.
            return fetch(immichBase(c) + '/api/albums', { headers: headers })
              .then(function (r) { return r.ok ? r.json() : []; })
              .then(function (albums) {
                var recent = (albums || []).slice().sort(function (a, b) {
                  return (b.updatedAt || '').localeCompare(a.updatedAt || '');
                }).slice(0, 3);
                return Promise.all(recent.map(function (al) {
                  return search({ albumIds: [al.id], type: 'IMAGE', visibility: 'timeline', page: 1, size: 500 })
                    .then(function (d) { return (d && d.assets && d.assets.items) || []; });
                })).then(function (groups) {
                  var items = [];
                  groups.forEach(function (g) { items = items.concat(g); });
                  setPhotos(c, immichMap(c, items, 'immich'));
                });
              });
          }
          var items = [];
          today.concat(older).forEach(function (m) { items = items.concat(m.assets || []); });
          setPhotos(c, immichMap(c, items, 'memory'));
          return null;
        });
    }).catch(function () {});
  }

  // Todos: the family Todoist project (the same one the e-paper dashboard shows).
  function loadTodos() {
    api('todos').then(function (res) {
      D.todos = res.todos || [];
      App.emit('data');
    }).catch(function () {});
  }

  function loadConfig() { api('config').then(applyConfig).catch(function () {}); }

  function todoAction(action, id) {
    var url = '/api/todos/' + action + '?id=' + encodeURIComponent(id);
    if (key) url += '&k=' + encodeURIComponent(key);
    return fetch(url, { method: 'POST' }).then(function (r) { return r.ok; });
  }
  App.todoDone = function (id) { return todoAction('close', id); };
  App.todoUndo = function (id) { return todoAction('reopen', id); };

  App.on('ready', function () {
    loadConfig();
    loadCalendar();
    loadWeather();
    loadPhotos();
    loadImmich();
    loadTodos();
    setInterval(loadCalendar, 10 * 60 * 1000);
    setInterval(loadWeather, 15 * 60 * 1000);
    setInterval(loadConfig, 60 * 60 * 1000);
    setInterval(loadImmich, 5 * 60 * 1000);
    setInterval(loadTodos, 2 * 60 * 1000);
  });
})();