/**
 * The battle room you are currently in.
 *
 * This is a feature slice - it registers with store/slices.ts at module load
 * and receives the same per-animation-frame batch the core lobby store gets.
 *
 * Membership lives here rather than in store/lobby.ts because the two are
 * answering different questions. `lobby.battles` is the public directory: one
 * `BattleHeader` per open room, with a player *count* and no roster. This store
 * is the room you joined, and it exists only between `JoinBattleSuccess` and
 * leaving. The protocol offers no roster for any other battle, so there is
 * deliberately no way to hold more than one.
 *
 * Two things are worth knowing before extending this:
 *
 * - `JoinBattleSuccess` is a full snapshot and replaces state outright.
 *   Everything after it is a partial patch and is merged (see wire.mergePatch).
 * - There is no inbound "player left the room" message that names the player.
 *   `LeaveBattle` carries a BattleID and nothing else, so it cannot be used to
 *   drop one member - it is only ever about us. Departures show up as the
 *   server re-sending `User` with a different BattleID, which the core store
 *   already tracks, so the roster reader intersects the two.
 */
import { create } from "zustand";

import type { Message } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import { mergePatch } from "../protocol/wire.ts";
import { registerSlice } from "./slices.ts";

/** What the host dialog collects. Engine and game come from `Welcome`, so the
 *  room we open runs what everyone else is running. */
export interface HostOptions {
  title: string;
  map: string;
  maxPlayers: number;
  password?: string;
  engine?: string;
  game?: string;
}

export interface RoomState {
  /** The battle we are in, or undefined when we are not in one. */
  battleID?: number;
  /** Our own account name, learned from `LoginResponse`. */
  me?: string;
  /** Battle status by player name - ally number, spectator flag, sync. */
  players: Record<string, T.UpdateUserBattleStatus>;
  /** AI bots by name. */
  bots: Record<string, T.UpdateBotStatus>;
  modOptions: Record<string, string>;
  mapOptions: Record<string, string>;

  applyBatch: (messages: Message[]) => void;
  applyMessage: (m: Message) => void;
  setMe: (name?: string) => void;
  /** Ask the server to put us in a battle. The roster arrives as
      `JoinBattleSuccess`; a wrong password comes back as a `Say` from the
      server rather than an error, so nothing is optimistically applied here. */
  join: (battleID: number, password?: string) => void;
  /** Leave the current room. There is no acknowledgement to wait for. */
  leave: () => void;
  /** Open a battle of our own. Success arrives as `JoinBattleSuccess`. */
  host: (opts: HostOptions) => void;
  /** We left, were kicked, or the room closed. */
  clear: () => void;
  reset: () => void;
}

const EMPTY = {
  battleID: undefined as number | undefined,
  players: {} as Record<string, T.UpdateUserBattleStatus>,
  bots: {} as Record<string, T.UpdateBotStatus>,
  modOptions: {} as Record<string, string>,
  mapOptions: {} as Record<string, string>,
};

export const useRoom = create<RoomState>((set, get) => ({
  ...EMPTY,

  applyMessage: m => get().applyBatch([m]),

  applyBatch: messages => set(state => {
    let battleID = state.battleID;
    let players = state.players;
    let bots = state.bots;
    let modOptions = state.modOptions;
    let mapOptions = state.mapOptions;
    let me = state.me;

    /* Copy-on-write: most batches touch none of this, and the screens
       re-render on identity. */
    const mutPlayers = () => (players === state.players ? (players = { ...players }) : players);
    const mutBots = () => (bots === state.bots ? (bots = { ...bots }) : bots);

    for (const m of messages) {
      switch (m.cmd) {
        case "LoginResponse": {
          const d = m.data as T.LoginResponse;
          if (d.ResultCode === 0 && d.Name) me = d.Name;
          break;
        }

        case "JoinBattleSuccess": {
          const d = m.data as T.JoinBattleSuccess;
          battleID = d.BattleID;
          players = {};
          bots = {};
          modOptions = d.Options ?? {};
          mapOptions = d.MapOptions ?? {};
          for (const p of d.Players ?? []) if (p.Name) players[p.Name] = p;
          for (const b of d.Bots ?? []) if (b.Name) bots[b.Name] = b;
          break;
        }

        case "UpdateUserBattleStatus": {
          const d = m.data as T.UpdateUserBattleStatus;
          // Outside a room these are noise from a battle we just left.
          if (battleID == null || !d.Name) break;
          mutPlayers()[d.Name] = mergePatch(players[d.Name], d);
          break;
        }

        case "UpdateBotStatus": {
          const d = m.data as T.UpdateBotStatus;
          if (battleID == null || !d.Name) break;
          mutBots()[d.Name] = mergePatch(bots[d.Name], d);
          break;
        }

        case "RemoveBot": {
          const d = m.data as T.RemoveBot;
          if (d.Name && bots[d.Name]) delete mutBots()[d.Name];
          break;
        }

        case "SetModOptions":
          modOptions = (m.data as T.SetModOptions).Options ?? {};
          break;

        case "SetMapOptions":
          mapOptions = (m.data as T.SetMapOptions).Options ?? {};
          break;

        case "BattleRemoved": {
          // The host closed the room out from under us.
          if ((m.data as T.BattleRemoved).BattleID === battleID) {
            return { ...EMPTY, me };
          }
          break;
        }

        case "KickFromBattle": {
          // Broadcast to the whole room, so check it is aimed at us.
          const d = m.data as T.KickFromBattle;
          if (d.Name && d.Name === me) return { ...EMPTY, me };
          break;
        }

        default:
          break;
      }
    }

    return { battleID, players, bots, modOptions, mapOptions, me };
  }),

  setMe: name => set({ me: name }),

  join: (battleID, password) => {
    void import("../net/session.ts").then(({ send }) =>
      send("JoinBattle", { BattleID: battleID, Password: password }));
  },

  host: opts => {
    void import("../net/session.ts").then(({ send }) => send("OpenBattle", {
      Header: {
        Title: opts.title,
        Map: opts.map,
        MaxPlayers: opts.maxPlayers,
        // Omitted rather than sent empty: the server treats an empty string as
        // a password and then refuses your own join.
        Password: opts.password ? opts.password : undefined,
        Engine: opts.engine,
        Game: opts.game,
      },
    }));
  },

  leave: () => {
    const id = get().battleID;
    // Clear immediately: the server sends no acknowledgement, and leaving a
    // room we are no longer in is harmless.
    set(state => ({ ...EMPTY, me: state.me }));
    if (id != null) {
      void import("../net/session.ts").then(({ send }) => send("LeaveBattle", { BattleID: id }));
    }
  },
  /** Leaving a room keeps the session; only `reset` forgets who we are. */
  clear: () => set(state => ({ ...EMPTY, me: state.me })),
  reset: () => set({ ...EMPTY, me: undefined }),
}));

registerSlice(messages => useRoom.getState().applyBatch(messages));
