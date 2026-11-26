// Node test harness for main.js — a stand-in for the app's extension sandbox.
//
// Why this exists: the v1.0.0 validation ran main.js under a plain Node shim
// with NO size guards, so it passed checks that the real sandbox refuses.
// The app's prelude (Orpheon/base/extensions/src/main/resources/app/myspoti/
// extensions/prelude.js) caps native calls a script cannot be interrupted
// in: a regular expression whose input is over MAX_INPUT/4 = 2 MB throws
// "RangeError: RegExp.prototype.exec: too large", the string regex methods
// throw the same way, and JSON.parse refuses inputs over 8 MB. On Tyson's
// phone that is exactly what the v1.0.0 client-id scrape died with, because
// SoundCloud's bundles are bigger than 2 MB.
//
// This harness installs those same guards INSIDE each test world's vm
// context before loading main.js, answers myspoti.http from fixtures shaped
// like the recorded live payloads (the same shapes as tests/*.json), and
// drives the real hooks. A suite that is green here is green under the
// guards; the first check proves the guards are actually armed, so a green
// run cannot be a false pass.
//
// Run: node tests/shim/run.js   (exit code 0 = all checks passed)

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');

// The prelude's size guards, copied from prelude.js (same limits, same
// RangeError messages).
var GUARDS = [
  'var MAX_STRING = 4 * 1024 * 1024;',
  'var MAX_INPUT = 8 * 1024 * 1024;',
  'function __tooBig(what) { throw new RangeError(what + ": too large"); }',
  'function __guard(proto, name, check) {',
  '  var original = proto[name];',
  '  if (typeof original !== "function") return;',
  '  Object.defineProperty(proto, name, {',
  '    value: function () { check.apply(this, arguments); return original.apply(this, arguments); },',
  '    writable: true, configurable: true, enumerable: false,',
  '  });',
  '}',
  '__guard(String.prototype, "repeat", function (count) {',
  '  if (String(this).length * Math.max(0, Number(count) || 0) > MAX_STRING) __tooBig("String.prototype.repeat");',
  '});',
  '["padStart", "padEnd"].forEach(function (name) {',
  '  __guard(String.prototype, name, function (length) {',
  '    if (Number(length) > MAX_STRING) __tooBig("String.prototype." + name);',
  '  });',
  '});',
  '__guard(Array.prototype, "join", function (sep) {',
  '  var s = sep === undefined ? 1 : String(sep).length;',
  '  if (this.length * s > MAX_STRING) __tooBig("Array.prototype.join");',
  '});',
  'var __jsonParse = JSON.parse;',
  'Object.defineProperty(JSON, "parse", {',
  '  value: function (text, reviver) {',
  '    if (typeof text === "string" && text.length > MAX_INPUT) __tooBig("JSON.parse");',
  '    return __jsonParse.call(JSON, text, reviver);',
  '  },',
  '  writable: true, configurable: true, enumerable: false,',
  '});',
  '["exec", "test"].forEach(function (name) {',
  '  __guard(RegExp.prototype, name, function (input) {',
  '    if (String(input).length > MAX_INPUT / 4) __tooBig("RegExp.prototype." + name);',
  '  });',
  '});',
  '["match", "matchAll", "replace", "replaceAll", "search", "split"].forEach(function (name) {',
  '  __guard(String.prototype, name, function () {',
  '    if (String(this).length > MAX_INPUT / 4) __tooBig("String.prototype." + name);',
  '  });',
  '});',
].join('\n');

// ---------------------------------------------------------------- fixtures
// The same shapes as the recorded live payloads in tests/*.json.

var CID = 'testcidtestcidtestcidtestcid1234'; // the seeded/warmed id (32 chars)
var CID2 = 'Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lz'; // the id buried in the big bundle

var SNIP_SEARCH = {
  artwork_url: 'https://i1.sndcdn.com/artworks-ey3N3A3FxfBy-0-large.jpg',
  duration: 30000, id: 254111945, policy: 'SNIP', streamable: true,
  title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers)',
  user: { username: 'Daft Punk' },
};

