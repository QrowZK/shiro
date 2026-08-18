/**
 * Getting from "I am in a battle" to "the engine is running".
 *
 * This is a feature slice - it registers with store/slices.ts at module load.
 * The whole flow is four steps (docs/ARCHITECTURE.md section 6):
 *
 *   RequestConnectSpring -> ConnectSpring -> write script.txt -> spawn engine
 *
 * Only the first is ours to initiate, and even that is optional: the server
 * pushes `ConnectSpring` unprompted when a matchmaker game starts or when you
 * reconnect to a match already in progress. So the launch is driven by the
 * *arrival* of `ConnectSpring`, never by the button that asked for it. Press
 * nothing and a matchmaker game still starts correctly.
 *
 * Rust owns everything past that point - locating the install, the script, the
 * process - so this module stays testable in plain Node: `net/launch.ts`
 * reaches for Tauri at import time and is therefore imported lazily.
 */
import { create } from "zustand";

import type { Message } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import { registerSlice } from "./slices.ts";

export type GamePhase =
  | { kind: "idle" }
  | { kind: "launching"; title?: string }
  | { kind: "running"; pid: number; title?: string }
  | { kind: "failed"; reason: string };

export interface GameState {
  phase: GamePhase;
  /** The last connect details the server sent, kept for a retry. */
  last?: T.ConnectSpring;
  /** A battle we were in that is still running, offered by the server. */
  rejoin?: number;
  me?: string;

  applyBatch: (messages: Message[]) => void;
  applyMessage: (m: Message) => void;
  setMe: (name?: string) => void;
  /** Ask the server for connect details. Launching happens on the reply. */
  requestStart: (battleID: number, password?: string) => void;
  /** Accept or dismiss a `RejoinOption`. */
  takeRejoin: (accept: boolean) => void;
  /** Launch from connect details - called on arrival, or again by a retry. */
  launch: (c: T.ConnectSpring) => Promise<void>;
  setPhase: (p: GamePhase) => void;
  reset: () => void;
}

/** Set once, the first time we launch; the engine outlives any one match. */
let listening = false;

export const useGame = create<GameState>((set, get) => ({
  phase: { kind: "idle" },

  applyMessage: m => get().applyBatch([m]),

  applyBatch: messages => {
    for (const m of messages) {
      if (m.cmd === "LoginResponse") {
        const d = m.data as T.LoginResponse;
        if (d.ResultCode === 0 && d.Name) set({ me: d.Name });
      }
      if (m.cmd === "RejoinOption") {
        // Sent after login when a game we were in is still going. Purely an
        // offer: nothing happens until the player takes it.
        set({ rejoin: (m.data as T.RejoinOption).BattleID });
      }
      if (m.cmd === "ConnectSpring") {
        const d = m.data as T.ConnectSpring;
        set({ last: d, phase: { kind: "launching", title: d.Title } });
        void get().launch(d);
      }
    }
  },

  setMe: name => set({ me: name }),

  /** Take the server up on a rejoin offer, or drop it. */
  takeRejoin: (accept: boolean) => {
    const battleID = get().rejoin;
    set({ rejoin: undefined });
    if (accept && battleID != null) get().requestStart(battleID);
  },

  requestStart: (battleID, password) => {
    set({ phase: { kind: "launching" } });
    void import("../net/session.ts").then(({ send }) =>
      send("RequestConnectSpring", { BattleID: battleID, Password: password }));
  },

  launch: async c => {
    const me = get().me;
    if (!me) {
      set({ phase: { kind: "failed", reason: "Not logged in." } });
      return;
    }
    try {
      const { launchSpring, onGame } = await import("../net/launch.ts");
      if (!listening) {
        listening = true;
        await onGame(s => {
          if (s.kind === "launched") {
            set(state => ({ phase: { kind: "running", pid: s.pid, title: titleOf(state.phase) } }));
          } else if (s.kind === "exited") {
            // The debriefing arrives separately, on its own store slice.
            set({ phase: { kind: "idle" } });
          } else {
            set({ phase: { kind: "failed", reason: s.reason } });
          }
        });
      }
      const pid = await launchSpring({
        engine: c.Engine ?? "",
        ip: c.Ip ?? "",
        port: c.Port,
        myPlayerName: me,
        scriptPassword: c.ScriptPassword ?? "",
      });
      set(state => ({ phase: { kind: "running", pid, title: titleOf(state.phase) } }));
    } catch (err) {
      set({ phase: { kind: "failed", reason: String((err as Error)?.message ?? err) } });
    }
  },

  setPhase: p => set({ phase: p }),
  reset: () => set({ phase: { kind: "idle" }, last: undefined, rejoin: undefined, me: undefined }),
}));

function titleOf(p: GamePhase): string | undefined {
  return p.kind === "launching" || p.kind === "running" ? p.title : undefined;
}

registerSlice(messages => useGame.getState().applyBatch(messages));
