// SoundCloud for Scadify — an audio/download source and search provider for SoundCloud.
//
// SoundCloud's official API has been closed to new registrations for years, so this
// extension borrows the web player's own public client id: it reads soundcloud.com,
// finds the id in the site's JavaScript bundles, caches it, and re-reads it when
// SoundCloud starts refusing it (401/403). All SoundCloud knowledge lives in the SC
// object below, so a SoundCloud-side change is a one-place fix.
//
// Honesty rules:
//  - A song SoundCloud only previews (policy SNIP, a snipped transcoding, a /preview/
//    address, a transcoding far shorter than the song) is refused, never clipped:
//    the hooks answer "not found" and the app asks its next source.
//  - Downloads are offered only when SoundCloud serves a real progressive file.
//    Modern SoundCloud is streaming-only (HLS), so downloads are rare.

'use strict';

// ---------------------------------------------------------------- small helpers

function hasFeature(name) {
  return !!(myspoti.features && myspoti.features.indexOf(name) >= 0);
}

function parseBody(r) {
  if (!r || r.error || !r.body) return null;
  try { return JSON.parse(r.body); } catch (e) { return null; }
}

var ACCENTS = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ā': 'a', 'ă': 'a', 'ą': 'a',
  'ç': 'c', 'ć': 'c', 'č': 'c', 'ĉ': 'c', 'ċ': 'c',
  'ď': 'd', 'đ': 'd', 'ð': 'd',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ē': 'e', 'ĕ': 'e', 'ė': 'e', 'ę': 'e', 'ě': 'e',
  'ĝ': 'g', 'ğ': 'g', 'ġ': 'g', 'ģ': 'g',
  'ĥ': 'h', 'ħ': 'h',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ĩ': 'i', 'ī': 'i', 'ĭ': 'i', 'į': 'i', 'ı': 'i',
  'ĵ': 'j', 'ķ': 'k', 'ĺ': 'l', 'ļ': 'l', 'ľ': 'l', 'ŀ': 'l', 'ł': 'l',
  'ñ': 'n', 'ń': 'n', 'ņ': 'n', 'ň': 'n',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o', 'ō': 'o', 'ŏ': 'o', 'ő': 'o',
  'ŕ': 'r', 'ŗ': 'r', 'ř': 'r',
  'ś': 's', 'ŝ': 's', 'ş': 's', 'š': 's', 'ș': 's', 'ß': 'ss',
  'ţ': 't', 'ť': 't', 'ŧ': 't', 'ț': 't',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ũ': 'u', 'ū': 'u', 'ŭ': 'u', 'ů': 'u', 'ű': 'u', 'ų': 'u',
  'ý': 'y', 'ÿ': 'y', 'ź': 'z', 'ż': 'z', 'ž': 'z', 'æ': 'ae', 'œ': 'oe', 'þ': 'th'
};

function fold(s) {
  s = String(s == null ? '' : s).toLowerCase();
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    out += ACCENTS[c] || c;
  }
  return out;
}