var FULL_SEARCH = {
  artwork_url: 'https://i1.sndcdn.com/artworks-000045765973-c2x8ko-large.jpg',
  duration: 246381, id: 88335161, policy: 'MONETIZE', streamable: true,
  title: 'Get Lucky [Original Version] - Daft Punk',
  user: { username: 'DJ KB' },
};

var FULL_TRACK = {
  duration: 246381, id: 88335161, policy: 'MONETIZE', streamable: true,
  title: 'Get Lucky [Original Version] - Daft Punk', user: { username: 'DJ KB' },
  media: {
    transcodings: [
      { duration: 246381, format: { mime_type: 'audio/mp4; codecs="mp4a.40.2"', protocol: 'hls' }, preset: 'aac_96k', snipped: false, url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:88335161/aaa' },
      { duration: 246381, format: { mime_type: 'audio/mpegurl', protocol: 'hls' }, preset: 'abr_sq', snipped: false, url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:88335161/bbb' },
    ],
  },
};

var SNIP_TRACK = {
  duration: 30000, id: 254111945, policy: 'SNIP', streamable: true,
  title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers)',
  user: { username: 'Daft Punk' },
  media: {
    transcodings: [
      { duration: 30000, format: { mime_type: 'audio/mpeg', protocol: 'progressive' }, preset: 'mp3_1_0', snipped: true, url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:254111945/ccc' },
    ],
  },
};

var LOFI_TRACK = {
  duration: 180000, id: 555001, policy: 'ALLOW', streamable: true,
  title: 'Lo Fi Beat', user: { username: 'Test Artist' },
  media: {
    transcodings: [
      { duration: 180000, format: { mime_type: 'audio/mpeg', protocol: 'progressive' }, preset: 'mp3_1_0', snipped: false, url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:555001/ddd' },
      { duration: 180000, format: { mime_type: 'audio/mp4; codecs="mp4a.40.2"', protocol: 'hls' }, preset: 'aac_96k', snipped: false, url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:555001/eee' },
    ],
  },
};

var DZ_DATA = [
  { artist: { name: 'Daft Punk' }, duration: 248, id: 66609426, isrc: 'USQX91300809', title: 'Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)' },
  { artist: { name: 'Daft Punk' }, duration: 367, id: 67238735, isrc: 'USQX91300108', title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers)' },
];

var RADIO_EDIT = { artist: 'Daft Punk', durationMs: 248000, isrc: 'USQX91300809', title: 'Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)' };
var ALBUM_CUT = { artist: 'Daft Punk', durationMs: 372000, isrc: 'USQX91300108', title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers)' };
var LOFI_INPUT = { artist: 'Test Artist', durationMs: 180000, title: 'Lo Fi Beat' };

function json(status, obj) { return { status: status, body: JSON.stringify(obj), headers: {} }; }
function text(status, body) { return { status: status, body: body, headers: {} }; }

// ------------------------------------------------------------------- world

// routes: [{ match: substring | function(url) -> bool, respond: object |
// function(url) -> object }], first match wins. seed: storage key -> value.
function makeWorld(routes, seed) {
  var store = {};
  Object.keys(seed || {}).forEach(function (k) { store[k] = JSON.stringify(seed[k]); });
  var hooks = {};
  var calls = [];
  function respond(url) {
    calls.push(url);
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      var hit = typeof r.match === 'function' ? r.match(url) : url.indexOf(r.match) >= 0;
      if (hit) return typeof r.respond === 'function' ? r.respond(url) : r.respond;
    }
    return text(404, '');
  }
  var myspoti = {
    features: ['http.all', 'results'],
    storage: {
      get: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? JSON.parse(store[k]) : null; },
      set: function (k, v) { store[k] = JSON.stringify(v); },
      remove: function (k) { delete store[k]; },
    },
    http: {
      get: function (url) { return respond(url); },
      all: function (reqs) { return reqs.map(function (r) { return respond(r.url); }); },
    },
    provide: function (name, fn) { hooks[name] = fn; },
    log: function () {},
  };
  var ctx = vm.createContext({ myspoti: myspoti, console: console });
  vm.runInContext(GUARDS, ctx);
  vm.runInContext(MAIN, ctx);
  return { hooks: hooks, storage: myspoti.storage, calls: calls, ctx: ctx };
}

function mediaRoute() {
  return {
    match: 'api-v2.soundcloud.com/media/',
    respond: function (url) {
      if (url.indexOf('/ddd') >= 0) return json(200, { url: 'https://media.example.com/lofi-beat.mp3' });
      return json(200, { url: 'https://playback.example.com/aac_96k/playlist.m3u8' });
    },
  };
}

function apiRoutes(searchCollection, tracksById) {
  var routes = [
    { match: 'api-v2.soundcloud.com/search/tracks', respond: json(200, { collection: searchCollection, total_results: searchCollection.length }) },
    { match: 'api.deezer.com/search', respond: json(200, { data: DZ_DATA }) },
    mediaRoute(),
  ];
  Object.keys(tracksById || {}).forEach(function (id) {
    routes.push({ match: 'api-v2.soundcloud.com/tracks/' + id, respond: json(200, tracksById[id]) });
  });
  return routes;
}

// ------------------------------------------------------------------ checks

var passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('ok   ' + name); }
  else { failed++; console.log('FAIL ' + name); }
}

