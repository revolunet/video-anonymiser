# VideoAnonymiser

A browser-based tool for redacting videos: black out parts of the frame and mute
sections of audio, then export the result — all without uploading anything anywhere.
Your video never leaves your machine; it's decoded, edited, and re-encoded entirely
in the browser.

## Features

- **Drop in a video** — drag & drop or pick a file, no upload, no account.
- **Draw stripes** — click "Add stripe", then drag on the paused video to draw a black
  censoring box over a region, for a specific time range.
- **Precise editing** — click a stripe to select it, drag its 4 corner handles to
  resize or reposition it, press `Backspace`/`d` to delete it.
- **Mute ranges** — silence any portion of the audio track.
- **Trim** — cut the video down to the part you want to export.
- **Timeline** — drag to move or resize stripes, mute ranges, and the trim window,
  with a live time tooltip while dragging. Overlapping segments automatically stack
  into separate lanes so nothing is hidden. Zoom in (buttons, slider, or Ctrl+scroll)
  for frame-accurate adjustments.
- **Frame-accurate scrubbing** — step one frame at a time, or hold the button down to
  keep stepping; jump to an exact time via the time field.
- **Export to MP4** — burns everything in and downloads a real `.mp4`, encoded with
  [ffmpeg.wasm](https://ffmpegwasm.netlify.app/) directly in your browser, with a
  progress bar while it works.

## Getting started

Requires [Node.js](https://nodejs.org/) 20+.

```bash
npm install
npm run dev
```

Then open the printed local URL in your browser.

### Other commands

```bash
npm run build    # type-check and build a production bundle into dist/
npm run preview  # serve the production build locally
```

## How it works

- **Editor**: [React](https://react.dev/) + TypeScript, styled with
  [Tailwind CSS](https://tailwindcss.com/), built with [Vite](https://vite.dev/).
- **Export**: [`@ffmpeg/ffmpeg`](https://www.npmjs.com/package/@ffmpeg/ffmpeg) runs a
  real FFmpeg build compiled to WebAssembly, in-page. Trimming-only exports use a fast
  stream copy; exports with stripes or mute ranges re-encode with `drawbox` and
  `volume` filters applied only where you placed them.
- Nothing is sent to a server at any point — the whole app is static files, and all
  processing happens on your own CPU.

## Deployment

Pushing to `main` builds the app and publishes it to GitHub Pages automatically (see
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). To enable it on a
fork or new repository, go to **Settings → Pages** and set the source to
**GitHub Actions** — no other configuration needed.

## Browser support

Needs a reasonably modern browser with WebAssembly support (recent Chrome, Firefox,
Safari, or Edge). Very large videos will take a while to export since encoding runs
single-threaded on your CPU rather than dedicated hardware.