// Lowercase, accents folded, hashtags and punctuation gone: "Daft Punk" -> "daft punk".
function normText(s) {
  return fold(s).replace(/#[a-z0-9_]+/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// The title as recordings are compared: bracketed parts and "feat." tails are not
// part of the recording's name, so "(Radio Edit)" and the album cut share a core
// title and the duration has to tell them apart (it does: see matchDuration).
function coreTitle(s) {
  s = fold(s).replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
  s = s.replace(/#[a-z0-9_]+/g, ' ');
  s = s.replace(/\b(feat|ft|featuring)\b.*$/, ' ');
  return s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

var DURATION_TOLERANCE_MS = 8000;

function durationFits(aMs, bMs) {
  if (!aMs || !bMs) return true; // one side unknown: title and artist already matched
  return Math.abs(aMs - bMs) <= DURATION_TOLERANCE_MS;
}

// ------------------------------------------------------- the match cache (storage)

// The search hook learns which SoundCloud track plays for a catalog song; the
// source hooks look it up by the catalog id, by ISRC, and by title|artist.
var MAP_MAX = 250;

function rememberKeys(keys, scId) {
  var map = myspoti.storage.get('scmap') || {};
  var order = myspoti.storage.get('scorder') || [];
  var changed = false;
  keys.forEach(function (k) {
    if (k && map[k] !== scId) { map[k] = scId; order.push(k); changed = true; }
  });
  if (!changed) return;
  while (order.length > MAP_MAX) { var old = order.shift(); delete map[old]; }
  myspoti.storage.set('scmap', map);
  myspoti.storage.set('scorder', order);
}

function rememberCatalog(catId, isrc, title, artist, scId) {
  var keys = [];
  if (catId) keys.push('c:' + catId);
  if (isrc) keys.push('i:' + isrc);
  keys.push('t:' + coreTitle(title) + '|' + normText(artist));
  rememberKeys(keys, scId);
}

function lookupScId(track) {
  var map = myspoti.storage.get('scmap') || {};
  if (track.id && map['c:' + track.id]) return map['c:' + track.id];
  if (track.isrc && map['i:' + track.isrc]) return map['i:' + track.isrc];
  var byTitle = map['t:' + coreTitle(track.title) + '|' + normText(track.artist)];
  return byTitle || null;
}

// ------------------------------------------------------------------ SoundCloud

var SC = {
  API: 'https://api-v2.soundcloud.com',
  lastStatus: 0,
  lastHeaders: null,

  // The cached client id, or a fresh scrape. force=true forgets the cached one
  // first (SoundCloud refused it).
  clientId: function (force) {
    if (!force) {
      var cached = myspoti.storage.get('cid');
      if (cached) return cached;
    } else {
      myspoti.storage.remove('cid');
    }
    return this.scrape(null);
  },

  cachedClientId: function () {
    return myspoti.storage.get('cid') || null;
  },

  extractClientId: function (text) {
    if (!text) return null;
    var m = /client_id["']?\s*[:=]\s*["']([A-Za-z0-9]{32})["']/.exec(text);
    return m ? m[1] : null;
  },

  // Reads soundcloud.com and its script bundles until the client id turns up.
  // homeBody, when given, is an already-fetched homepage (the status hook has one).
  scrape: function (homeBody) {
    var body = homeBody;
    if (!body) {
      var home = myspoti.http.get('https://soundcloud.com/', { timeout: 8000 });
      if (!home || home.status !== 200) return null;
      body = home.body;
    }
    var cid = this.extractClientId(body);
    if (cid) { myspoti.storage.set('cid', cid); return cid; }
    var urls = [];
    var seen = {};
    var re = /https:\/\/a-v2\.sndcdn\.com\/assets\/[0-9A-Za-z\-]+\.js/g;
    var hit;
    while ((hit = re.exec(body)) !== null) {
      if (!seen[hit[0]]) { seen[hit[0]] = true; urls.push(hit[0]); }
    }
    for (var i = 0; i < urls.length && i < 12; i += 4) {
      var batch = urls.slice(i, i + 4);
      var bodies = this.fetchBodies(batch);
      for (var j = 0; j < bodies.length; j++) {
        cid = this.extractClientId(bodies[j]);
        if (cid) { myspoti.storage.set('cid', cid); return cid; }
      }
    }
    return null;
  },

  fetchBodies: function (urls) {
    var out = [];
    if (hasFeature('http.all') && urls.length > 1) {
      var reqs = urls.map(function (u) { return { url: u, timeout: 8000 }; });
      var answers = myspoti.http.all(reqs);
      answers.forEach(function (r) { out.push(r && !r.error ? r.body : null); });
      return out;
    }
    urls.forEach(function (u) {
      try { out.push(myspoti.http.get(u, { timeout: 8000 }).body); }
      catch (e) { out.push(null); }
    });
    return out;
  },

  // One api-v2 GET with the client id; on 401/403 the id is re-scraped once and
  // the call retried once. Returns { status, json, headers }; a network failure
  // throws, which the app counts as a network error, never as this extension
  // failing.
  apiGet: function (path) {
    var cid = this.clientId(false);
    if (!cid) { this.lastStatus = 0; return { status: 0, json: null, headers: null }; }
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    var r = myspoti.http.get(this.API + path + sep + 'client_id=' + cid, { timeout: 9000 });
    if (r.status === 401 || r.status === 403) {
      cid = this.clientId(true);
      if (cid) {
        r = myspoti.http.get(this.API + path + sep + 'client_id=' + cid, { timeout: 9000 });
      }
    }
    this.lastStatus = r.status;
    this.lastHeaders = r.headers;
    return { status: r.status, json: parseBody(r), headers: r.headers };
  },

  searchTracks: function (query, limit) {
    var res = this.apiGet('/search/tracks?q=' + encodeURIComponent(query) + '&limit=' + (limit || 10));
    if (!res.json || !res.json.collection) return null;
    return res.json.collection;
  },

  getTrack: function (id) {
    var res = this.apiGet('/tracks/' + id);
    return res.json && res.json.id ? res.json : null;
  },

  // May this track be played in full at all? Previews and blocked tracks may not.
  playable: function (t) {
    if (!t) return false;
    if (t.policy === 'SNIP' || t.policy === 'BLOCK') return false;
    if (t.streamable === false) return false;
    return true;
  },

  // The best full-length way to hear the track, or null. A snipped transcoding, a
  // /preview/ address, or one far shorter than the track is never chosen, however
  // good it looks otherwise. Playback prefers a progressive file, then HLS in
  // AAC (mp4), then any HLS; downloads take a progressive file or nothing.
  pickTranscoding: function (track, progressiveOnly) {
    var tcs = (track.media && track.media.transcodings) || [];
    var best = null, bestScore = -1;
    for (var i = 0; i < tcs.length; i++) {
      var tc = tcs[i];
      if (!tc || !tc.url || tc.snipped) continue;
      if (tc.url.indexOf('/preview/') >= 0) continue;
      if (track.duration && tc.duration && tc.duration < track.duration - 10000) continue;
      var proto = tc.format && tc.format.protocol;
      var mime = (tc.format && tc.format.mime_type) || '';
      var score;
      if (proto === 'progressive') score = 100;
      else if (proto === 'hls' && mime.indexOf('mp4') >= 0) score = 60 + (tc.preset === 'aac_160k' ? 10 : 0);
      else if (proto === 'hls') score = 40;
      else continue;
      if (progressiveOnly && proto !== 'progressive') continue;
      if (score > bestScore) { bestScore = score; best = tc; }
    }
    return best;
  },

  // Turns a transcoding into the signed address the player opens.
  resolveUrl: function (track, tc) {
    var path = tc.url.indexOf(this.API) === 0 ? tc.url.substring(this.API.length) : tc.url;
    if (track.track_authorization) {
      path += (path.indexOf('?') >= 0 ? '&' : '?') + 'track_authorization=' + encodeURIComponent(track.track_authorization);
    }
    var res = this.apiGet(path);
    return res.json && res.json.url ? res.json.url : null;
  }
};

// ------------------------------------------------------------- track matching

// A SoundCloud title is read three ways: "Artist - Title", "Title - Artist", and
// the plain title with the uploader as the artist. The reading that fits decides.
function scReadings(t) {
  var title = String(t.title || '');
  var user = (t.user && t.user.username) || '';
  var readings = [];
  var parts = title.split(' - ');
  if (parts.length === 2) {
    readings.push({ title: parts[1], artist: parts[0] });
    readings.push({ title: parts[0], artist: parts[1] });
  }
  readings.push({ title: title, artist: user });
  return readings;
}

// Returns the reading under which the SoundCloud track is the catalog song
// (title, primary artist, and duration when both are known), or null.
function matchReading(scTrack, title, artist, durationMs) {
  var readings = scReadings(scTrack);
  for (var i = 0; i < readings.length; i++) {
    var r = readings[i];
    if (coreTitle(r.title) === coreTitle(title) && normText(r.artist) === normText(artist)) {
      return durationFits(scTrack.duration, durationMs) ? r : null;
    }
  }
  return null;
}

function cleanDisplay(s) {
  return String(s || '').replace(/#[a-z0-9_]+/gi, ' ').replace(/\s+/g, ' ').trim();
}

function art500(url) {
  if (!url) return undefined;
  return url.replace('-large.', '-t500x500.');
}

// The SoundCloud track for an app track: the remembered one when there is one,
// else the best search answer that is the same recording.
function resolveScTrack(track) {
  var scId = lookupScId(track);
  if (scId) {
    var byId = SC.getTrack(scId);
    if (byId) return byId;
  }
  var query = (track.artist ? track.artist + ' ' : '') + (track.title || '');
  var results = SC.searchTracks(query, 10);
  if (!results) return null;
  for (var i = 0; i < results.length; i++) {
    var cand = results[i];
    if (!SC.playable(cand)) continue;
    if (matchReading(cand, track.title, track.artist, track.durationMs)) {
      rememberCatalog(track.id, track.isrc, track.title, track.artist, cand.id);
      return SC.getTrack(cand.id) || cand;
    }
  }
  return null;
}

function noAnswer() {
  if (SC.lastStatus === 429 && hasFeature('results')) {
    var secs = parseInt((SC.lastHeaders && SC.lastHeaders['retry-after']) || '60', 10);
    if (!(secs > 0)) secs = 60;
    return { outcome: 'rate-limited', retryAfterMs: Math.max(30, Math.min(900, secs)) * 1000 };
  }
  return hasFeature('results') ? { outcome: 'not-found' } : null;
}

// -------------------------------------------------------------------- hooks

myspoti.provide('search', function (input) {
  try {
    var query = (input && input.query) || '';
    if (!String(query).replace(/\s+/g, '')) return [];
    // The client id is warmed by the status hook; without one a search would
    // spend its whole budget scraping, so it answers nothing this once.
    var cid = SC.cachedClientId();
    if (!cid) return [];
    var scUrl = SC.API + '/search/tracks?q=' + encodeURIComponent(query) + '&client_id=' + cid + '&limit=20';
    var dzUrl = 'https://api.deezer.com/search?q=' + encodeURIComponent(query) + '&limit=25';
    var scRes = null, dzRes = null;
    if (hasFeature('http.all')) {
      var ans = myspoti.http.all([
        { url: scUrl, timeout: 2500 },
        { url: dzUrl, timeout: 2500 }
      ]);
      if (ans[0] && ans[0].status === 401 || ans[0] && ans[0].status === 403) myspoti.storage.remove('cid');
      scRes = parseBody(ans[0]);
      dzRes = parseBody(ans[1]);
    } else {
      try { scRes = parseBody(myspoti.http.get(scUrl, { timeout: 2500 })); } catch (e) { }
      try { dzRes = parseBody(myspoti.http.get(dzUrl, { timeout: 2500 })); } catch (e) { }
    }
    var scTracks = scRes && scRes.collection;
    var dzTracks = dzRes && dzRes.data;
    if (!scTracks || !dzTracks) return [];
    var items = [];
    var usedSc = {}, seenDz = {};
    for (var i = 0; i < dzTracks.length && items.length < 12; i++) {
      var dz = dzTracks[i];
      if (!dz || seenDz[dz.id]) continue;
      seenDz[dz.id] = true;
      var dzArtist = (dz.artist && dz.artist.name) || '';
      var dzMs = dz.duration ? dz.duration * 1000 : 0;
      for (var j = 0; j < scTracks.length; j++) {
        var sc = scTracks[j];
        if (!sc || usedSc[sc.id] || !SC.playable(sc)) continue;
        var reading = matchReading(sc, dz.title, dzArtist, dzMs);
        if (!reading) continue;
        usedSc[sc.id] = true;
        rememberCatalog('deezer.' + dz.id, dz.isrc, dz.title, dzArtist, sc.id);
        var item = {
          uri: 'deezer:track:' + dz.id,
          title: cleanDisplay(reading.title) || dz.title,
          subtitle: cleanDisplay(reading.artist) || dzArtist
        };
        var img = art500(sc.artwork_url);
        if (img) item.image = img;
        items.push(item);
        break;
      }
    }
    if (!items.length) return [];
    return [{ type: 'tracks', title: 'SoundCloud', items: items }];
  } catch (e) {
    return [];
  }
});

myspoti.provide('audio-source', function (track) {
  var sc = resolveScTrack(track);
  if (!sc || !SC.playable(sc)) return noAnswer();
  var tc = SC.pickTranscoding(sc, false);
  if (!tc) return noAnswer();
  var url = SC.resolveUrl(sc, tc);
  if (!url) return noAnswer();
  var hls = tc.format && tc.format.protocol === 'hls';
  var answer = {
    url: url,
    mimeType: hls ? 'application/x-mpegURL' : 'audio/mpeg',
    codec: hls ? 'aac' : 'mp3',
    expiresInMs: 600000,
    source: 'SoundCloud'
  };
  if (sc.duration) answer.durationMs = sc.duration;
  return answer;
});

myspoti.provide('download-source', function (track) {
  var sc = resolveScTrack(track);
  if (!sc || !SC.playable(sc)) return noAnswer();
  // Only a real progressive file can be kept; an HLS stream cannot, so a song
  // SoundCloud serves streaming-only honestly has no download here.
  var tc = SC.pickTranscoding(sc, true);
  if (!tc) return noAnswer();
  var url = SC.resolveUrl(sc, tc);
  if (!url) return noAnswer();
  return [{ url: url, format: 'mp3', provider: 'SoundCloud', isrcMatched: false }];
});

myspoti.provide('status', function () {
  try {
    var r = myspoti.http.get('https://soundcloud.com/', { timeout: 3000 });
    if (r.status >= 200 && r.status < 400) {
      // Warm the client id here, in the background, so search stays fast.
      if (!SC.cachedClientId()) {
        try { SC.scrape(r.body); } catch (e) { }
      }
      return { live: true };
    }
    return { live: false, detail: 'soundcloud.com answered ' + r.status };
  } catch (e) {
    return { live: false, detail: 'SoundCloud could not be reached' };
  }
});
