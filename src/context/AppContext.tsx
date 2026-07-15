import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface Stripe {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  startTime: number;
  endTime: number;
}

export interface MuteRange {
  id: string;
  startTime: number;
  endTime: number;
}

export interface TimelineHandleSelection {
  scope: "stripe" | "mute" | "trim";
  id?: string;
  edge: "start" | "end";
}

export interface AppState {
  videoFile: File | null;
  videoUrl: string | null;
  videoDuration: number;
  trimStart: number;
  trimEnd: number;
  stripes: Stripe[];
  muteRanges: MuteRange[];
  isExporting: boolean;
  exportProgress: number;
  exportPhase: string;
  exportError: string | null;
  drawingMode: boolean;
  frameRate: number;
  selectedStripeId: string | null;
  selectedTimelineHandle: TimelineHandleSelection | null;
}

export type SetAppState = (partial: Partial<AppState>) => void;

const initialState: AppState = {
  videoFile: null,
  videoUrl: null,
  videoDuration: 0,
  trimStart: 0,
  trimEnd: 0,
  stripes: [],
  muteRanges: [],
  isExporting: false,
  exportProgress: 0,
  exportPhase: "",
  exportError: null,
  drawingMode: false,
  frameRate: 30,
  selectedStripeId: null,
  selectedTimelineHandle: null,
};

const StateContext = createContext<AppState | null>(null);
const SetStateContext = createContext<SetAppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setStateRaw] = useState<AppState>(initialState);
  const setState = useMemo<SetAppState>(
    () => (partial) => setStateRaw((s) => ({ ...s, ...partial })),
    [],
  );

  return (
    <StateContext.Provider value={state}>
      <SetStateContext.Provider value={setState}>
        {children}
      </SetStateContext.Provider>
    </StateContext.Provider>
  );
}

export function useAppState(): AppState {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

export function useSetAppState(): SetAppState {
  const ctx = useContext(SetStateContext);
  if (!ctx) throw new Error("useSetAppState must be used within AppStateProvider");
  return ctx;
}
