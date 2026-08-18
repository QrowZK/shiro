/**
 * Commands the website sends to the lobby.
 *
 * Pressing "join" or "add friend" on zero-k.info sends `SiteToLobbyCommand`
 * down the connection you are already logged in on. The payload is one string
 * in the format ZeroKLobby's navigation control accepts:
 *
 *   [zk://]<path>[@action[:arg]][@action[:arg]]...
 *
 * The path is a place to go - `battles`, `chat/channel/zk`, or an http URL to
 * open outside. Each `@` segment is an action to perform first
 * (`NavigationControl.Path` setter and `ActionHandler.PerformAction` upstream).
 *
 * Parsing is pure and lives here; what to do about it is the app's business,
 * because half the actions are navigation and the other half are protocol.
 */
import { create } from "zustand";

import type { Message } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import { registerSlice } from "./slices.ts";

export interface SiteAction {
  command: string;
  arg: string;
}

export interface SiteCommand {
  /** The navigation target, possibly empty when the command is all actions. */
  path: string;
  actions: SiteAction[];
}

/**
 * Split a site command into a path and its actions.
 *
 * The `zk://` prefix is optional and case-insensitive; an action's argument is
 * everything after the first colon, because map names and URLs contain them.
 */
export function parseSiteCommand(raw: string): SiteCommand {
  let value = raw.trim();
  if (value.toLowerCase().startsWith("zk://")) value = value.slice(5);

  const parts = value.split("@");
  const actions: SiteAction[] = [];
  for (const part of parts.slice(1)) {
    if (!part) continue;
    const colon = part.indexOf(":");
    actions.push(colon < 0
      ? { command: part, arg: "" }
      : { command: part.slice(0, colon), arg: part.slice(colon + 1) });
  }
  return { path: parts[0] ?? "", actions };
}

/** `chat/channel/zk` -> `zk`. Anything else is not a channel. */
export function channelOf(path: string): string | undefined {
  const parts = path.split("/");
  return parts[0] === "chat" && parts[1] === "channel" && parts[2] ? parts[2] : undefined;
}

export function isExternalUrl(path: string): boolean {
  return /^(https?|file):\/\//i.test(path) || path.startsWith("www.");
}

export interface SiteState {
  /** The command waiting to be acted on, if any. */
  pending?: SiteCommand;
  applyBatch: (messages: Message[]) => void;
  applyMessage: (m: Message) => void;
  /** Taken by the app once it has acted. */
  take: () => SiteCommand | undefined;
  reset: () => void;
}

export const useSite = create<SiteState>((set, get) => ({
  applyMessage: m => get().applyBatch([m]),

  applyBatch: messages => {
    for (const m of messages) {
      if (m.cmd !== "SiteToLobbyCommand") continue;
      const raw = (m.data as T.SiteToLobbyCommand).Command;
      // Only the newest matters: these arrive from a click, one at a time.
      if (raw) set({ pending: parseSiteCommand(raw) });
    }
  },

  take: () => {
    const pending = get().pending;
    if (pending) set({ pending: undefined });
    return pending;
  },

  reset: () => set({ pending: undefined }),
}));

registerSlice(messages => useSite.getState().applyBatch(messages));
