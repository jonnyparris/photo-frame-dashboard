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

  // The family Immich server (LAN-only) — the frame fetches it directly; the guarded
  // /api/immich/config hands it host + album + key, exactly like /api/ha/config.
  // The owner shares photos to that album from the phone app; the frame shows them automatically.
  // Immich v2 API: POST /api/search/metadata lists album assets; /api/assets/{id}/thumbnail serves bytes.
  function immichPage(c, page) {
    return fetch('https://' + c.host + '/api/search/metadata', {
      method: 'POST',
      headers: { 'x-api-key': c.key, 'content-type': 'application/json' },
      body: JSON.stringify({ albumIds: [c.album], type: 'IMAGE', visibility: 'timeline', page: page, size: 1000 })
    }).then(function (r) { return r.ok ? r.json() : null; });
  }

  function loadImmich() {
    api('immich/config').then(function (c) {
      if (!c || !c.configured) return;
      var photos = [];
      function take(page) {
        return immichPage(c, page).then(function (d) {
          if (!d) return;
          var a = d.assets || {};
          (a.items || []).forEach(function (x) {
            var when = (x.fileCreatedAt || x.localDateTime || '').slice(0, 10) || '2026-01-01';
            var w = x.width, h = x.height;
            photos.push({
              id: x.id,
              url: 'https://' + c.host + '/api/assets/' + x.id + '/thumbnail',
              full: 'https://' + c.host + '/api/assets/' + x.id + '/original',
              o: (w != null && h != null && w < h) ? 'p' : 'l',
              date: when, from: 'ruskin', tag: 'immich', fav: !!x.isFavorite
            });
          });
          return a.nextPage != null ? take(a.nextPage) : null;
        });
      }
      return take(1).then(function () {
        if (!photos.length) return;
        photos.sort(function (a, b) { return b.date < a.date ? -1 : b.date > a.date ? 1 : 0; });
        D.photos = photos;
        App.emit('data');
      });
    }).catch(function () {});
  }

  function loadConfig() { api('config').then(applyConfig).catch(function () {}); }

  App.on('ready', function () {
    loadConfig();
    loadCalendar();
    loadWeather();
    loadPhotos();
    loadImmich();
    setInterval(loadCalendar, 10 * 60 * 1000);
    setInterval(loadWeather, 15 * 60 * 1000);
    setInterval(loadConfig, 60 * 60 * 1000);
    setInterval(loadImmich, 5 * 60 * 1000);
  });
})();