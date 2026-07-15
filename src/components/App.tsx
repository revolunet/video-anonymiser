import { useEffect, useRef, useState } from "react";
import { AppStateProvider, useAppState, useSetAppState } from "../context/AppContext";
import { VideoPreview } from "./VideoPreview";
import { Timeline } from "./Timeline";

function DropZone({ onFile }: { onFile: (file: File) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith("video/")) onFile(file);
      }}
      className={`flex-1 min-h-0 w-full flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-12 text-center hover:border-emerald-600 transition-colors cursor-pointer ${
        dragOver ? "border-emerald-500" : "border-zinc-700"
      }`}
    >
      <p className="text-zinc-400 text-sm">Drop video here or click to browse</p>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

function EditorShell() {
  const setState = useSetAppState();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [paused, setPaused] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setCurrentTime(video.currentTime);
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);

    const onDurationChange = () => {
      const d = video.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      video.removeEventListener("durationchange", onDurationChange);
      video.currentTime = 0;
      setState({ videoDuration: d, trimEnd: d });
    };

    const onLoaded = () => {
      const d = video.duration;
      if (Number.isFinite(d) && d > 0) {
        setState({ videoDuration: d, trimEnd: d });
        return;
      }
      // Some containers (notably certain WebM recordings) report an unknown or Infinite
      // duration until the media has been seeked once. Force resolution the standard way:
      // seeking near the end makes the browser determine the real seekable range, which
      // fires durationchange with the correct value.
      video.addEventListener("durationchange", onDurationChange);
      video.currentTime = 1e10;
    };

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeking", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("loadedmetadata", onLoaded);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeking", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("durationchange", onDurationChange);
    };
  }, [setState]);

  function seek(t: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(t, video.duration || 0));
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0">
        <VideoPreview videoRef={videoRef} currentTime={currentTime} paused={paused} />
      </div>
      <div className="mt-4 shrink-0">
        <Timeline currentTime={currentTime} seek={seek} />
      </div>
    </div>
  );
}

function AppShell() {
  const state = useAppState();
  const setState = useSetAppState();

  function handleFile(file: File) {
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    const url = URL.createObjectURL(file);
    setState({
      videoFile: file,
      videoUrl: url,
      videoDuration: 0,
      trimStart: 0,
      trimEnd: 0,
      stripes: [],
      muteRanges: [],
      selectedStripeId: null,
      selectedTimelineHandle: null,
      drawingMode: false,
    });
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="text-center py-2 shrink-0">
        <h1 className="text-xl font-bold text-emerald-400">VideoAnonymiser</h1>
        <p className="text-xs text-zinc-500 mt-0.5">Drop a video to start editing</p>
      </header>
      <main className="flex-1 min-h-0 max-w-7xl w-full mx-auto px-4 pb-4 flex flex-col">
        {state.videoUrl ? <EditorShell /> : <DropZone onFile={handleFile} />}
      </main>
    </div>
  );
}

export function App() {
  return (
    <AppStateProvider>
      <AppShell />
    </AppStateProvider>
  );
}
