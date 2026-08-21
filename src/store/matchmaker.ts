/**
 * Matchmaker queues and the ready check.
 *
 * This is a feature slice - it registers with store/slices.ts at module load.
 *
 * The flow, all server-driven once you are queued:
 *
 *   MatchMakerSetup    -> which queues exist (once, after login)
 *   MatchMakerQueueRequest (ours) -> join or leave; an empty list leaves all
 *   MatchMakerStatus   -> who is waiting, repeated every few seconds
 *   AreYouReady        -> a match is forming; you have SecondsRemaining to say yes
 *   AreYouReadyUpdate  -> how many of the others have accepted
 *   AreYouReadyResult  -> it is starting, or it collapsed and you are back in queue
 *
 * The countdown is local. `AreYouReady` states the seconds once and the updates
 * that follow do not restate them, so the deadline is computed on arrival and
 * the UI ticks against it. Everything here takes `now` as an argument so the
 * tests are not at the mercy of the clock.
 */
import { create } from "zustand";

import type { CommandName, Message, MessageMap } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import { registerSlice } from "./slices.ts";

export interface ReadyCheck {
  /** Wall-clock ms when the offer expires. */
  expiresAt: number;
  quickPlay: boolean;
  minimumWinChance: number;
  /** True once the server has acknowledged our yes. */
  accepted: boolean;
  /** The server's read on whether this match will actually happen. */
  likelyToPlay: boolean;
  battleSize?: number;
  battleReady?: number;
}

export interface MatchmakerState {
  queues: T.MatchMakerSetup_Queue[];
  joined: string[];
  /** Players waiting, by queue name. */
  counts: Record<string, number>;
  /** Players already in a game, by queue name. */
  ingame: Record<string, number>;
  /** ISO-8601, when we joined; the UI shows elapsed time from it. */
  joinedTime?: string;
  /** Non-zero while banned for declining or dodging. */
  bannedSeconds?: number;
  check?: ReadyCheck;
  /** Set when a ready check collapsed rather than started a game. */
  lastFailure?: string;

  applyBatch: (messages: Message[], now?: number) => void;
  applyMessage: (m: Message, now?: number) => void;
  /** Join exactly these queues. The empty list leaves the matchmaker. */
  setQueues: (names: string[]) => void;
  /** Answer the ready check. */
  respond: (ready: boolean) => void;
  reset: () => void;
}

const EMPTY = {
  queues: [] as T.MatchMakerSetup_Queue[],
  joined: [] as string[],
  counts: {} as Record<string, number>,
  ingame: {} as Record<string, number>,
  joinedTime: undefined as string | undefined,
  bannedSeconds: undefined as number | undefined,
  check: undefined as ReadyCheck | undefined,
  lastFailure: undefined as string | undefined,
};

/**
 * Send a command without dragging `net/session` (and therefore Tauri) into this
 * module's import graph, so the reducer stays testable in plain Node. Failures
 * are logged, never thrown.
 */
function tx<K extends CommandName>(cmd: K, data: MessageMap[K]): void {
  void import("../net/session")
    .then(m => m.send(cmd, data))
    .catch(err => console.error(`matchmaker: ${cmd} failed:`, err));
}

export const useMatchmaker = create<MatchmakerState>((set, get) => ({
  ...EMPTY,

  applyMessage: (m, now) => get().applyBatch([m], now),

  applyBatch: (messages, now = Date.now()) => set(state => {
    const next: Partial<MatchmakerState> = {};
    let check = state.check;

    for (const m of messages) {
      switch (m.cmd) {
        case "MatchMakerSetup":
          next.queues = (m.data as T.MatchMakerSetup).PossibleQueues ?? [];
          break;

        case "MatchMakerStatus": {
          const d = m.data as T.MatchMakerStatus;
          next.joined = d.JoinedQueues ?? [];
          next.counts = d.QueueCounts ?? {};
          next.ingame = d.IngameCounts ?? {};
          next.joinedTime = d.JoinedTime;
          next.bannedSeconds = d.BannedSeconds || undefined;
          break;
        }

        case "AreYouReady": {
          const d = m.data as T.AreYouReady;
          check = {
            expiresAt: now + d.SecondsRemaining * 1000,
            quickPlay: d.QuickPlay,
            minimumWinChance: d.MinimumWinChance,
            accepted: false,
            likelyToPlay: true,
          };
          next.lastFailure = undefined;
          break;
        }

        case "AreYouReadyUpdate": {
          const d = m.data as T.AreYouReadyUpdate;
          // Arrives only during a check; ignore a stray one rather than
          // inventing a countdown we were never given.
          if (!check) break;
          check = {
            ...check,
            accepted: d.ReadyAccepted,
            likelyToPlay: d.LikelyToPlay,
            battleSize: d.YourBattleSize,
            battleReady: d.YourBattleReady,
          };
          break;
        }

        case "AreYouReadyResult": {
          const d = m.data as T.AreYouReadyResult;
          check = undefined;
          // A started battle announces itself with JoinBattleSuccess and then
          // ConnectSpring; nothing to do here but stop showing the dialog.
          next.lastFailure = d.IsBattleStarting
            ? undefined
            : d.AreYouBanned
              ? "You declined too many matches and are briefly banned from the queue."
              : "Somebody did not accept. You are back in the queue.";
          break;
        }

        default:
          break;
      }
    }

    return { ...next, check };
  }),

  setQueues: names => {
    // Optimistic: the server confirms with the next MatchMakerStatus.
    set({ joined: names });
    tx("MatchMakerQueueRequest", { Queues: names });
  },

  respond: ready => {
    const check = get().check;
    if (check) set({ check: { ...check, accepted: ready } });
    tx("AreYouReadyResponse", { Ready: ready });
    // Declining is final for this offer; the server will not send a result.
    if (!ready) set({ check: undefined });
  },

  reset: () => set({ ...EMPTY }),
}));

