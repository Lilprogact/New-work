# 🎧 UltraTune

A dual-deck DJ rig that runs **entirely in your browser**. Connect Spotify,
pull in tracks, bend the tempo, sweep the filter, boost the bass, loop, brake
and crossfade between two decks — then record your mix and download it.

## Features

- **Two decks + mixer** — independent play/cue/seek, per-deck volume, equal-power crossfader, master volume
- **Tempo control** — ±50% speed with vinyl-style pitch bend (and a one-click reset)
- **3-band EQ** per deck (low / mid / high) plus a DJ **filter sweep** (lowpass ↔ highpass on one slider)
- **FX** — bass **BOOST**, **ECHO** (feedback delay), and a vinyl **BRAKE** spin-down
- **Loops & cues** — set loop in/out points on the fly, drop a cue and jump back to it
- **Live waveforms** with click-to-seek, cue/loop markers, and a master spectrum visualizer
- **Record your mix** — one button captures the master output to a downloadable file
- **Spotify integration** — log in with your own Spotify account, search the catalog,
  and browse your playlists and liked songs
- **Local files** — drop MP3/WAV/OGG/FLAC/M4A straight onto a deck for full-length tracks

## Spotify setup (one time)

UltraTune is a static site with no server, so it uses Spotify's
**Authorization Code + PKCE** flow with your own free Spotify app:

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create an app.
2. Add the site's own URL as a **Redirect URI** (the in-app setup dialog shows the exact value with a copy button).
3. Paste the app's **Client ID** into UltraTune's settings (⚙) and log in.

The token lives only in your browser's localStorage.

> **Why 30-second previews?** Spotify's full streams are DRM-protected, so no
> web app can legally route them through audio processing. UltraTune loads
> Spotify's preview clips (fully mixable) — for full tracks, load local files.

## Running locally

It's a static site — any web server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

> Open it via `http://` (a server), not `file://`, so Web Crypto and fetch work.

## Project structure

```
index.html      # markup: decks, mixer, library, Spotify setup modal
css/styles.css  # styling (dark, glassy, neon)
js/deck.js      # Web Audio engine: decks, EQ, filter, FX, recording
js/spotify.js   # Spotify PKCE auth + Web API client
js/app.js       # UI wiring: transport, waveforms, library, keyboard
```
