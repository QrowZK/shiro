/**
 * Friends and ignores.
 *
 * This is a feature slice - it registers with store/slices.ts at module load.
 *
 * The server owns the list: `FriendList` arrives after login and again after
 * every change, so nothing here is edited locally. Adding or removing goes out
 * as `SetAccountRelation` and comes back as a fresh list.
 *
 * Everything a friend row shows beyond the name - country, clan, rating,
 * whether they are online at all - lives in the core store's user directory,
 * because a friend is just a user we have flagged. Profiles (level, badges,
 * awards) live in store/history.ts, which already collects `UserProfile`.
 */
import { create } from "zustand";

import type { CommandName, Message, MessageMap } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import type { Relation } from "../protocol/enums.ts";
import { registerSlice } from "./slices.ts";

/**
 * `Relation` restated as literals - the unit tests run under Node's
 * type-stripping loader, which refuses a TS `enum`. The annotations are checked
 * against the generated enum at compile time. Same reasoning as store/chat.ts.
 */
const RELATION_NONE: Relation.None = 0;
const RELATION_FRIEND: Relation.Friend = 1;
const RELATION_IGNORE: Relation.Ignore = 2;

export interface FriendsState {
  friends: string[];
  ignores: string[];

  applyBatch: (messages: Message[]) => void;
  applyMessage: (m: Message) => void;
  add: (name: string) => void;
  remove: (name: string) => void;
  ignore: (name: string) => void;
  unignore: (name: string) => void;
  /** Ask the server for someone's profile; it replies with `UserProfile`. */
  requestProfile: (name: string) => void;
  reset: () => void;
}

const EMPTY = { friends: [] as string[], ignores: [] as string[] };

function tx<K extends CommandName>(cmd: K, data: MessageMap[K]): void {
  void import("../net/session")
    .then(m => m.send(cmd, data))
    .catch(err => console.error(`friends: ${cmd} failed:`, err));
}

export const useFriends = create<FriendsState>((set, get) => ({
  ...EMPTY,

  applyMessage: m => get().applyBatch([m]),

  applyBatch: messages => set(state => {
    let friends = state.friends;
    let ignores = state.ignores;

    for (const m of messages) {
      switch (m.cmd) {
        case "FriendList": {
          const d = m.data as T.FriendList;
          friends = (d.Friends ?? [])
            .map(f => f.Name)
            .filter((n): n is string => Boolean(n))
            .sort((a, b) => a.localeCompare(b));
          break;
        }

        case "FriendEntry": {
          // A single addition, outside a full list refresh.
          const d = m.data as T.FriendEntry;
          if (d.Name && !friends.includes(d.Name)) {
            friends = [...friends, d.Name].sort((a, b) => a.localeCompare(b));
          }
          break;
        }

        case "IgnoreList":
          ignores = ((m.data as T.IgnoreList).Ignores ?? []).slice().sort((a, b) => a.localeCompare(b));
          break;

        default:
          break;
      }
    }

    return { friends, ignores };
  }),

  /* The list is not updated locally: the server answers every relation change
     with a fresh FriendList, and pretending otherwise would show a friend who
     was actually rejected. */
  add: name => tx("SetAccountRelation", { TargetName: name, Relation: RELATION_FRIEND }),
  remove: name => tx("SetAccountRelation", { TargetName: name, Relation: RELATION_NONE }),
  ignore: name => tx("SetAccountRelation", { TargetName: name, Relation: RELATION_IGNORE }),
  unignore: name => tx("SetAccountRelation", { TargetName: name, Relation: RELATION_NONE }),

  requestProfile: name => tx("UserProfile", { Name: name } as MessageMap["UserProfile"]),

  reset: () => set({ ...EMPTY }),
}));

registerSlice(messages => useFriends.getState().applyBatch(messages));
