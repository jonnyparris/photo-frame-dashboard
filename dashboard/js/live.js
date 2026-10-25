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
        people: (people && people.length) ? people : matchPeople(ev.title, ev.loc)
      };
    });
    App.emit('data');
  }

  function applyWeather(w) {
    if (w && w.t && w.c && w.p) { D.weather = w; App.emit('data'); }
  }

  function applyPhotos(res) {
    D.photos = (res.photos || []).map(function (p) {
      return { url: p.url, o: 'l', date: '2026-01-01', place: '', from: 'ruskin', tag: 'r2' };
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
  function loadConfig() { api('config').then(applyConfig).catch(function () {}); }

  App.on('ready', function () {
    loadConfig();
    loadCalendar();
    loadWeather();
    loadPhotos();
    setInterval(loadCalendar, 10 * 60 * 1000);
    setInterval(loadWeather, 15 * 60 * 1000);
    setInterval(loadConfig, 60 * 60 * 1000);
  });
})();