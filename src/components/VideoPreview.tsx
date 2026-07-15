import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useAppState, useSetAppState, type MuteRange, type Stripe } from "../context/AppContext";
import { clamp } from "../lib/clamp";
import { exportVideo } from "../export";
import { PlaybackToolbar } from "./PlaybackToolbar";

interface VideoPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  currentTime: number;
  paused: boolean;
}

type Rect = { x: number; y: number; w: number; h: number };
type Corner = "tl" | "tr" | "bl" | "br";

type ActiveDrag =
  | { kind: "draw"; startX: number; startY: number }
  | { kind: "move"; id: string; orig: Rect; startX: number; startY: number }
  | { kind: "resize"; id: string; corner: Corner; orig: Rect; startX: number; startY: number };

const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];
const CORNER_POS: Record<Corner, string> = {
  tl: "top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  tr: "top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  bl: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  br: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
};

function pct(v: number, total: number): string {
  if (total <= 0) return "0%";
  return `${(v / total) * 100}%`;
}

export function VideoPreview({ videoRef, currentTime, paused }: VideoPreviewProps) {
  const state = useAppState();
  const setState = useSetAppState();
  const stateRef = useRef(state);
  stateRef.current = state;

  const videoWrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [overlayBox, setOverlayBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  const dragRef = useRef<ActiveDrag | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [drawPreview, setDrawPreview] = useState<Rect | null>(null);
  const [editDragPreview, setEditDragPreview] = useState<(Rect & { id: string }) | null>(null);
  const editDragPreviewRef = useRef<(Rect & { id: string }) | null>(null);

  function updateEditDragPreview(v: (Rect & { id: string }) | null) {
    editDragPreviewRef.current = v;
    setEditDragPreview(v);
  }

  // Keep canvas/overlay box aligned to the actual rendered <video> box (it can be letterboxed).
  useEffect(() => {
    const video = videoRef.current;
    const wrap = videoWrapRef.current;
    if (!video || !wrap) return;

    function sync() {
      const wrapRect = wrap!.getBoundingClientRect();
      const vRect = video!.getBoundingClientRect();
      setOverlayBox({
        left: vRect.left - wrapRect.left,
        top: vRect.top - wrapRect.top,
        width: vRect.width,
        height: vRect.height,
      });
    }

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(video);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    function onLoaded() {
      setNaturalSize({ width: video!.videoWidth, height: video!.videoHeight });
    }
    video.addEventListener("loadedmetadata", onLoaded);
    return () => video.removeEventListener("loadedmetadata", onLoaded);
  }, [videoRef]);

  // Draw the actual anonymisation boxes (the only thing that renders on the canvas).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stripe of state.stripes) {
      if (currentTime < stripe.startTime || currentTime > stripe.endTime) continue;
      const r = editDragPreview && editDragPreview.id === stripe.id ? editDragPreview : stripe;
      ctx.fillStyle = "black";
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }, [currentTime, state.stripes, editDragPreview, naturalSize]);

  function toVideoCoords(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !video.videoWidth) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = video.videoWidth / (rect.width || 1);
    const scaleY = video.videoHeight / (rect.height || 1);
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  useEffect(() => {
    if (!isDragging) return;

    function onMove(e: MouseEvent) {
      const info = dragRef.current;
      if (!info) return;
      const p = toVideoCoords(e);

      if (info.kind === "draw") {
        const x = Math.min(info.startX, p.x);
        const y = Math.min(info.startY, p.y);
        const w = Math.abs(p.x - info.startX);
        const h = Math.abs(p.y - info.startY);
        setDrawPreview({ x, y, w, h });
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const dx = p.x - info.startX;
      const dy = p.y - info.startY;
      const { orig } = info;
      const MIN = 4;
      let nx = orig.x, ny = orig.y, nw = orig.w, nh = orig.h;

      if (info.kind === "move") {
        nx = clamp(orig.x + dx, 0, Math.max(0, vw - orig.w));
        ny = clamp(orig.y + dy, 0, Math.max(0, vh - orig.h));
      } else {
        const x2 = orig.x + orig.w;
        const y2 = orig.y + orig.h;
        switch (info.corner) {
          case "tl":
            nx = clamp(orig.x + dx, 0, x2 - MIN);
            ny = clamp(orig.y + dy, 0, y2 - MIN);
            nw = x2 - nx;
            nh = y2 - ny;
            break;
          case "tr":
            ny = clamp(orig.y + dy, 0, y2 - MIN);
            nw = clamp(orig.w + dx, MIN, vw - orig.x);
            nh = y2 - ny;
            break;
          case "bl":
            nx = clamp(orig.x + dx, 0, x2 - MIN);
            nw = x2 - nx;
            nh = clamp(orig.h + dy, MIN, vh - orig.y);
            break;
          case "br":
            nw = clamp(orig.w + dx, MIN, vw - orig.x);
            nh = clamp(orig.h + dy, MIN, vh - orig.y);
            break;
        }
      }

      updateEditDragPreview({ id: info.id, x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) });
    }

    function onUp(e: MouseEvent) {
      const info = dragRef.current;
      dragRef.current = null;
      setIsDragging(false);

      if (!info) return;

      if (info.kind === "draw") {
        const p = toVideoCoords(e);
        const x = Math.min(info.startX, p.x);
        const y = Math.min(info.startY, p.y);
        const w = Math.abs(p.x - info.startX);
        const h = Math.abs(p.y - info.startY);
        setDrawPreview(null);
        if (w >= 4 && h >= 4) {
          const video = videoRef.current;
          const stripe: Stripe = {
            id: crypto.randomUUID(),
            x: Math.round(x),
            y: Math.round(y),
            w: Math.round(w),
            h: Math.round(h),
            startTime: video?.currentTime ?? 0,
            endTime: stateRef.current.videoDuration,
          };
          setState({ stripes: [...stateRef.current.stripes, stripe], drawingMode: false });
        } else {
          setState({ drawingMode: false });
        }
        return;
      }

      const prev = editDragPreviewRef.current;
      if (prev && prev.id === info.id) {
        setState({
          stripes: stateRef.current.stripes.map((s) =>
            s.id === info.id ? { ...s, x: prev.x, y: prev.y, w: prev.w, h: prev.h } : s,
          ),
        });
      }
      updateEditDragPreview(null);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  // Pause playback whenever "Add stripe" mode is turned on, so the video doesn't keep playing under the crosshair.
  useEffect(() => {
    if (state.drawingMode) videoRef.current?.pause();
  }, [state.drawingMode, videoRef]);

  // Click outside any stripe deselects.
  useEffect(() => {
    if (!state.selectedStripeId) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("[data-stripe-id]")) return;
      setState({ selectedStripeId: null });
    }
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [state.selectedStripeId, setState]);

  // Backspace / d deletes the selected stripe.
  useEffect(() => {
    const id = state.selectedStripeId;
    if (!id) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key === "Backspace" || e.key.toLowerCase() === "d") {
        e.preventDefault();
        setState({
          stripes: stateRef.current.stripes.filter((s) => s.id !== id),
          selectedStripeId: null,
        });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.selectedStripeId, setState]);

  function startMoveDrag(e: React.MouseEvent, stripe: Stripe) {
    e.preventDefault();
    setState({ selectedStripeId: stripe.id });
    const p = toVideoCoords(e);
    dragRef.current = {
      kind: "move",
      id: stripe.id,
      orig: { x: stripe.x, y: stripe.y, w: stripe.w, h: stripe.h },
      startX: p.x,
      startY: p.y,
    };
    setIsDragging(true);
  }

  function startResizeDrag(e: React.MouseEvent, stripe: Stripe, corner: Corner) {
    e.preventDefault();
    e.stopPropagation();
    setState({ selectedStripeId: stripe.id });
    const p = toVideoCoords(e);
    dragRef.current = {
      kind: "resize",
      id: stripe.id,
      corner,
      orig: { x: stripe.x, y: stripe.y, w: stripe.w, h: stripe.h },
      startX: p.x,
      startY: p.y,
    };
    setIsDragging(true);
  }

  function handleDrawMouseDown(e: React.MouseEvent) {
    const p = toVideoCoords(e);
    dragRef.current = { kind: "draw", startX: p.x, startY: p.y };
    setIsDragging(true);
  }

  // When a timeline handle is selected, frame-step / time-input edits move that
  // handle's position instead of only scrubbing playback.
  function applyHandleTime(t: number) {
    const sel = state.selectedTimelineHandle;
    if (!sel) return;
    if (sel.scope === "trim") {
      setState(sel.edge === "start" ? { trimStart: t } : { trimEnd: t });
    } else if (sel.scope === "stripe") {
      setState({
        stripes: state.stripes.map((s) =>
          s.id === sel.id ? { ...s, [sel.edge === "start" ? "startTime" : "endTime"]: t } : s,
        ),
      });
    } else if (sel.scope === "mute") {
      setState({
        muteRanges: state.muteRanges.map((m) =>
          m.id === sel.id ? { ...m, [sel.edge === "start" ? "startTime" : "endTime"]: t } : m,
        ),
      });
    }
  }

  function stepFrame(dir: 1 | -1) {
    const video = videoRef.current;
    if (!video) return;
    const dt = 1 / state.frameRate;
    let t = video.currentTime + dir * dt;
    t = Math.max(0, Math.min(t, video.duration || 0));
    video.currentTime = t;
    applyHandleTime(t);
  }

  function handleTimeChange(t: number) {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(t, video.duration || state.videoDuration));
    video.currentTime = clamped;
    applyHandleTime(clamped);
  }

  function handleAddMute() {
    const range: MuteRange = { id: crypto.randomUUID(), startTime: 0, endTime: Math.min(5, state.videoDuration) };
    setState({ muteRanges: [...state.muteRanges, range] });
  }

  const boxStyle: CSSProperties = {
    left: overlayBox.left,
    top: overlayBox.top,
    width: overlayBox.width,
    height: overlayBox.height,
  };

  const visibleStripes = state.stripes.filter((s) => currentTime >= s.startTime && currentTime <= s.endTime);

  return (
    <div className="h-full flex flex-col">
      <div ref={videoWrapRef} className="relative flex-1 min-h-0 w-full bg-black rounded-lg overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef}
          controls
          preload="auto"
          src={state.videoUrl ?? undefined}
          className="block w-auto h-auto max-w-full max-h-full"
        />
        <canvas ref={canvasRef} width={naturalSize.width} height={naturalSize.height} className="absolute pointer-events-none" style={boxStyle} />
        <div className="absolute pointer-events-none z-10" style={boxStyle}>
          {paused && state.drawingMode && (
            <div className="absolute inset-0 pointer-events-auto cursor-crosshair" onMouseDown={handleDrawMouseDown}>
              {drawPreview && (
                <div
                  className="absolute border-2 border-white bg-black/40 pointer-events-none"
                  style={{
                    left: pct(drawPreview.x, naturalSize.width),
                    top: pct(drawPreview.y, naturalSize.height),
                    width: pct(drawPreview.w, naturalSize.width),
                    height: pct(drawPreview.h, naturalSize.height),
                  }}
                />
              )}
            </div>
          )}

          {paused && visibleStripes.map((stripe) => {
            const r = editDragPreview && editDragPreview.id === stripe.id ? editDragPreview : stripe;
            const selected = stripe.id === state.selectedStripeId;
            return (
              <div
                key={stripe.id}
                data-stripe-id={stripe.id}
                className={`absolute pointer-events-auto cursor-move border-2 ${
                  selected ? "border-emerald-400" : "border-transparent hover:border-emerald-400/50"
                }`}
                style={{
                  left: pct(r.x, naturalSize.width),
                  top: pct(r.y, naturalSize.height),
                  width: pct(r.w, naturalSize.width),
                  height: pct(r.h, naturalSize.height),
                }}
                onMouseDown={(e) => startMoveDrag(e, stripe)}
              >
                {selected && CORNERS.map((corner) => (
                  <div
                    key={corner}
                    className={`absolute w-2.5 h-2.5 bg-emerald-400 border border-black rounded-sm pointer-events-auto ${CORNER_POS[corner]}`}
                    onMouseDown={(e) => startResizeDrag(e, stripe, corner)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <PlaybackToolbar
        currentTime={currentTime}
        duration={state.videoDuration}
        frameRate={state.frameRate}
        isExporting={state.isExporting}
        exportProgress={state.exportProgress}
        exportPhase={state.exportPhase}
        exportError={state.exportError}
        drawingMode={state.drawingMode}
        onStep={stepFrame}
        onTimeChange={handleTimeChange}
        onFpsChange={(fps) => setState({ frameRate: fps })}
        onAddMute={handleAddMute}
        onExport={() => exportVideo(state, setState)}
        onToggleDrawing={() => setState({ drawingMode: !state.drawingMode })}
      />
    </div>
  );
}
