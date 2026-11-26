# SoundCloud for Scadify

An extension for [Scadify](https://github.com/TScadden/Scadify) (the Orpheon/Myspoti
family of music players) that makes SoundCloud one of the app's sources:

- **Search** — a SoundCloud section in the app's search results.
- **Playback** — songs stream from SoundCloud in full, through the app's own player.
- **Downloads** — only when SoundCloud actually offers a file (see below; it is rare).

Free and open source, GPL-3.0. Not affiliated with SoundCloud.

## How it works

SoundCloud's official API has been closed to new app registrations for years, so
there is no API key to apply for. Like other open-source tools, this extension
borrows the SoundCloud **web player's own public client id**: it reads
soundcloud.com, finds the id in the site's JavaScript bundles, caches it on the
phone, and fetches it again by itself when SoundCloud rotates it and starts
refusing the old one. No account, no sign-in, nothing leaves the phone except
requests to SoundCloud and Deezer.

## The honest limits

- **Search only lists songs that also exist in the catalog.** The app's extension
  API only accepts catalog song ids (Deezer, iTunes, MusicBrainz…) in search
  results, so this extension matches each SoundCloud result to its Deezer twin —
  same title, same primary artist, same length — and lists that. A song that
  exists *only* on SoundCloud, with no catalog twin, cannot be offered as a
  playable search result. This is a limit of the app's extension API, not a
  choice. (Once a song is playing from the catalog, SoundCloud can still be the
  source that plays it.)
- **Previews are refused, never clipped.** Some songs SoundCloud only lets
  signed-out listeners preview (30 seconds). This extension detects them —
  SoundCloud marks them directly (`policy: "SNIP"`, snipped transcodings,
  preview addresses) — and answers "not found", so the app asks its next source
  instead of playing you a snippet as if it were the song.
- **Downloads are rare.** Modern SoundCloud is streaming-only (HLS); in a sample
  of full songs, none offered a downloadable file. The download source answers
  only when a real progressive MP3 exists, and stays silent otherwise.
- **Streaming is HLS.** Playback hands the player SoundCloud's signed HLS
  playlist address (`application/x-mpegURL`, AAC). The app carries an HLS
  player, but whether an HLS answer from an extension plays end to end is only
  provable on a real phone; if it does not play on yours, that is the first
  thing to report.

## First use

The extension fetches SoundCloud's client id in the background when it starts.
Until that first fetch lands, search may show no SoundCloud section yet; give it
a few seconds, or play any song once (the playback path fetches the id on
demand), then search again.

## Installing

In the app: **Extensions → Store**, find this repository under *On GitHub*
(the store searches GitHub for the `myspoti-extension` topic), or use
**Install from an address** and paste:

```
https://github.com/TScadden/scadify-soundcloud
```

Then put it where you want it in **Settings → Playback** (audio source order)
and **Settings → Downloads**.

## Building the package

`extension.zip` — the package the app installs — is built deterministically
(fixed file order and dates, so anyone can rebuild it and compare the sha256):

```
python3 scripts/pack.py            # writes extension.zip
```

Releases are made by tagging: `git tag v1.0.0 && git push origin v1.0.0` — the
GitHub workflow checks the tag against `manifest.json`, builds `extension.zip`
and attaches it to the release.

Scenario tests for the `myspoti-ext` desktop runner live in `tests/`
(see the Orpheon extension API docs, section 7). A Node test harness that
emulates the sandbox's size guards lives in `tests/shim/`:
`node tests/shim/run.js`.

## Changelog

- **1.0.1** — Fixed the client id fetch failing on the extension page with
  "RegExp.prototype.exec: too large". The app's extension sandbox refuses a
  regular expression whose input is over 2 MB, and SoundCloud's JavaScript
  bundles are bigger than that; the id and the bundle addresses are now found
  by scanning small windows of the fetched pages with `indexOf`, so no pattern
  ever runs over a whole page.
- **1.0.0** — First release: SoundCloud results in search, full-song streaming
  from SoundCloud, and a download only when SoundCloud offers a real
  (progressive) file.

## License

GPL-3.0. The extension API it is built against comes from
[Myspoti/Orpheon](https://github.com/kota-zo/myspoti) by kota-zo, also GPL-3.0.
