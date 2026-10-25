// Live data model for the Constants family dashboard.
// Static/demo data is replaced at runtime by js/live.js (calendar, weather, photos), which
// fetches guarded /api/* endpoints and overwrites the matching fields here. What remains below
// is the real family, the shopping setup, and safe empty fallbacks so the app never crashes
// before (or without) the live data.
window.DATA = (function () {
  'use strict';

  var config = {
    familyName: 'The Constants',
    accent: '#2D5BFF',
    tasks: false,   // chores off
    control: false, // Home Assistant — turned on by live.js once /api/config reports it
    agents: false   // demo AI-usage view, not for this frame
  };

  var ALL = ['xavi', 'blaise', 'sarah', 'ruskin', 'buffy'];

  var people = [
    { id: 'xavi', name: 'Xavi', age: 3, color: '#2D5BFF', rgb: '45 91 255', ink: '#FFFFFF', home: true, status: 'Home' },
    { id: 'blaise', name: 'Blaise', age: 2, color: '#E4007C', rgb: '228 0 124', ink: '#FFFFFF', home: true, status: 'Home' },
    { id: 'sarah', name: 'Sarah', age: 38, color: '#00A36C', rgb: '0 163 108', ink: '#FFFFFF', home: true, status: 'Home' },
    { id: 'ruskin', name: 'Ruskin', age: 38, color: '#FFB000', rgb: '255 176 0', ink: '#111111', home: true, status: 'Home' },
    { id: 'buffy', name: 'Buffy', color: '#9C27B0', rgb: '156 39 176', ink: '#FFFFFF', home: true, status: 'Home' }
  ];
  var family = { id: 'family', name: config.familyName, color: '#111111', rgb: '17 17 17', ink: '#FFFFFF' };
  // Portugal public holidays — flag green so they read as a different kind of event.
  var holiday = { id: 'holiday', name: 'Holiday', color: '#046A38', rgb: '4 106 56', ink: '#FFFFFF' };

  // ---------------------------------------------------------------- calendar (filled by live.js)
  var n = 0;
  var events = [];
  var busyExtras = [];

  // ---------------------------------------------------------------- chores (off)
  var routines = [
    { id: 'morning', name: 'Morning', range: '6 – 11 AM', from: 0, to: 11 },
    { id: 'after', name: 'After school', range: '11 AM – 5 PM', from: 11, to: 17 },
    { id: 'evening', name: 'Evening', range: '5 – 10 PM', from: 17, to: 24 }
  ];
  var chores = [];
  var stars = {};
  var week = {};

  // ---------------------------------------------------------------- shopping
  var stores = [{ id: 'auchan', name: 'Auchan' }, { id: 'aldi', name: 'Aldi' }];
  var CATS = ['Produce', 'Bakery', 'Meat & Fish', 'Dairy & Eggs', 'Pantry', 'Frozen', 'Snacks', 'Household'];
  var catOrder = { all: CATS, auchan: CATS, aldi: CATS };
  var gid = 0;
  var groceries = [];
  var catalog = [
    ['Apples', 'Produce'], ['Avocados', 'Produce'], ['Bananas', 'Produce'], ['Baby spinach', 'Produce'], ['Blueberries', 'Produce'],
    ['Broccoli', 'Produce'], ['Carrots', 'Produce'], ['Cucumber', 'Produce'], ['Garlic', 'Produce'], ['Grapes', 'Produce'],
    ['Lemons', 'Produce'], ['Limes', 'Produce'], ['Onions', 'Produce'], ['Potatoes', 'Produce'], ['Strawberries', 'Produce'],
    ['Tomatoes', 'Produce'], ['Bread', 'Bakery'], ['Bagels', 'Bakery'], ['Croissants', 'Bakery'], ['Sourdough loaf', 'Bakery'],
    ['Tortillas', 'Bakery'], ['Hamburger buns', 'Bakery'], ['Bacon', 'Meat & Fish'], ['Chicken breasts', 'Meat & Fish'],
    ['Chicken thighs', 'Meat & Fish'], ['Ground beef', 'Meat & Fish'], ['Salmon fillets', 'Meat & Fish'], ['Shrimp', 'Meat & Fish'],
    ['Butter', 'Dairy & Eggs'], ['Cheddar', 'Dairy & Eggs'], ['Cream cheese', 'Dairy & Eggs'], ['Eggs', 'Dairy & Eggs'],
    ['Greek yogurt', 'Dairy & Eggs'], ['Milk 2%', 'Dairy & Eggs'], ['Oat milk', 'Dairy & Eggs'], ['Parmesan', 'Dairy & Eggs'],
    ['Black beans', 'Pantry'], ['Cereal', 'Pantry'], ['Coffee beans', 'Pantry'], ['Flour', 'Pantry'], ['Honey', 'Pantry'],
    ['Maple syrup', 'Pantry'], ['Olive oil', 'Pantry'], ['Pasta sauce', 'Pantry'], ['Peanut butter', 'Pantry'], ['Rice', 'Pantry'],
    ['Rigatoni', 'Pantry'], ['Spaghetti', 'Pantry'], ['Sugar', 'Pantry'], ['Tea', 'Pantry'], ['Frozen peas', 'Frozen'],
    ['Frozen berries', 'Frozen'], ['Ice cream', 'Frozen'], ['Pizza', 'Frozen'], ['Waffles', 'Frozen'], ['Chips', 'Snacks'],
    ['Crackers', 'Snacks'], ['Dark chocolate', 'Snacks'], ['Goldfish crackers', 'Snacks'], ['Granola bars', 'Snacks'],
    ['Popcorn', 'Snacks'], ['Dish soap', 'Household'], ['Dishwasher pods', 'Household'], ['Garbage bags', 'Household'],
    ['Laundry detergent', 'Household'], ['Paper towels', 'Household'], ['Toilet paper', 'Household'], ['Toothpaste', 'Household'],
    ['Nappies', 'Household']
  ];
  var usuals = ['Bread', 'Eggs', 'Fruit', 'Nappies'];

  // ---------------------------------------------------------------- home control (hidden until HA wired)
  var rooms = [];
  var devices = [];
  var climate = { current: 0, set: 0, mode: 'off', humidity: 0, outside: 0 };
  var media = { room: '', title: '', artist: '', playing: false, volume: 0, seed: '' };
  var cameras = [];
  var scenes = [];

  // ---------------------------------------------------------------- weather (filled by live.js)
  var weather = {
    hi: 15, lo: 8, feels: 12, humidity: 70, wind: 10,
    t: [9, 9, 9, 9, 9, 9, 9, 10, 12, 13, 14, 15, 15, 15, 15, 14, 13, 12, 11, 10, 10, 9, 9, 9],
    c: ['moon', 'moon', 'moon', 'moon', 'moon', 'moon', 'moon', 'cloud', 'cloud', 'partly', 'partly', 'sun', 'sun', 'sun', 'partly', 'cloud', 'cloud', 'cloud', 'moon', 'moon', 'moon', 'moon', 'moon', 'moon'],
    p: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };

  // ---------------------------------------------------------------- photos (filled by live.js)
  var photos = [];

  // ---------------------------------------------------------------- AI agents (hidden)
  var agents = [];

  return {
    config: config,
    people: people, family: family, holiday: holiday, ALL: ALL,
    events: events, busyExtras: busyExtras,
    routines: routines, chores: chores, stars: stars, week: week,
    stores: stores, catOrder: catOrder, groceries: groceries, catalog: catalog, usuals: usuals,
    rooms: rooms, devices: devices, climate: climate, media: media, cameras: cameras, scenes: scenes,
    weather: weather, photos: photos, agents: agents,
    _gid: function () { return 'g' + (++gid); },
    _eid: function () { return 'e' + (++n); }
  };
})();