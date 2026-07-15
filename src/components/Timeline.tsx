import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAppState, useSetAppState, type MuteRange, type Stripe } from "../context/AppContext";

interface TimelineProps {
  currentTime: number;
  seek: (t: number) => void;
}

type DragKind =
  | "trim-start"
  | "trim-end"
  | "move-stripe"
  | "resize-stripe-left"
  | "resize-stripe-right"
  | "move-mute"
  | "resize-mute-left"
  | "resize-mute-right";

interface DragInfo {
  type: DragKind;
  id?: string;
  startClientX: number;
  orig: { start: number; end: number };
}

type Edge = "start" | "end" | "range";

interface Preview {
  scope: "trim" | "stripe" | "mute";
  id?: string;
  edge: Edge;
  start: number;
  end: number;
}

interface ZoomAnchor {
  ratio: number; // 0..1 fraction of the full duration to keep stable
  viewportFraction: number; // 0..1 fraction across the visible viewport where that point should land
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 40;

function edgeOf(type: DragKind): Edge {
  if (type === "trim-start" || type.endsWith("left")) return "start";
  if (type === "trim-end" || type.endsWith("right")) return "end";
  return "range";
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  if (m > 0) return `${m}:${s.toString().padStart(2, "0")}`;
  return s.toFixed(0);
}

function fmtTooltip(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  if (m > 0) return `${m}:${s.toFixed(1).padStart(4, "0")}`;
  return `${s.toFixed(1)}s`;
}

function rulerStep(dur: number): number {
  const target = dur / 12;
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) {
    if (s >= target) return s;
  }
  return 600;
}

function rulerTicks(dur: number, zoom: number): number[] {
  if (dur <= 0) return [];
  // Target the same on-screen tick density regardless of zoom, so zooming in reveals
  // more (finer-grained) ticks instead of just stretching the same sparse set out.
  const step = rulerStep(dur / zoom);
  const ticks: number[] = [];
  for (let t = 0; t <= dur; t += step) ticks.push(t);
  ticks.push(dur);
  return ticks;
}

function pct(v: number, total: number): string {
  if (total <= 0) return "0%";
  return `${(v / total) * 100}%`;
}

function assignLanes(items: { id: string; startTime: number; endTime: number }[]) {
  const laneOf = new Map<string, number>();
  const laneCountOf = new Map<string, number>();
  const order = [...items].sort((a, b) => a.startTime - b.startTime);

  let cluster: typeof order = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => end <= item.startTime + 1e-6);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.endTime); }
      else laneEnds[lane] = item.endTime;
      laneOf.set(item.id, lane);
    }
    const count = Math.max(1, laneEnds.length);
    for (const item of cluster) laneCountOf.set(item.id, count);
    cluster = [];
  };

  for (const item of order) {
    if (cluster.length > 0 && item.startTime > clusterEnd + 1e-6) {
      flush();
      clusterEnd = -Infinity;
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endTime);
  }
  flush();

  return { laneOf, laneCountOf };
}

function Tooltip({ children }: { children: ReactNode }) {
  return (
    <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-[10px] text-white font-mono pointer-events-none whitespace-nowrap z-30">
      {children}
    </div>
  );
}

