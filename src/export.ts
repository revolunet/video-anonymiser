import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { AppState, SetAppState } from "./context/AppContext";

let ffmpeg = new FFmpeg();
let loaded = false;

export async function exportVideo(state: AppState, setState: SetAppState): Promise<void> {
  if (!state.videoFile) return;

  // A stripe/mute window is only meaningful relative to a real duration. Some source
  // files (e.g. certain WebM recordings with no Duration/Cues in their container) never
  // resolve a valid video.duration in the browser at all — better to fail loudly here
  // than silently burn in a degenerate (near-zero or unbounded) enable-window.
  if ((state.stripes.length > 0 || state.muteRanges.length > 0) && !(Number.isFinite(state.videoDuration) && state.videoDuration > 0)) {
    setState({ exportError: "Couldn't determine the video's duration, so stripe/mute timing can't be trusted. Try a different export from your recording tool." });
    return;
  }

  setState({ isExporting: true, exportProgress: 0, exportPhase: "Loading engine…", exportError: null });

  const onProgress = ({ progress }: { progress: number }) => {
    // ffmpeg reports progress in [0,1], but can briefly overshoot on the final chunk.
    setState({ exportProgress: Math.min(1, Math.max(0, progress)), exportPhase: "Encoding…" });
  };
  const onLog = ({ message }: { message: string }) => console.log("[ffmpeg]", message);

  try {
    if (!loaded) {
      // Single-threaded core. The multi-threaded @ffmpeg/core-mt build is faster but
      // reliably crashes (an internal "printErr" TypeError) on larger re-encodes with
      // a drawbox filter — verified on 0.12.6 and 0.12.10 — so it's not used here.
      const base = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      });
      loaded = true;
    }

    setState({ exportPhase: "Encoding…" });

    const inputName = "input" + getExtension(state.videoFile.name);
    const outputName = "output.mp4";

    ffmpeg.writeFile(inputName, await fetchFile(state.videoFile));

    const args = buildArgs(state, inputName, outputName);
    console.log("[export] ffmpeg args:", args.join(" "));

    ffmpeg.on("log", onLog);
    ffmpeg.on("progress", onProgress);
    await ffmpeg.exec(args);

    const data = await ffmpeg.readFile(outputName) as BlobPart;
    const blob = new Blob([data], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = outputName;
    a.click();
    URL.revokeObjectURL(url);

    ffmpeg.deleteFile(inputName);
    ffmpeg.deleteFile(outputName);
  } catch (err) {
    console.error("Export failed:", err);
    setState({ exportError: err instanceof Error ? err.message : String(err) });
    // The wasm worker pool can be left in a broken state after a mid-encode crash;
    // start clean so the next attempt isn't doomed by the same wedged instance.
    try { ffmpeg.terminate(); } catch { /* already dead */ }
    ffmpeg = new FFmpeg();
    loaded = false;
  } finally {
    ffmpeg.off("progress", onProgress);
    ffmpeg.off("log", onLog);
    setState({ isExporting: false, exportProgress: 0, exportPhase: "" });
  }
}

function getExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i) : ".mp4";
}

// A stripe/mute enable-window must never reach ffmpeg as "Infinity"/"NaN" (not valid
// numeric literals in its filter expression syntax — the filter graph would fail to
// parse and the whole -vf/-af would silently not apply). Clamp to the known-good
// video duration instead, which by this point has already been validated as finite.
function safeTime(t: number, fallback: number): number {
  return Number.isFinite(t) ? t : fallback;
}

function buildArgs(state: AppState, input: string, output: string): string[] {
  const { trimStart, trimEnd, stripes, muteRanges, videoDuration } = state;

  const hasTrim = trimStart > 0 || trimEnd < videoDuration;
  const hasStripes = stripes.length > 0;
  const hasMute = muteRanges.length > 0;

  const needsReencode = hasStripes || hasMute;

  const args: string[] = [];

  if (needsReencode) {
    // Seek on the input side (before -i), not the output side: ffmpeg's demuxer can jump
    // straight to the trim point instead of decoding the whole discarded prefix first.
    if (hasTrim) args.push("-ss", String(trimStart));
    args.push("-i", input);
    if (hasTrim) args.push("-t", String(trimEnd - trimStart));

    if (hasStripes) {
      const filter = stripes
        .map((s) => {
          const st = Math.max(0, safeTime(s.startTime, 0) - trimStart);
          const et = Math.max(0, safeTime(s.endTime, videoDuration) - trimStart);
          return `drawbox=x=${s.x}:y=${s.y}:w=${s.w}:h=${s.h}:color=black:t=fill:enable='between(t,${st},${et})'`;
        })
        .join(",");
      args.push("-vf", filter);
    }

    if (hasMute) {
      const filter = muteRanges
        .map((m) => {
          const st = Math.max(0, safeTime(m.startTime, 0) - trimStart);
          const et = Math.max(0, safeTime(m.endTime, videoDuration) - trimStart);
          return `volume=enable='between(t,${st},${et})':volume=0`;
        })
        .join(",");
      args.push("-af", filter);
    }

    args.push("-c:v", "libx264", "-crf", "18", "-preset", "veryfast");
    args.push("-c:a", "aac");
  } else {
    if (hasTrim) {
      args.push("-ss", String(trimStart));
    }
    args.push("-i", input);
    if (hasTrim) {
      args.push("-to", String(trimEnd));
    }
    args.push("-c:v", "copy", "-c:a", "copy");
  }

  args.push("-y", output);

  return args;
}
