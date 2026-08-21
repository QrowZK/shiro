/**
 * Normalized lobby state.
 *
 * Every server message lands in `applyMessage`. Battle and user records are
 * merged, never replaced - see mergePatch in protocol/wire.ts for why.
 */
import { create } from "zustand";

import type { Message } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import { mergePatch } from "../protocol/wire.ts";
import type { RelayStatus } from "../net/connection.ts";
import type { SayPlace } from "../protocol/enums.ts";

/**
 * `SayPlace.MessageBox` restated as a literal - this module must not import a
 * TS enum, which the test runner's type-stripping loader refuses. The
 * annotation is checked against the generated enum at compile time.
 */
const PLACE_MESSAGE_BOX: SayPlace.MessageBox = 5;

export type ConnectionState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "loggingIn" }
  | { kind: "online" }
  | { kind: "disconnected"; reason: string }
  | { kind: "rejected"; code: number; message: string };

export interface ChatLine {
  time?: string;
  user?: string;
  text?: string;
  place: number;
  target?: string;
  emote: boolean;
  ring: boolean;
}

interface LobbyState {
  connection: ConnectionState;
  welcome?: T.Welcome;
  me?: string;
  sessionToken?: string;

  users: Record<string, T.User>;
  battles: Record<number, T.BattleHeader>;
  channels: Record<string, { name: string; users: string[] }>;
  chat: ChatLine[];

  /** Messages seen but not yet handled - useful while wiring the remaining screens. */
  unhandled: Record<string, number>;

  /** How many reconnects we have tried since the last good connection. */
  reconnect: number;

  /** Set when an admin threw us off; retrying would be pointless and rude. */
  kicked?: { reason: string };

  /**
   * Server messages meant to be read, not scrolled past - mutes, bans,
   * announcements. The official client shows these in a box, hence the name of
   * the SayPlace they arrive on.
   */
  notices: string[];

  setConnection: (c: ConnectionState) => void;
  setReconnect: (n: number) => void;
  applyRelayStatus: (s: RelayStatus) => void;
  applyMessage: (m: Message) => void;
  applyBatch: (ms: Message[]) => void;
  /** Forget who is online and what is open, keeping the session. */
  resetDirectory: () => void;
  clearKick: () => void;
  /** Dismiss the oldest notice. */
  clearNotice: () => void;
  reset: () => void;
}

const EMPTY = {
  users: {} as Record<string, T.User>,
  battles: {} as Record<number, T.BattleHeader>,
  channels: {} as Record<string, { name: string; users: string[] }>,
  chat: [] as ChatLine[],
  unhandled: {} as Record<string, number>,
  reconnect: 0,
  kicked: undefined as { reason: string } | undefined,
  notices: [] as string[],
};

/**
 * Fields of `User` that mean "no longer" when they are absent.
 *
 * `User` is broadcast as a whole record, not a patch: the server rebuilds it on
 * every change. So the merge rule that is right for `BattleHeader` - an absent
 * key means unchanged, because the server omits what did not change - is wrong
 * here in one direction. These four are the ones that can go from set to unset,
 * and `NullValueHandling.Ignore` drops them entirely when they do:
 *
 * - `BattleID`   leaving a room
 * - `AwaySince`  coming back
 * - `InGameSince` the game ending
 * - `PartyID`    leaving a party
 *
 * Merged the general way, none of them ever cleared: somebody who left a battle
 * stayed listed in it, and somebody who came back stayed greyed out as away,
 * until they disconnected entirely.
 */
const USER_CLEARED_WHEN_ABSENT = ["BattleID", "AwaySince", "InGameSince", "PartyID"] as const;

/** Merge a `User` broadcast, honouring the fields above. */
export function mergeUser(base: T.User | undefined, patch: T.User): T.User {
  const merged = mergePatch(base, patch) as T.User & Record<string, unknown>;
  for (const field of USER_CLEARED_WHEN_ABSENT) {
    if (patch[field] === undefined) delete merged[field];
  }
  return merged;
}

const MAX_CHAT = 500;