/** Seconds left on the ready check, floored at zero. */
export function secondsLeft(check: ReadyCheck | undefined, now: number = Date.now()): number {
  if (!check) return 0;
  return Math.max(0, Math.ceil((check.expiresAt - now) / 1000));
}

// ------------------------------------------------------------ categories ---

/**
 * The least a queue has to be for `groupQueues` to place it. The screen's rows
 * and the wire's `MatchMakerSetup_Queue` both widen to this.
 */
export interface QueueLike {
  /** The queue's `Name`, which is what `MatchMakerQueueRequest` carries. */
  id: string;
  label?: string;
  description?: string;
}

export interface QueueGroup<Q extends QueueLike> {
  id: string;
  label: string;
  queues: Q[];
}

/**
 * Team size, out of the name if it is there and the description if it is not.
 *
 * There is nothing on the wire that groups queues, and the obvious candidates
 * are not on the wire at all. `MatchMakerSetup.Queue` upstream declares `Mode`
 * (1v1 / Teams / GameChickens / FFA), `MinSize` and `MaxSize` - and marks every
 * one of them `[JsonIgnore]`. Our generated type carries them because
 * gen-protocol.mjs reads the C# members and does not know that attribute, but
 * they are never serialised and arrive undefined. What actually crosses the
 * socket is `Name`, `Description`, `Maps`, `Game` and `MaxPartySize`.
 *
 * `MaxPartySize` was the other candidate and it separates almost nothing: of
 * the queues the server runs today, 1v1 is 1, Sortie is 3, Coop is 5, and
 * Battle along with every casual queue from 2v2+ to 10v10+ is 6.
 *
 * So the size it is, and the server writes it down twice. Most queues are named
 * for it ("1v1 Narrow", "2v2+" ... "10v10+"); the few named for something else
 * state it in the first line of the description ("Sortie" -> "Play 2v2 or 3v3
 * with players of similar skill."). Reading the name first matters: the "1v1"
 * description also mentions "1v1 Narrow", and a description-first rule would
 * still land on 1v1 but only by luck.
 *
 * A queue with a size in neither - "Coop" is the only one today - becomes its
 * own category. That is also what happens to whatever Zero-K adds next, which
 * is the point of deriving this rather than writing the list down.
 */
const TEAM_SIZE = /(\d{1,2})v(\d{1,2})/;

/** Sorts last, for the queues no size could be read out of. */
const UNSIZED = Number.MAX_SAFE_INTEGER;

function categoryOf(q: QueueLike): { id: string; label: string; size: number } {
  const name = q.label || q.id;
  const m = TEAM_SIZE.exec(name) || TEAM_SIZE.exec(q.description || "");
  if (m) return { id: m[0], label: m[0], size: Number(m[1]) };
  return { id: q.id, label: name, size: UNSIZED };
}

/**
 * The server's queues, grouped by team size, smallest first, with the ones that
 * have no size in them last. Order within a category is the server's own.
 */
export function groupQueues<Q extends QueueLike>(queues: Q[]): QueueGroup<Q>[] {
  const sizes = new Map<string, number>();
  const groups = new Map<string, QueueGroup<Q>>();
  for (const q of queues) {
    const c = categoryOf(q);
    const group = groups.get(c.id);
    if (group) group.queues.push(q);
    else {
      groups.set(c.id, { id: c.id, label: c.label, queues: [q] });
      sizes.set(c.id, c.size);
    }
  }
  return [...groups.values()].sort((a, b) =>
    (sizes.get(a.id) ?? UNSIZED) - (sizes.get(b.id) ?? UNSIZED) || a.label.localeCompare(b.label));
}

registerSlice(messages => useMatchmaker.getState().applyBatch(messages));