// 0. The guards are armed, with the prelude's own error messages — the exact
// failure Tyson's phone showed for v1.0.0.
(function () {
  var w = makeWorld([]);
  var probe = vm.runInContext([
    '(function () {',
    '  var out = [];',
    '  var big = "y".repeat(3 * 1024 * 1024);',
    '  try { /x/.exec(big); out.push("exec:no-throw"); }',
    '  catch (e) { out.push("exec:" + e.name + ":" + e.message); }',
    '  try { big.match(/x/); out.push("match:no-throw"); }',
    '  catch (e) { out.push("match:" + e.name + ":" + e.message); }',
    '  var parts = []; for (var i = 0; i < 9; i++) parts.push(" ".repeat(1024 * 1024));',
    '  try { JSON.parse(parts.join("")); out.push("json:no-throw"); }',
    '  catch (e) { out.push("json:" + e.name + ":" + e.message); }',
    '  return out.join(" | ");',
    '})()',
  ].join('\n'), w.ctx);
  check('guards armed: exec over 2 MB throws the prelude RangeError', probe.indexOf('exec:RangeError:RegExp.prototype.exec: too large') >= 0);
  check('guards armed: string match over 2 MB throws', probe.indexOf('match:RangeError:String.prototype.match: too large') >= 0);
  check('guards armed: JSON.parse over 8 MB throws', probe.indexOf('json:RangeError:JSON.parse: too large') >= 0);
})();

// 1. The status hook warms the client id from a small homepage + bundles.
(function () {
  var home = '<html><head>' +
    '<script src="https://a-v2.sndcdn.com/assets/10-abc123.js"></script>' +
    '<script src="https://a-v2.sndcdn.com/assets/55-835d9ae3.js"></script>' +
    '</head><body>soundcloud</body></html>';
  var w = makeWorld([
    { match: function (u) { return u === 'https://soundcloud.com/'; }, respond: text(200, home) },
    { match: 'assets/10-abc123.js', respond: text(200, 'var a = "no id in this bundle";') },
    { match: 'assets/55-835d9ae3.js', respond: text(200, 'define({client_id:"' + CID + '",other:1});') },
  ]);
  var status = w.hooks.status();
  check('status hook answers live', status && status.live === true);
  check('status scrape warms and caches the exact client id', w.storage.get('cid') === CID);
})();

