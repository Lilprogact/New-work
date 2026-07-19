# ⚡ Morphly

A sleek, privacy-first file converter that runs **entirely in your browser**.
Drop in videos, audio or images and convert them to 20+ formats — no uploads,
no servers, no sign-ups.

## Features

- **Video** → MP4, WebM, MOV, MKV, AVI, GIF, or extract audio to MP3 / WAV / OGG
- **Audio** → MP3, WAV, OGG, FLAC, M4A, AAC
- **Images** → PNG, JPG, WebP, GIF, BMP, TIFF
- Drag & drop multiple files, convert them all with one click
- Live progress bars for long conversions
- 100% client-side: files never leave your device

## How it works

- Image conversions to PNG / JPG / WebP happen instantly via the Canvas API.
- Everything else runs through [FFmpeg](https://ffmpeg.org/) compiled to
  WebAssembly ([ffmpeg.wasm](https://ffmpegwasm.netlify.app/)), lazily loaded
  from a CDN (~30 MB, one time) the first time it's needed.

## Running locally

It's a static site — any web server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

> Note: open it via `http://` (a server), not `file://`, so the WebAssembly
> engine can load.

## Deploying

Push to any static host — GitHub Pages, Netlify, Vercel, Cloudflare Pages.
No build step, no backend.

## Project structure

```
index.html      # markup
css/styles.css  # styling (dark, glassy, animated)
js/app.js       # drag & drop, queue, canvas + ffmpeg.wasm conversion
```
