// Core shell: router, demo clock, idle/ambient, toasts, sheets, helpers.
(function () {
  'use strict';
  var D = window.DATA;
  var App = window.App = { state: D, views: {}, current: null, mode: 'day', calMode: 'normal' };
  var $ = App.$ = function (s, r) { return (r || document).querySelector(s); };
  App.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ------------------------------------------------------------ events
  var handlers = {};
  App.on = function (e, fn) { (handlers[e] = handlers[e] || []).push(fn); };
  App.emit = function (e, a) { (handlers[e] || []).forEach(function (fn) { fn(a); }); };

  // ------------------------------------------------------------ time (demo clock)
  var offset = 0;
  App.now = function () { return new Date(Date.now() + offset); };
  App.setTime = function (h, m) {
    if (h == null) offset = 0;
    else { var d = new Date(); d.setHours(h, m, 0, 0); offset = d - Date.now(); }
    lastMin = -1;
    App.emit('time');
    App.rerender();
  };
  App.dayStart = function (d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  App.addDays = function (d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; };
  App.sameDay = function (a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
  App.isNight = function () { var h = App.now().getHours(); return h >= 22 || h < 6; };

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  App.fmt = {
    time: function (d, ampm) {
      var h = d.getHours(), m = d.getMinutes();
      var s = (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m;
      return ampm === false ? s : s + ' ' + (h >= 12 ? 'PM' : 'AM');
    },
    // "4 PM", "3:45 PM"
    hour: function (d) {
      var h = d.getHours(), m = d.getMinutes();
      return (h % 12 || 12) + (m ? ':' + (m < 10 ? '0' : '') + m : '') + ' ' + (h >= 12 ? 'PM' : 'AM');
    },
    ampm: function (d) { return d.getHours() >= 12 ? 'PM' : 'AM'; },
    range: function (a, b) {
      var same = App.fmt.ampm(a) === App.fmt.ampm(b);
      return (same ? App.fmt.time(a, false) : App.fmt.time(a)) + ' – ' + App.fmt.time(b);
    },
    day: function (d) { return DAYS[d.getDay()]; },
    dayShort: function (d) { return DAYS[d.getDay()].slice(0, 3); },
    month: function (d) { return MONTHS[d.getMonth()]; },
    monthShort: function (d) { return MON_SHORT[d.getMonth()]; },
    mins: function (m) {
      m = Math.max(0, Math.round(m));
      if (m < 60) return m + ' min';
      var h = Math.floor(m / 60), r = m % 60;
      return h + ' hr' + (r ? ' ' + r + ' min' : '');
    },
    rel: function (d) {
      var t = App.dayStart(App.now()), x = App.dayStart(d), diff = Math.round((x - t) / 864e5);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff === -1) return 'Yesterday';
      return DAYS[d.getDay()];
    }
  };
  App.esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  // ------------------------------------------------------------ icons + people
  App.icon = function (name, size, cls) {
    size = size || 24;
    return '<svg class="i ' + (cls || '') + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (window.ICONS[name] || '') + '</svg>';
  };
  App.person = function (id) {
    if (id === 'family' || id === 'any') return D.family;
    for (var i = 0; i < D.people.length; i++) if (D.people[i].id === id) return D.people[i];
    return D.family;
  };
  App.pstyle = function (p) {
    if (typeof p === 'string') p = App.person(p);
    return '--c:' + p.color + ';--c-rgb:' + p.rgb + ';--c-ink:' + p.ink;
  };
  App.avatar = function (p, size, cls) {
    if (typeof p === 'string') p = App.person(p);
    size = size || 48;
    return '<span class="avatar ' + (cls || '') + '" style="' + App.pstyle(p) + ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.46) + 'px">' + (p.id === 'family' ? '★' : p.name[0]) + '</span>';
  };
  App.dots = function (ids, size) {
    return '<span class="dots">' + ids.map(function (id) { return '<i style="' + App.pstyle(id) + (size ? ';width:' + size + 'px;height:' + size + 'px' : '') + '"></i>'; }).join('') + '</span>';
  };

  // ------------------------------------------------------------ calendar helpers
  App.events = function () {
    var list = D.events.slice();
    var today = App.dayStart(App.now());
    if (App.calMode === 'busy') list = list.concat(D.busyExtras);
    if (App.calMode === 'empty') list = list.filter(function (e) { return e.allDay || !App.sameDay(e.start, today); });
    return list;
  };
  App.isFamily = function (e) { return e.people.length >= D.people.length; };
  App.isHoliday = function (e) { return e.kind === 'holiday'; };
  App.evColor = function (e) {
    if (App.isHoliday(e)) return D.holiday;
    if (e.kind === 'school' && e.child) return App.person(e.child);
    return App.isFamily(e) ? D.family : App.person(e.people[0]);
  };
  App.timedOn = function (day, pid) {
    var s = App.dayStart(day), e = App.addDays(s, 1);
    return App.events().filter(function (ev) {
      return !ev.allDay && ev.start < e && ev.end > s && (!pid || ev.people.indexOf(pid) > -1);
    }).sort(function (a, b) { return a.start - b.start || b.end - a.end; });
  };
  App.allDayOn = function (day, pid) {
    var s = App.dayStart(day), e = App.addDays(s, 1);
    return App.events().filter(function (ev) {
      return ev.allDay && ev.start < e && ev.end > s && (!pid || ev.people.indexOf(pid) > -1);
    });
  };
  App.leaveBy = function (e) { return e.travel ? new Date(+e.start - e.travel * 60000) : e.start; };
  // The next thing someone needs to act on: earliest upcoming "leave by" today.
  App.nextEvent = function () {
    var now = App.now();
    var list = App.timedOn(now).filter(function (e) { return e.start > now; });
    list.sort(function (a, b) { return App.leaveBy(a) - App.leaveBy(b); });
    return list[0] || null;
  };
  App.findEvent = function (id) {
    return App.events().filter(function (e) { return e.id === id; })[0];
  };

  // ------------------------------------------------------------ chores + weather helpers
  App.currentRoutine = function () {
    var h = App.now().getHours();
    for (var i = 0; i < D.routines.length; i++) if (h >= D.routines[i].from && h < D.routines[i].to) return D.routines[i];
    return D.routines[2];
  };
  App.weatherNow = function () {
    var W = D.weather, h = App.now().getHours();
    var rainAt = -1;
    for (var i = h; i < 24; i++) if (W.p[i] >= 50) { rainAt = i; break; }
    var summary, advice;
    if (rainAt === h) {
      var stop = h; while (stop < 24 && W.p[stop] >= 50) stop++;
      summary = 'Rain until ' + App.fmt.hour(new Date(2000, 0, 1, stop));
      advice = 'Umbrella weather';
    } else if (rainAt > -1) {
      summary = 'Rain from ' + App.fmt.hour(new Date(2000, 0, 1, rainAt));
      var soccer = App.timedOn(App.now()).filter(function (e) { return /soccer/i.test(e.title) && e.start > App.now(); })[0];
      advice = soccer ? 'Pack a rain jacket for soccer' : 'Grab a rain jacket';
    } else {
      summary = W.t[h] < 12 ? 'Clear and cool' : 'Dry all day';
      advice = W.t[h] < 12 ? 'Jacket weather' : 'Light layers';
    }
    var labels = { sun: 'Sunny', moon: 'Clear', partly: 'Partly cloudy', cloud: 'Overcast', rain: 'Rain' };
    return { temp: W.t[h], cond: W.c[h], label: labels[W.c[h]], hi: W.hi, lo: W.lo, summary: summary, advice: advice, hour: h };
  };
  App.hourly = function (count) {
    var W = D.weather, h = App.now().getHours(), out = [];
    for (var i = 0; i < count; i++) {
      var x = (h + i) % 24;
      out.push({ h: x, t: W.t[x], c: W.c[x], p: W.p[x], label: i === 0 ? 'Now' : ((x % 12 || 12) + (x >= 12 ? 'p' : 'a')) });
    }
    return out;
  };

  // People with a calendar column (pets are on the home lanes but not in the calendar).
  App.calPeople = function () { return D.people.filter(function (p) { return p.cal !== false; }); };

  App.wxSheet = function () {
    var W = D.weather;
    if (!W || !W.days) return;
    var mk = function (s) { var a = s.split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); };
    var days = W.days.slice(0, 5);
    var warmest = days.slice().sort(function (a, b) { return b.hi - a.hi; })[0];
    var wettest = days.slice().sort(function (a, b) { return b.rain - a.rain; })[0];
    var say = 'Warmest ' + App.fmt.rel(mk(warmest.date)).toLowerCase() + ' (' + warmest.hi + '°)';
    if (wettest.rain >= 40) say += ' · rain most likely ' + App.fmt.rel(mk(wettest.date)).toLowerCase() + ' (' + wettest.rain + '%)';
    var rows = days.map(function (d) {
      return '<button class="wx-row" style="' + App.pstyle('ruskin') + '">' +
        '<span class="wx-i">' + App.icon(d.cond === 'clear' ? 'sun' : d.cond === 'snow' ? 'cloud' : d.cond, 30) + '</span>' +
        '<b>' + App.fmt.rel(mk(d.date)) + '</b><span class="num">' + d.hi + '° / ' + d.lo + '°</span>' +
        '<span class="num' + (d.rain >= 40 ? ' is-wet' : '') + '">' + d.rain + '%</span></button>';
    }).join('');
    App.sheet('<div class="label">' + say + '</div><div class="wx-days">' + rows + '</div>');
  };

  var QUOTES = [
    { t: 'Family is not an important thing. It\u2019s everything.', by: 'Michael J. Fox' },
    { t: 'A happy family is but an earlier heaven.', by: 'George Bernard Shaw' },
    { t: 'Other things may change us, but we start and end with the family.', by: 'Anthony Brandt' },
    { t: 'Being deeply loved by someone gives you strength, while loving someone deeply gives you courage.', by: 'Lao Tzu' },
    { t: 'You don\u2019t choose your family. They are God\u2019s gift to you, as you are to them.', by: 'Desmond Tutu' },
    { t: 'Home is where one starts from.', by: 'T.S. Eliot' },
    { t: 'Alone we can do so little; together we can do so much.', by: 'Helen Keller' },
    { t: 'Success is liking yourself, liking what you do, and liking how you do it.', by: 'Maya Angelou' },
    { t: 'Wisdom begins in wonder.', by: 'Socrates' },
    { t: 'The secret of getting ahead is getting started.', by: 'Mark Twain' },
    { t: 'Well done is better than well said.', by: 'Benjamin Franklin' },
    { t: 'Simplicity is the ultimate sophistication.', by: 'Leonardo da Vinci' },
    { t: 'Life is short, and it is up to you to make it sweet.', by: 'Sarah Louise Delany' },
    { t: 'The days are long, but the years are short.', by: 'Gretchen Rubin' },
    { t: 'Don\u2019t judge each day by the harvest you reap but by the seeds that you plant.', by: 'Robert Louis Stevenson' },
    { t: 'Whether you think you can or you think you can\u2019t, you\u2019re right.', by: 'Henry Ford' },
    { t: 'Strive not to be a success, but rather to be of value.', by: 'Albert Einstein' },
    { t: 'It does not matter how slowly you go as long as you do not stop.', by: 'Confucius' },
    { t: 'Fall seven times, stand up eight.', by: 'Japanese proverb' },
    { t: 'Talk doesn\u2019t cook rice.', by: 'Chinese proverb' },
    { t: 'Do what you can, with what you have, where you are.', by: 'Theodore Roosevelt' },
    { t: 'The best way to predict the future is to create it.', by: 'Peter Drucker' },
    { t: 'In family life, love is the oil that eases friction, the cement that binds closer together.', by: 'Friedrich Nietzsche' },
    { t: 'A family in harmony will flourish in everything.', by: 'Chinese proverb' },
    { t: 'The most important thing a father can do for his children is to love their mother.', by: 'Theodore Hesburgh' },
    { t: 'Beware of little expenses; a small leak will sink a great ship.', by: 'Benjamin Franklin' },
    { t: 'The gem cannot be polished without friction, nor man perfected without trials.', by: 'Confucius' },
    { t: 'Everything you\u2019ve ever wanted is on the other side of fear.', by: 'George Addair' },
    { t: 'Home is the nicest word there is.', by: 'Laura Ingalls Wilder' },
    { t: 'He who has a why to live can bear almost any how.', by: 'Friedrich Nietzsche' },
    { t: 'Children are the living messages we send to a time we will not see.', by: 'Neil Postman' },
    { t: 'An investment in knowledge pays the best interest.', by: 'Benjamin Franklin' },
    { t: 'In every conceivable manner, the family is a link to our past, bridge to our future.', by: 'Alex Haley' },
    { t: 'A man travels the world over in search of what he needs and returns home to find it.', by: 'George Moore' },
    { t: 'Home is not where you live but where they understand you.', by: 'Christian Morgenstern' },
    { t: 'Well begun is half done.', by: 'Aristotle' },
    { t: 'To the world you may be one person, but to one person you may be the world.', by: 'Dr. Seuss' },
    { t: 'Success is not final, failure is not fatal: it is the courage to continue that counts.', by: 'Winston Churchill' },
    { t: 'Gratitude turns what we have into enough.', by: 'Aesop' },
    { t: 'The two most important days in your life are the day you are born and the day you find out why.', by: 'Mark Twain' }
  ];
  App.quote = function () {
    var day = App.dayStart(App.now()), start = new Date(2026, 0, 1);
    var n = Math.round((day - start) / 864e5);
    var q = QUOTES[((n % QUOTES.length) + QUOTES.length) % QUOTES.length];
    return '<div class="label">Quote of the day</div><div class="serif">' + App.esc(q.t) + '</div><div class="label">\u2014 ' + App.esc(q.by) + '</div>';
  };

  // ------------------------------------------------------------ router
  App.register = function (name, view) { App.views[name] = view; };
  // Views are built once and kept laid out (hidden with content-visibility), so switching tabs
  // only has to paint. A view is rebuilt when its data changed ('data'/'time' events) or, for
  // time-sensitive views (minutely: true), when the minute has rolled over since it was built.
  function minuteKey() { return Math.floor(App.now().getTime() / 60000); }
  function build(name, opts) {
    var view = App.views[name];
    view.show($('#view-' + name), opts || {});
    view._built = true; view._dirty = false; view._min = minuteKey();
  }
  App.go = function (name, opts) {
    opts = opts || {};
    if (!App.views[name]) name = 'home';
    if (App.current && App.current !== name && App.views[App.current].hide) App.views[App.current].hide();
    App.$$('.view').forEach(function (v) { v.classList.toggle('is-active', v.dataset.view === name); });
    App.$$('.rail-item').forEach(function (b) { b.classList.toggle('is-active', b.dataset.go === name); });
    App.current = name;
    var view = App.views[name];
    if (!view._built || view._dirty || opts.rerender || (view.minutely && view._min !== minuteKey())) build(name, opts);
    else if (view.resume) view.resume($('#view-' + name));
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  };
  // Build a hidden view and lay it out now (cached by content-visibility; no paint happens).
  function prebuild(name) {
    var el = $('#view-' + name), view = App.views[name];
    build(name);
    if (view.hide) view.hide();
    el.classList.add('is-warming');
    el.offsetHeight;
    el.classList.remove('is-warming');
  }
  // Pre-build (startup) and re-build (after data changes) hidden views in the background, one per
  // slot, so navigating to them never pays the rebuild cost. Views hidden by config are skipped.
  var refreshTimer = null;
  function refreshStale(delay) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function next() {
      var name = Object.keys(App.views).filter(function (k) {
        var v = App.views[k];
        var el = $('#view-' + k);
        return k !== App.current && el && el.style.display !== 'none' && (!v._built || v._dirty);
      })[0];
      if (!name) return;
      prebuild(name);
      refreshTimer = setTimeout(next, 400);
    }, delay);
  }
  function markStale() {
    Object.keys(App.views).forEach(function (k) { if (k !== App.current) App.views[k]._dirty = true; });
    refreshStale(1500);
  }
  App.on('data', markStale);
  App.on('time', markStale);
  App.rerender = function () {
    if (App.current) App.views[App.current].show($('#view-' + App.current), { rerender: true });
  };

  // ------------------------------------------------------------ toasts (single, with undo)
  var toastTimer;
  App.toast = function (html, opts) {
    opts = opts || {};
    var box = $('#toasts');
    box.innerHTML = '';
    clearTimeout(toastTimer);
    var ms = opts.ms || 5000;
    var t = document.createElement('div');
    t.className = 'toast' + (opts.tone ? ' toast--' + opts.tone : '');
    t.style.setProperty('--ms', ms + 'ms');
    t.innerHTML = (opts.icon ? App.icon(opts.icon, 26) : '') + '<span class="toast-msg">' + html + '</span>' +
      (opts.undo ? '<button class="toast-undo">' + App.icon('undo', 22) + 'Undo</button>' : '');
    box.appendChild(t);
    t.classList.add('is-in');
    function kill() { t.remove(); }
    toastTimer = setTimeout(kill, ms);
    if (opts.undo) t.querySelector('.toast-undo').addEventListener('click', function () { clearTimeout(toastTimer); opts.undo(); kill(); });
  };

  // ------------------------------------------------------------ sheets (modal cards)
  App.sheet = function (html, opts) {
    opts = opts || {};
    var layer = $('#sheetLayer');
    layer.innerHTML = '<div class="sheet-scrim"></div><div class="sheet ' + (opts.cls || '') + '">' +
      '<button class="sheet-x" data-close aria-label="Close">' + App.icon('x', 28) + '</button>' + html + '</div>';
    layer.classList.add('is-open');
    function close() {
      if (!layer.classList.contains('is-open')) return;
      layer.classList.remove('is-open');
      if (opts.onClose) opts.onClose();
      layer.innerHTML = '';
    }
    App.closeSheet = close;
    layer.querySelector('.sheet-scrim').addEventListener('click', close);
    App.$$('[data-close]', layer).forEach(function (b) { b.addEventListener('click', close); });
    if (opts.onMount) opts.onMount(layer.querySelector('.sheet'), close);
    return close;
  };
  App.closeSheet = function () {};

  // Stage-local coordinates for an element's center (stage may be scaled on desktop)
  App.centerOf = function (el) {
    var stage = $('#stage').getBoundingClientRect(), r = el.getBoundingClientRect(), k = stage.height / 800;
    return { x: (r.left + r.width / 2 - stage.left) / k, y: (r.top + r.height / 2 - stage.top) / k };
  };

  // ------------------------------------------------------------ press-and-hold
  App.hold = function (el, ms, cb) {
    var t = null;
    el.style.setProperty('--hold', ms + 'ms');
    el.addEventListener('pointerdown', function () {
      if (cb.enabled && !cb.enabled()) return;
      el.classList.add('is-holding');
      t = setTimeout(function () { t = null; el.classList.remove('is-holding'); cb.done(); }, ms);
    });
    function cancel(e) {
      if (!t) return;
      clearTimeout(t); t = null;
      el.classList.remove('is-holding');
      if (cb.cancel && e.type === 'pointerup') cb.cancel();
    }
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointercancel', cancel);
  };

  // ------------------------------------------------------------ modes: day / ambient / night
  App.setMode = function (m) {
    var stage = $('#stage');
    App.mode = m;
    stage.dataset.mode = m;
    App.emit('mode', m);
  };

  // ------------------------------------------------------------ idle
  App.idle = { home: 60, ambient: 120 };
  var idleSec = 0;
  function onIdleTick() {
    idleSec++;
    var blocked = $('#takeover').classList.contains('is-open');
    if (App.mode === 'nightdash' && idleSec >= 20) { App.setMode('night'); return; }
    if (App.mode !== 'day' || blocked) return;
    if (idleSec === App.idle.home && App.current !== 'home') { App.closeSheet(); App.go('home'); }
    if (idleSec >= App.idle.ambient) {
      App.closeSheet();
      App.go('home');
      App.setMode(App.isNight() ? 'night' : 'ambient');
    }
  }
  App.resetIdle = function () { idleSec = 0; };

  // ------------------------------------------------------------ stage scaling
  // Designed at 1280×800. Screens wider than 16:10 (e.g. 1920×1080 frames) widen the stage to their
  // aspect instead of pillarboxing; narrower screens letterbox as before.
  var STAGE_H = 800, STAGE_MIN_W = 1280;
  function fit() {
    var stage = $('#stage');
    var w = Math.max(STAGE_MIN_W, Math.round(STAGE_H * window.innerWidth / window.innerHeight));
    stage.style.setProperty('--stage-w', w + 'px');
    var s = Math.min(window.innerWidth / w, window.innerHeight / STAGE_H);
    stage.style.transform = Math.abs(s - 1) < 0.01 ? '' : 'scale(' + s + ')';
  }

  // ------------------------------------------------------------ clock tick
  var lastMin = -1;
  function tick() {
    var n = App.now();
    App.emit('second', n);
    if (n.getMinutes() !== lastMin) {
      lastMin = n.getMinutes();
      $('#railClock').innerHTML = '<b>' + App.fmt.time(n, false) + '</b><span>' + App.fmt.ampm(n) + '</span>';
      App.emit('minute', n);
    }
    onIdleTick();
  }

  // ------------------------------------------------------------ section visibility
  App.setSectionVisible = function (name, visible) {
    var rail = $('#rail [data-go="' + name + '"]');
    if (rail) rail.style.display = visible ? '' : 'none';
    var view = $('#view-' + name);
    if (view) view.style.display = visible ? '' : 'none';
  };
  function applyHidden() {
    if (!D.config.tasks) App.setSectionVisible('tasks', false);
    if (!D.config.agents) App.setSectionVisible('agents', false);
    App.setSectionVisible('control', !!D.config.control);
  }

  // ------------------------------------------------------------ boot
  App.start = function () {
    applyHidden();
    fit();
    window.addEventListener('resize', fit);
    // Switch tabs the instant a finger lands (pointerdown), not on release. Keyboard "clicks"
    // (detail === 0) still work.
    $('#rail').addEventListener('pointerdown', function (e) {
      var b = e.target.closest('[data-go]');
      if (b && e.button === 0) App.go(b.dataset.go);
    });
    $('#rail').addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]');
      if (b && e.detail === 0) App.go(b.dataset.go);
    });
    document.addEventListener('pointerdown', App.resetIdle, true);
    window.addEventListener('hashchange', function () { App.go(location.hash.slice(1)); });
    App.go(location.hash.slice(1) || 'home');
    tick();
    setInterval(tick, 1000);
    App.emit('ready');
    refreshStale(1500);
    setTimeout(function () { App.toast('Tip: press and hold the <b>clock</b> in the sidebar for demo controls', { ms: 6000, icon: 'bolt' }); }, 1200);
  };
  document.addEventListener('DOMContentLoaded', function () { App.start(); });
})();