// 2-7. Search: twin matching and what it remembers.
(function () {
  var w = makeWorld(apiRoutes([SNIP_SEARCH, FULL_SEARCH], {}), { cid: CID });
  var res = w.hooks.search({ query: 'Daft Punk Get Lucky' });
  var items = res && res[0] && res[0].items;
  check('search lists the Deezer radio edit paired with the full SoundCloud upload',
    !!(items && items.length === 1 && items[0].uri === 'deezer:track:66609426'));
  check('search does not list the album cut (no full twin)', JSON.stringify(res).indexOf('67238735') < 0);
  var map = w.storage.get('scmap') || {};
  check('search never uses the SNIP track', Object.keys(map).every(function (k) { return map[k] !== 254111945; }));
  check('match remembered by catalog id', map['c:deezer.66609426'] === 88335161);
  check('match remembered by ISRC', map['i:USQX91300809'] === 88335161);
  check('match remembered by title|artist', map['t:get lucky|daft punk'] === 88335161);
})();

// 8 + 16. Audio: the remembered catalog id resolves without a new search,
// and the answer is the signed HLS playlist.
(function () {
  var w = makeWorld(apiRoutes([FULL_TRACK], { '88335161': FULL_TRACK }),
    { cid: CID, scmap: { 'c:deezer.66609426': 88335161 } });
  var ans = w.hooks['audio-source']({ id: 'deezer.66609426', artist: 'Daft Punk', durationMs: 248000, isrc: 'USQX91300809', title: 'Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)' });
  check('audio answers the signed HLS playlist URL as application/x-mpegURL / aac',
    !!(ans && ans.url && ans.url.indexOf('playlist.m3u8') >= 0 && ans.mimeType === 'application/x-mpegURL' && ans.codec === 'aac'));
  check('audio by remembered catalog id makes no search call',
    w.calls.every(function (u) { return u.indexOf('/search/tracks') < 0; }));
})();

// 8b. Audio by query (nothing remembered): search, match, resolve.
(function () {
  var w = makeWorld(apiRoutes([FULL_TRACK], { '88335161': FULL_TRACK }), { cid: CID });
  var ans = w.hooks['audio-source'](RADIO_EDIT);
  check('audio by query resolves the same recording to the HLS playlist',
    !!(ans && ans.url && ans.url.indexOf('playlist.m3u8') >= 0 && ans.mimeType === 'application/x-mpegURL'));
})();

// 9 + 10. A SNIP-only song is refused for playback and for download.
(function () {
  var w = makeWorld(apiRoutes([SNIP_TRACK], { '254111945': SNIP_TRACK }), { cid: CID });
  var play = w.hooks['audio-source'](ALBUM_CUT);
  var dl = w.hooks['download-source'](ALBUM_CUT);
  check('SNIP-only song returns not-found for playback', !!(play && play.outcome === 'not-found'));
  check('SNIP-only song returns not-found for download', !!(dl && dl.outcome === 'not-found'));
})();

// 11. An HLS-only song has no download.
(function () {
  var w = makeWorld(apiRoutes([FULL_TRACK], { '88335161': FULL_TRACK }), { cid: CID });
  var dl = w.hooks['download-source'](RADIO_EDIT);
  check('HLS-only song returns not-found for download', !!(dl && dl.outcome === 'not-found'));
})();

// 12 + 13. A progressive file: offered as a download (without claiming an
// ISRC match) and preferred over HLS for playback.
(function () {
  var w = makeWorld(apiRoutes([LOFI_TRACK], { '555001': LOFI_TRACK }), { cid: CID });
  var dl = w.hooks['download-source'](LOFI_INPUT);
  check('progressive song is offered as an mp3 download, isrcMatched false',
    !!(dl && dl[0] && dl[0].url === 'https://media.example.com/lofi-beat.mp3' && dl[0].format === 'mp3' && dl[0].isrcMatched === false));
  var w2 = makeWorld(apiRoutes([LOFI_TRACK], { '555001': LOFI_TRACK }), { cid: CID });
  var play = w2.hooks['audio-source'](LOFI_INPUT);
  check('progressive file plays in preference to HLS',
    !!(play && play.url === 'https://media.example.com/lofi-beat.mp3' && play.mimeType === 'audio/mpeg' && play.codec === 'mp3'));
})();

