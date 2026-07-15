import { useEffect, useRef } from "react";

const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 80;

function useHoldRepeat(fn: () => void) {
  const timeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  function stop() {
    if (timeoutRef.current !== null) { window.clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (intervalRef.current !== null) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
  }

  function start() {
    fn();
    timeoutRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(fn, HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  }

  // Catch mouseup/drag-away outside the button so a stray release never leaves it repeating forever.
  useEffect(() => {
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mouseup", stop);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { onMouseDown: start, onMouseLeave: stop };
}

interface PlaybackToolbarProps {
  currentTime: number;
  duration: number;
  frameRate: number;
  isExporting: boolean;
  exportProgress: number;
  exportPhase: string;
  exportError: string | null;
  drawingMode: boolean;
  onStep: (dir: 1 | -1) => void;
  onTimeChange: (t: number) => void;
  onFpsChange: (fps: number) => void;
  onAddMute: () => void;
  onExport: () => void;
  onToggleDrawing: () => void;
}

export function PlaybackToolbar({
  currentTime,
  duration,
  frameRate,
  isExporting,
  exportProgress,
  exportPhase,
  exportError,
  drawingMode,
  onStep,
  onTimeChange,
  onFpsChange,
  onAddMute,
  onExport,
  onToggleDrawing,
}: PlaybackToolbarProps) {
  const prevHold = useHoldRepeat(() => onStep(-1));
  const nextHold = useHoldRepeat(() => onStep(1));

  return (
    <div className="mt-2 shrink-0">
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <button
          className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded px-3 py-1 text-sm"
          disabled={currentTime <= 0}
          onMouseDown={prevHold.onMouseDown}
          onMouseLeave={prevHold.onMouseLeave}
        >
          ◀ Frame
        </button>
        <input
          type="number"
          step={1 / frameRate}
          value={Number(currentTime.toFixed(3))}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (!Number.isNaN(val)) onTimeChange(val);
          }}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs w-20 text-center"
        />
        <button
          className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded px-3 py-1 text-sm"
          disabled={currentTime >= duration}
          onMouseDown={nextHold.onMouseDown}
          onMouseLeave={nextHold.onMouseLeave}
        >
          Frame ▶
        </button>

        <span className="text-xs text-zinc-500 ml-1">fps:</span>
        <input
          type="number"
          min={1}
          max={120}
          step={1}
          value={frameRate}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            if (val > 0) onFpsChange(val);
          }}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs w-16 text-center"
        />

        <button
          onClick={onToggleDrawing}
          className={
            drawingMode
              ? "text-xs bg-red-700 hover:bg-red-600 px-3 py-1 rounded font-medium ml-2"
              : "text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1 rounded font-medium ml-2"
          }
        >
          {drawingMode ? "✕ Cancel" : "✏️ Add stripe"}
        </button>

        <button onClick={onAddMute} className="text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1 rounded font-medium">
          + Add mute
        </button>

        <button
          disabled={isExporting}
          onClick={onExport}
          className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed font-semibold px-4 py-1.5 rounded-lg text-sm ml-2"
        >
          {isExporting ? "Processing…" : "Export & Download"}
        </button>
      </div>

      {isExporting && (
        <div className="flex items-center gap-2 mt-2 max-w-md mx-auto">
          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-150"
              style={{ width: `${Math.round(exportProgress * 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-zinc-500 w-24 shrink-0 text-right">
            {exportPhase} {exportProgress > 0 ? `${Math.round(exportProgress * 100)}%` : ""}
          </span>
        </div>
      )}

      {exportError && !isExporting && (
        <p className="text-[10px] text-red-400 text-center mt-2 max-w-md mx-auto">
          Export failed: {exportError}
        </p>
      )}
    </div>
  );
}