export const useLobby = create<LobbyState>((set, get) => ({
  connection: { kind: "idle" },
  ...EMPTY,

  setConnection: c => set({ connection: c }),
  setReconnect: n => set({ reconnect: n }),

  applyRelayStatus: s => {
    if (s.kind === "connecting") set({ connection: { kind: "connecting" } });
    else if (s.kind === "connected") set({ connection: { kind: "connected" } });
    else set({ connection: { kind: "disconnected", reason: s.reason } });
  },

  applyMessage: m => get().applyBatch([m]),

  /**
   * Apply a batch in one store write. The post-login flood is ~90 messages in
   * four seconds at 43 users online and scales with concurrency, so the caller
   * batches per animation frame rather than setting state per message.
   */
  applyBatch: messages => set(state => {
    const users = { ...state.users };
    const battles = { ...state.battles };
    const channels = { ...state.channels };
    const unhandled = { ...state.unhandled };
    let chat = state.chat;
    let patch: Partial<LobbyState> = {};

    for (const m of messages) {
      switch (m.cmd) {
        case "Welcome":
          patch.welcome = m.data;
          break;

        case "LoginResponse": {
          const d = m.data as T.LoginResponse;
          if (d.ResultCode === 0) {
            patch.me = d.Name;
            patch.sessionToken = d.SessionToken;
            patch.connection = { kind: "online" };
          } else {
            patch.connection = {
              kind: "rejected",
              code: d.ResultCode,
              message: d.BanReason ?? "",
            };
          }
          break;
        }

        case "User": {
          const u = m.data as T.User;
          if (u.Name) users[u.Name] = mergeUser(users[u.Name], u);
          break;
        }

        case "UserDisconnected": {
          const d = m.data as T.UserDisconnected;
          if (d.Name) delete users[d.Name];
          break;
        }

        case "BattleAdded":
        case "BattleUpdate": {
          const h = (m.data as T.BattleAdded).Header;
          if (h?.BattleID != null) battles[h.BattleID] = mergePatch(battles[h.BattleID], h);
          break;
        }

        case "DefaultEngineChanged":
          // The status bar reads the engine from Welcome, so keep it current.
          patch.welcome = { ...(state.welcome ?? {} as T.Welcome),
            Engine: (m.data as T.DefaultEngineChanged).Engine };
          break;

        case "DefaultGameChanged":
          patch.welcome = { ...(state.welcome ?? {} as T.Welcome),
            Game: (m.data as T.DefaultGameChanged).Game };
          break;

        case "KickFromServer":
          patch.kicked = { reason: (m.data as T.KickFromServer).Reason ?? "No reason given." };
          break;

        case "BattleRemoved":
          delete battles[(m.data as T.BattleRemoved).BattleID];
          break;

        case "JoinChannelResponse": {
          const d = m.data as T.JoinChannelResponse;
          const name = d.ChannelName ?? d.Channel?.ChannelName;
          if (d.Success && name) {
            channels[name] = channels[name] ?? { name, users: [] };
          }
          break;
        }

        case "ChannelUserAdded": {
          const d = m.data as T.ChannelUserAdded;
          if (d.ChannelName && d.UserName) {
            const c = channels[d.ChannelName] ?? { name: d.ChannelName, users: [] };
            if (!c.users.includes(d.UserName)) {
              channels[d.ChannelName] = { ...c, users: [...c.users, d.UserName] };
            }
          }
          break;
        }

        case "ChannelUserRemoved": {
          const d = m.data as T.ChannelUserRemoved;
          const c = d.ChannelName ? channels[d.ChannelName] : undefined;
          if (c && d.UserName) {
            channels[d.ChannelName!] = { ...c, users: c.users.filter(u => u !== d.UserName) };
          }
          break;
        }

        case "Say": {
          const d = m.data as T.Say;
          if (d.Place === PLACE_MESSAGE_BOX) {
            if (d.Text) patch.notices = [...(patch.notices ?? state.notices), d.Text];
            break;
          }
          if (chat === state.chat) chat = [...chat];
          chat.push({
            time: d.Time,
            user: d.User,
            text: d.Text,
            place: d.Place,
            target: d.Target,
            emote: d.IsEmote,
            ring: d.Ring,
          });
          break;
        }

        default:
          unhandled[m.cmd] = (unhandled[m.cmd] ?? 0) + 1;
      }
    }

    if (chat !== state.chat && chat.length > MAX_CHAT) chat = chat.slice(-MAX_CHAT);

    return { ...patch, users, battles, channels, chat, unhandled };
  }),

  /* A reconnect replays the whole directory, so the old one has to go first -
     otherwise battles that closed while we were away never disappear. Chat
     scrollback is deliberately kept: it is the one thing a player would lose. */
  resetDirectory: () => set({ users: {}, battles: {}, channels: {} }),

  /** Acknowledge the kick notice so the dialog can close. */
  clearKick: () => set({ kicked: undefined }),

  clearNotice: () => set(state => ({ notices: state.notices.slice(1) })),

  reset: () => set({ connection: { kind: "idle" }, welcome: undefined, me: undefined,
    sessionToken: undefined, ...EMPTY }),
}));
