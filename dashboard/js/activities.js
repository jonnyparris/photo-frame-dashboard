// Weekly recurring kid activities: PE, Music & Art, Messy Play. The family calendar carries
// school events, but the weekly activities aren't on it — they're a fixed rhythm. This module
// generates them as all-day per-kid events in a -30/+90 window matching the calendar, skips
// any day the calendar already has the same activity for the same kid, and re-syncs whenever
// the calendar refreshes so busy days never double up.
(function () {
  'use strict';
  var D = window.DATA;

  // Per kid: weekday (1=Mon .. 7=Sun) → activity.
  var WEEK = {
    xavi: { 2: 'Music & Art', 3: 'PE', 5: 'PE' },
    blaise: { 2: 'PE', 3: 'Messy Play', 5: 'PE' }
  };

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function key(title, day, kid) {
    return norm(title) + '@' + App.dayStart(day).toISOString().slice(0, 10) + '@' + kid;
  }

  function build(from, to, have) {
    var out = [];
    for (var d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      var dow = d.getDay(), wd = dow === 0 ? 7 : dow, day = App.dayStart(d);
      for (var kid in WEEK) {
        var name = WEEK[kid][wd];
        if (!name || have[key(name, day, kid)]) continue;
        out.push({
          id: 'act-' + kid + '-' + day.toISOString().slice(0, 10),
          start: day, end: App.addDays(day, 1),
          title: name, allDay: true, loc: '',
          kind: 'activity', child: kid, people: [kid]
        });
      }
    }
    return out;
  }

  function sync() {
    var today = App.dayStart(App.now());
    D.events = D.events.filter(function (e) { return e.id.indexOf('act-') !== 0; });
    var have = {};
    D.events.forEach(function (e) {
      var kid = e.child || (e.people.length === 1 ? e.people[0] : '');
      if (kid) have[key(e.title, e.start, kid)] = true;
    });
    D.events = D.events.concat(build(App.addDays(today, -30), App.addDays(today, 90), have));
    App.emit('data');
  }

  App.on('calendar', sync);
  // Offline (calendar fetch failed): activities still show until the next 'data' repaint.
  App.on('ready', function () {
    if (!D.events.some(function (e) { return e.id.indexOf('act-') === 0; })) sync();
  });
  App.on('data', function () {
    if (!D.events.some(function (e) { return e.id.indexOf('act-') === 0; })) sync();
  });
})();