export function Timeline({ currentTime, seek }: TimelineProps) {
  const state = useAppState();
  const setState = useSetAppState();
  const stateRef = useRef(state);
  stateRef.current = state;

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragInfo | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewRef = useRef<Preview | null>(null);

  const [zoom, setZoom] = useState(1);
  const pendingAnchorRef = useRef<ZoomAnchor | null>(null);

  function updatePreview(v: Preview | null) {
    previewRef.current = v;
    setPreview(v);
  }

  const dur = state.videoDuration;

  function zoomTo(nextZoom: number, anchor: ZoomAnchor) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    pendingAnchorRef.current = anchor;
    setZoom(clamped);
  }

  // After a zoom-driven re-render (content width changed), restore the anchor point
  // (playhead, or the point under the cursor for wheel-zoom) to where it visually was.
  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    const scrollEl = scrollRef.current;
    pendingAnchorRef.current = null;
    if (!anchor || !scrollEl) return;
    const viewportWidth = scrollEl.clientWidth;
    const contentWidth = viewportWidth * zoom;
    scrollEl.scrollLeft = anchor.ratio * contentWidth - anchor.viewportFraction * viewportWidth;
  }, [zoom]);

  // Keep the playhead in view while zoomed in, e.g. during playback.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || dur <= 0 || zoom <= 1) return;
    const viewportWidth = scrollEl.clientWidth;
    const contentWidth = viewportWidth * zoom;
    const playheadX = (currentTime / dur) * contentWidth;
    if (playheadX < scrollEl.scrollLeft || playheadX > scrollEl.scrollLeft + viewportWidth) {
      scrollEl.scrollLeft = playheadX - viewportWidth / 2;
    }
  }, [currentTime, dur, zoom]);

  function zoomInOut(factor: number) {
    const ratio = dur > 0 ? currentTime / dur : 0.5;
    zoomTo(zoom * factor, { ratio, viewportFraction: 0.5 });
  }

  function resetZoom() {
    zoomTo(1, { ratio: 0, viewportFraction: 0 });
  }

  // Ctrl+wheel zooms, anchored at the cursor; plain wheel/trackpad scroll pans normally.
  // Attached natively (not via React's onWheel, which is passive by default) so
  // preventDefault actually suppresses the browser's own page-zoom/scroll.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (dur <= 0) return;
      const rect = scrollEl!.getBoundingClientRect();
      const viewportFraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const contentWidth = rect.width * zoom;
      const contentX = scrollEl!.scrollLeft + viewportFraction * rect.width;
      const ratio = contentWidth > 0 ? contentX / contentWidth : 0;
      const factor = Math.exp(-e.deltaY * 0.01);
      zoomTo(zoom * factor, { ratio, viewportFraction });
    }
    scrollEl.addEventListener("wheel", onWheel, { passive: false });
    return () => scrollEl.removeEventListener("wheel", onWheel);
  }, [zoom, dur]);

  useEffect(() => {
    if (!isDragging) return;

    function dx2t(dxPx: number): number {
      const d = stateRef.current.videoDuration;
      const width = contentRef.current?.clientWidth || 1;
      if (d <= 0) return 0;
      return (dxPx / width) * d;
    }

    function onMove(e: MouseEvent) {
      const info = dragRef.current;
      if (!info) return;
      const d = stateRef.current.videoDuration;
      const dt = dx2t(e.clientX - info.startClientX);

      if (info.type === "trim-start") {
        const ns = Math.max(0, Math.min(info.orig.end - 0.1, info.orig.start + dt));
        updatePreview({ scope: "trim", edge: "start", start: ns, end: info.orig.end });
        return;
      }
      if (info.type === "trim-end") {
        const ne = Math.max(info.orig.start + 0.1, Math.min(d, info.orig.end + dt));
        updatePreview({ scope: "trim", edge: "end", start: info.orig.start, end: ne });
        return;
      }

      let ns = info.orig.start + dt;
      let ne = info.orig.end + dt;

      if (info.type.endsWith("left")) {
        ns = Math.max(0, Math.min(info.orig.end - 0.05, info.orig.start + dt));
        ne = info.orig.end;
      } else if (info.type.endsWith("right")) {
        ns = info.orig.start;
        ne = Math.max(info.orig.start + 0.05, info.orig.end + dt);
      } else {
        if (ns < 0) { ne -= ns; ns = 0; }
        if (ne > d) { ns -= ne - d; ne = d; }
        ns = Math.max(0, ns);
      }

      updatePreview({
        scope: info.type.includes("stripe") ? "stripe" : "mute",
        id: info.id,
        edge: edgeOf(info.type),
        start: ns,
        end: ne,
      });
    }

    function onUp() {
      const info = dragRef.current;
      const p = previewRef.current;
      dragRef.current = null;
      setIsDragging(false);
      if (info && p) {
        if (info.type === "trim-start" || info.type === "trim-end") {
          setState({ trimStart: p.start, trimEnd: p.end });
        } else if (info.type.includes("stripe")) {
          setState({
            stripes: stateRef.current.stripes.map((s) =>
              s.id === info.id ? { ...s, startTime: p.start, endTime: p.end } : s,
            ),
          });
        } else if (info.type.includes("mute")) {
          setState({
            muteRanges: stateRef.current.muteRanges.map((m) =>
              m.id === info.id ? { ...m, startTime: p.start, endTime: p.end } : m,
            ),
          });
        }
      }
      updatePreview(null);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, setState]);

  // Click outside any timeline handle deselects it.
  useEffect(() => {
    if (!state.selectedTimelineHandle) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("[data-timeline-handle]")) return;
      setState({ selectedTimelineHandle: null });
    }
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [state.selectedTimelineHandle, setState]);

  // Backspace / d deletes the stripe or mute range behind the selected handle.
  useEffect(() => {
    const sel = state.selectedTimelineHandle;
    if (!sel || sel.scope === "trim") return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key === "Backspace" || e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (sel!.scope === "stripe") {
          setState({
            stripes: stateRef.current.stripes.filter((s) => s.id !== sel!.id),
            selectedTimelineHandle: null,
          });
        } else {
          setState({
            muteRanges: stateRef.current.muteRanges.filter((m) => m.id !== sel!.id),
            selectedTimelineHandle: null,
          });
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.selectedTimelineHandle, setState]);

  function isHandleSelected(scope: "stripe" | "mute" | "trim", edge: "start" | "end", id?: string): boolean {
    const sel = state.selectedTimelineHandle;
    return !!sel && sel.scope === scope && sel.edge === edge && sel.id === id;
  }

  function startTrimDrag(e: React.MouseEvent, side: "start" | "end") {
    e.preventDefault();
    dragRef.current = {
      type: side === "start" ? "trim-start" : "trim-end",
      startClientX: e.clientX,
      orig: { start: state.trimStart, end: state.trimEnd },
    };
    updatePreview({ scope: "trim", edge: side, start: state.trimStart, end: state.trimEnd });
    setState({ selectedTimelineHandle: { scope: "trim", edge: side } });
    seek(side === "start" ? state.trimStart : state.trimEnd);
    setIsDragging(true);
  }

  function startSegDrag(
    e: React.MouseEvent,
    kind: "move" | "resize-left" | "resize-right",
    scope: "stripe" | "mute",
    item: { id: string; startTime: number; endTime: number },
  ) {
    e.preventDefault();
    e.stopPropagation();
    const type = (scope === "stripe"
      ? kind === "move" ? "move-stripe" : kind === "resize-left" ? "resize-stripe-left" : "resize-stripe-right"
      : kind === "move" ? "move-mute" : kind === "resize-left" ? "resize-mute-left" : "resize-mute-right") as DragKind;
    dragRef.current = {
      type,
      id: item.id,
      startClientX: e.clientX,
      orig: { start: item.startTime, end: item.endTime },
    };
    updatePreview({ scope, id: item.id, edge: edgeOf(type), start: item.startTime, end: item.endTime });
    if (kind !== "move") {
      const edge = kind === "resize-left" ? "start" : "end";
      setState({ selectedTimelineHandle: { scope, id: item.id, edge } });
      seek(edge === "start" ? item.startTime : item.endTime);
    }
    setIsDragging(true);
  }

  const stripeLanes = useMemo(() => assignLanes(state.stripes), [state.stripes]);
  const muteLanes = useMemo(() => assignLanes(state.muteRanges), [state.muteRanges]);

  function renderSeg(
    item: Stripe | MuteRange,
    scope: "stripe" | "mute",
    lanes: { laneOf: Map<string, number>; laneCountOf: Map<string, number> },
  ) {
    const match = preview && preview.scope === scope && preview.id === item.id ? preview : null;
    const start = match ? match.start : item.startTime;
    const end = match ? match.end : item.endTime;
    const lane = lanes.laneOf.get(item.id) ?? 0;
    const laneCount = lanes.laneCountOf.get(item.id) ?? 1;
    const top = laneCount > 1 ? `calc(${(lane / laneCount) * 100}% + 2px)` : "4px";
    const height = laneCount > 1 ? `calc(${100 / laneCount}% - 4px)` : "calc(100% - 8px)";
    const tc = scope === "stripe" ? "bg-red-600/50 border-red-400/70" : "bg-yellow-600/50 border-yellow-400/70";
    const hc = scope === "stripe" ? "bg-red-400" : "bg-yellow-400";

    return (
      <div
        key={item.id}
        className={`absolute rounded-[3px] border ${tc} cursor-grab active:cursor-grabbing min-w-[6px] z-10 hover:brightness-110`}
        style={{ left: pct(start, dur), width: `max(0.3%, ${pct(end - start, dur)})`, top, height }}
        onMouseDown={(e) => startSegDrag(e, "move", scope, item)}
      >
        <div
          data-timeline-handle
          className={`absolute left-0 top-0 bottom-0 w-2 ${hc} cursor-col-resize rounded-l-[3px] ${
            isHandleSelected(scope, "start", item.id) ? "ring-2 ring-white" : ""
          }`}
          onMouseDown={(e) => startSegDrag(e, "resize-left", scope, item)}
        >
          {match && match.edge === "start" && <Tooltip>{fmtTooltip(start)}</Tooltip>}
        </div>
        <div
          data-timeline-handle
          className={`absolute right-0 top-0 bottom-0 w-2 ${hc} cursor-col-resize rounded-r-[3px] ${
            isHandleSelected(scope, "end", item.id) ? "ring-2 ring-white" : ""
          }`}
          onMouseDown={(e) => startSegDrag(e, "resize-right", scope, item)}
        >
          {match && match.edge === "end" && <Tooltip>{fmtTooltip(end)}</Tooltip>}
        </div>
        {match && match.edge === "range" && <Tooltip>{fmtTooltip(start)} – {fmtTooltip(end)}</Tooltip>}
      </div>
    );
  }

  const trimMatch = preview && preview.scope === "trim" ? preview : null;
  const trimStart = trimMatch ? trimMatch.start : state.trimStart;
  const trimEnd = trimMatch ? trimMatch.end : state.trimEnd;

  return (
    <div className="w-full bg-zinc-900 rounded-lg overflow-hidden select-none">
      <div className="flex" style={{ height: 200 }}>
        <div className="w-14 shrink-0 border-r border-zinc-800 flex flex-col">
          <div className="h-7 border-b border-zinc-700 shrink-0" />
          <div className="flex-1 flex items-end justify-end pr-2 pb-1 text-[10px] font-semibold text-red-400/80">STRIPES</div>
          <div className="flex-1 flex items-end justify-end pr-2 pb-1 text-[10px] font-semibold text-yellow-400/80">MUTE</div>
          <div className="h-7 flex items-end justify-end pr-2 pb-1 text-[10px] font-semibold text-emerald-400/80">TRIM</div>
        </div>

        <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
          <div ref={contentRef} className="relative h-full" style={{ width: `${zoom * 100}%` }}>
            <div className="absolute inset-0 flex flex-col">
              <div className="relative h-7 border-b border-zinc-700 text-[10px] text-zinc-500 shrink-0 overflow-hidden">
                {dur > 0 && rulerTicks(dur, zoom).map((t, i) => (
                  <div key={i} className="absolute top-0 h-full flex flex-col justify-end pb-0.5" style={{ left: pct(t, dur) }}>
                    <span className="px-1">{fmt(t)}</span>
                    <div className="border-l border-zinc-600 h-2 ml-1" />
                  </div>
                ))}
              </div>
              <div className="flex-1 relative border-b border-zinc-800">
                {dur > 0 && state.stripes.map((s) => renderSeg(s, "stripe", stripeLanes))}
              </div>
              <div className="flex-1 relative border-b border-zinc-800">
                {dur > 0 && state.muteRanges.map((m) => renderSeg(m, "mute", muteLanes))}
              </div>
              <div className="h-7 relative">
                {dur > 0 && (
                  <div
                    className="absolute top-1 bottom-1 bg-emerald-600/30 border border-emerald-500/60 rounded-[3px]"
                    style={{ left: pct(trimStart, dur), width: `max(0.5%, ${pct(trimEnd - trimStart, dur)})` }}
                  >
                    <div
                      data-timeline-handle
                      className={`absolute left-0 top-0 bottom-0 w-3 bg-emerald-500 cursor-ew-resize rounded-l hover:w-4 z-10 ${
                        isHandleSelected("trim", "start") ? "ring-2 ring-white" : ""
                      }`}
                      onMouseDown={(e) => startTrimDrag(e, "start")}
                    >
                      {trimMatch && trimMatch.edge === "start" && <Tooltip>{fmtTooltip(trimStart)}</Tooltip>}
                    </div>
                    <div
                      data-timeline-handle
                      className={`absolute right-0 top-0 bottom-0 w-3 bg-emerald-500 cursor-ew-resize rounded-r hover:w-4 z-10 ${
                        isHandleSelected("trim", "end") ? "ring-2 ring-white" : ""
                      }`}
                      onMouseDown={(e) => startTrimDrag(e, "end")}
                    >
                      {trimMatch && trimMatch.edge === "end" && <Tooltip>{fmtTooltip(trimEnd)}</Tooltip>}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white/90 pointer-events-none z-20 shadow-lg"
              style={{ left: pct(currentTime, dur) }}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 py-1.5 border-t border-zinc-800 text-zinc-400">
        <button
          className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded px-2 py-0.5 text-xs"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => zoomInOut(1 / 1.6)}
        >
          − Zoom
        </button>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.1}
          value={zoom}
          onChange={(e) => zoomInOut(parseFloat(e.target.value) / zoom)}
          className="w-32"
        />
        <button
          className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded px-2 py-0.5 text-xs"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => zoomInOut(1.6)}
        >
          Zoom +
        </button>
        <span className="text-[10px] w-10 text-right tabular-nums">{zoom.toFixed(1)}x</span>
        <button
          className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded px-2 py-0.5 text-xs ml-1"
          disabled={zoom === 1}
          onClick={resetZoom}
        >
          Fit
        </button>
      </div>
    </div>
  );
}
