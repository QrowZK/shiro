/**
 * Download jobs.
 *
 * Deliberately NOT a `slices.ts` participant: those carry ZkLobbyServer protocol
 * messages, and these are Tauri events. It subscribes to `zks://content` once,
 * behind a `listening` flag, exactly as game.ts does for `zks://game`.
 */
import { create } from "zustand";

import type { ContentItem, ContentStatus, Outcome } from "../net/content";

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface Job {
  id: string;
  items: ContentItem[];
  state: JobState;
  percent: number;
  /** Latest thing worth saying out loud - a warning or an error, never the noise. */
  note?: string;
  /** Why it ended badly, in words a player can act on. */
  reason?: string;
  /** pr-downloader's stderr tail, for a bug report. Never shown by default. */
  log?: string;
  startedAt: number;
}

interface ContentState {
  jobs: Record<string, Job>;
  /** Newest first, for the Downloads screen. */
  order: string[];
  active?: string;

  apply: (s: ContentStatus) => void;
  fetch: (engine: string, items: ContentItem[], installRoot?: string) => Promise<string>;
  cancel: (id: string) => Promise<void>;
  /** Resolves when the job leaves a running state. What the launch blocks on. */
  settled: (id: string) => Promise<Job>;
  clearFinished: () => void;
  reset: () => void;
}

const OUTCOME_STATE: Record<string, JobState> = {
  ok: "done",
  killed: "cancelled",
};

function stateFor(outcome: Outcome): JobState {
  if (typeof outcome === "string") return OUTCOME_STATE[outcome] ?? "failed";
  return "failed";
}

let listening = false;

/** Subscribe once. Safe to call repeatedly; only the first call binds. */
async function ensureListening(): Promise<void> {
  if (listening) return;
  listening = true;
  try {
    const { onContent } = await import("../net/content");
    await onContent(s => useContent.getState().apply(s));
  } catch {
    // Outside Tauri there is no event source, and that is not an error.
    listening = false;
  }
}

export const useContent = create<ContentState>((set, get) => ({
  jobs: {},
  order: [],

  apply: s => set(state => {
    const jobs = { ...state.jobs };
    let order = state.order;
    let active = state.active;

    const patch = (id: string, next: Partial<Job>) => {
      const prev = jobs[id];
      if (!prev) return;
      jobs[id] = { ...prev, ...next };
    };

    switch (s.kind) {
      case "queued":
        jobs[s.id] = {
          id: s.id, items: s.items, state: "queued", percent: 0, startedAt: Date.now(),
        };
        order = [s.id, ...state.order.filter(x => x !== s.id)];
        break;
      case "started":
        patch(s.id, { state: "running" });
        active = s.id;
        break;
      case "progress":
        // Guard against a divide-by-zero total, which the format allows.
        patch(s.id, {
          state: "running",
          percent: s.total > 0 ? Math.round((s.done / s.total) * 100) : s.percent,
        });
        break;
      case "note":
        patch(s.id, { note: s.message });
        break;
      case "finished": {
        const next = stateFor(s.outcome);
        patch(s.id, {
          state: next,
          percent: next === "done" ? 100 : (jobs[s.id]?.percent ?? 0),
          reason: next === "done" ? undefined : s.message,
          log: s.log,
        });
        if (active === s.id) active = undefined;
        break;
      }
    }
    return { jobs, order, active };
  }),

  fetch: async (engine, items, installRoot) => {
    await ensureListening();
    const { contentFetch } = await import("../net/content");
    return contentFetch(engine, items, installRoot);
  },

  cancel: async id => {
    const { contentCancel } = await import("../net/content");
    await contentCancel(id);
  },

  settled: id => new Promise<Job>(resolve => {
    const done = (j?: Job) => j && j.state !== "queued" && j.state !== "running";
    const now = get().jobs[id];
    if (done(now)) return resolve(now as Job);
    const stop = useContent.subscribe(s => {
      const j = s.jobs[id];
      if (done(j)) {
        stop();
        resolve(j as Job);
      }
    });
  }),

  clearFinished: () => set(state => {
    const jobs: Record<string, Job> = {};
    for (const [id, j] of Object.entries(state.jobs)) {
      if (j.state === "queued" || j.state === "running") jobs[id] = j;
    }
    return { jobs, order: state.order.filter(id => jobs[id]) };
  }),

  reset: () => set({ jobs: {}, order: [], active: undefined }),
}));

/** Battles we have already looked at, so re-renders do not re-run the preflight. */
const prefetched = new Set<string>();

/**
 * Start fetching a battle's content as soon as you join the room, rather than
 * waiting for the launch.
 *
 * `BattleHeader` carries the game and map minutes before `ConnectSpring` does,
 * so the download can run while people are still picking teams instead of
 * stalling everyone at the start. Doing it only at launch made the feature
 * effectively invisible: you join a room, nothing happens, and the first sign
 * of trouble is the engine hanging.
 *
 * Best effort throughout. A failure here must never block joining a room — the
 * launch path runs its own preflight and is the one that actually gates.
 */
export async function prefetchForBattle(
  battleID: number,
  engine: string,
  game?: string,
  map?: string,
  installRoot?: string,
): Promise<void> {
  const key = `${battleID}:${game ?? ""}:${map ?? ""}`;
  if (prefetched.has(key)) return;
  prefetched.add(key);

  try {
    const { contentPreflight } = await import("../net/content");
    const pre = await contentPreflight(engine, game, map, installRoot);
    if (!pre.items.length || !pre.downloader || !pre.writable) return;
    await useContent.getState().fetch(engine, pre.items, installRoot);
  } catch {
    // Nothing to say here: the launch preflight will report it properly if it
    // still matters by then.
  }
}

/** Forget what we have looked at - used on logout and reconnect. */
export function clearPrefetchMemory(): void {
  prefetched.clear();
}