// 14. A refused client id is re-scraped once and the call retried.
(function () {
  var STALE = 'stale0stale0stale0stale0stale0st';
  var home = '<script src="https://a-v2.sndcdn.com/assets/55-835d9ae3.js"></script>';
  var routes = [
    {
      match: 'api-v2.soundcloud.com/search/tracks',
      respond: function (url) {
        if (url.indexOf('client_id=' + STALE) >= 0) return text(401, '');
        if (url.indexOf('client_id=' + CID) >= 0) return json(200, { collection: [FULL_TRACK], total_results: 1 });
        return text(400, '');
      },
    },
    { match: 'api-v2.soundcloud.com/tracks/88335161', respond: json(200, FULL_TRACK) },
    mediaRoute(),
    { match: function (u) { return u === 'https://soundcloud.com/'; }, respond: text(200, home) },
    { match: 'assets/55-835d9ae3.js', respond: text(200, 'define({client_id:"' + CID + '"});') },
  ];
  var w = makeWorld(routes, { cid: STALE });
  var ans = w.hooks['audio-source'](RADIO_EDIT);
  check('401 re-scrapes the client id, caches the fresh one, and the retry answers',
    !!(ans && ans.url && ans.url.indexOf('playlist.m3u8') >= 0) && w.storage.get('cid') === CID);
})();

// 15. Search with a cold client id answers nothing and does not scrape.
(function () {
  var w = makeWorld(apiRoutes([FULL_TRACK], {}), {});
  var res = w.hooks.search({ query: 'Daft Punk Get Lucky' });
  check('cold search answers [] without any HTTP', Array.isArray(res) && res.length === 0 && w.calls.length === 0);
})();

// 17. THE REGRESSION CASE: a homepage over the 2 MB regex limit with bundle
// addresses throughout, and a bundle over 3 MB with decoy client_id mentions
// and the real id buried near the end. Under the armed guards, any
// whole-body pattern would throw; the windowed scan must still extract.
(function () {
  check('fixture client ids are exactly 32 chars', CID.length === 32 && CID2.length === 32);
  var filler = '/*' + 'x'.repeat(1000) + '*/';
  function fill(chars) {
    var out = '';
    while (out.length < chars) out += filler;
    return out;
  }
  var B = {
    b1: 'https://a-v2.sndcdn.com/assets/100-aaaa1111.js',
    b2: 'https://a-v2.sndcdn.com/assets/200-bbbb2222.js',
    b3: 'https://a-v2.sndcdn.com/assets/300-cccc3333.js',
  };
  // Homepage: ~2.3 MB, bundle addresses spread through it, the wanted one late.
  var home = '<html><head><script src="' + B.b1 + '"></script></head><body>' +
    fill(700 * 1000) +
    '<script src="' + B.b3 + '"></script>' + fill(700 * 1000) +
    '<script src="' + B.b2 + '"></script>' + fill(900 * 1000) +
    '</body></html>';
  // The monster bundle: ~3.3 MB. Decoys first (a short value, a 31-char
  // value, a dashed value, a bare mention), the real id near the end.
  var bundle2 = fill(1000 * 1000) +
    'a={client_id:"tooshort"};' + fill(500 * 1000) +
    'b={client_id = \'' + 'A'.repeat(31) + '\'};' + fill(500 * 1000) +
    'c={client_id:"' + 'abc-'.repeat(8) + '"}; var client_id; // set later' + fill(1200 * 1000) +
    'd={client_id:"' + CID2 + '"};' + fill(50 * 1000);
  check('fixtures exceed the limits (homepage > 2 MB, bundle > 3 MB)',
    home.length > 2 * 1024 * 1024 && bundle2.length > 3 * 1024 * 1024);
  var w = makeWorld([
    { match: function (u) { return u === 'https://soundcloud.com/'; }, respond: text(200, home) },
    { match: 'assets/100-aaaa1111.js', respond: text(200, 'var a = 1; // no id here') },
    { match: 'assets/300-cccc3333.js', respond: text(200, 'var c = 3; // no id here either') },
    { match: 'assets/200-bbbb2222.js', respond: text(200, bundle2) },
  ]);
  var status = w.hooks.status();
  check('over-limit scrape still extracts the buried client id',
    !!(status && status.live === true) && w.storage.get('cid') === CID2);
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
