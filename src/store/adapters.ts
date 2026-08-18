/**
 * Adapters from protocol shapes to the props the Shiro design components expect.
 * Kept separate so the design kit never has to know about the wire format.
 */
import type * as T from "../protocol/types";
import { AutohostMode, AutohostModeLabel, LoginResponse_Code, LoginResponse_CodeLabel } from "../protocol/enums";
import type { ConnectionState } from "./lobby";

export interface BattleRowModel {
  id: number;
  title: string;
  map: string;
  founder: string;
  players: number;
  maxPlayers: number;
  spectators: number;
  mode: string;
  locked: boolean;
  running: boolean;
  runningSince?: number;
  matchmaker: boolean;
}

/** BattleRow renders `runningSince` as elapsed mm:ss, so convert the timestamp. */
function elapsedSeconds(iso?: string): number | undefined {
  if (!iso) return undefined;
  const started = Date.parse(iso);
  if (Number.isNaN(started)) return undefined;
  return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

export function battleToRow(b: T.BattleHeader): BattleRowModel | null {
  if (b.BattleID == null) return null;
  return {
    id: b.BattleID,
    title: b.Title ?? "(untitled)",
    map: b.Map ?? "",
    founder: b.Founder ?? "",
    players: b.PlayerCount ?? 0,
    maxPlayers: b.MaxPlayers ?? 0,
    spectators: b.SpectatorCount ?? 0,
    mode: AutohostModeLabel[b.Mode ?? AutohostMode.None] ?? "Custom",
    locked: Boolean(b.Password),
    running: Boolean(b.IsRunning),
    runningSince: elapsedSeconds(b.RunningSince),
    matchmaker: Boolean(b.IsMatchMaker),
  };
}

export function battleList(battles: Record<number, T.BattleHeader>): BattleRowModel[] {
  return Object.values(battles)
    .map(battleToRow)
    .filter((b): b is BattleRowModel => b !== null)
    .sort((a, b) => Number(a.running) - Number(b.running) || b.players - a.players);
}

/** The three states AppShell's StatusBar knows about. */
export function statusBarKind(c: ConnectionState): "online" | "reconnecting" | "offline" {
  switch (c.kind) {
    case "online": return "online";
    case "connecting":
    case "connected":
    case "loggingIn": return "reconnecting";
    default: return "offline";
  }
}

/**
 * Turn a failed connection into copy a player can act on. Uses the upstream
 * [Description] strings so we say what the official client says.
 */
export function describeFailure(c: ConnectionState): string {
  if (c.kind === "rejected") {
    const label = LoginResponse_CodeLabel[c.code as LoginResponse_Code] ?? `error ${c.code}`;
    if (c.code === LoginResponse_Code.InvalidName) {
      // Names are case-sensitive in practice - see ARCHITECTURE.md section 5.
      return "No account with that name. Check the spelling and capitalisation.";
    }
    if (c.code === LoginResponse_Code.Banned && c.message) return `Banned: ${c.message}`;
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  if (c.kind === "disconnected") return `Lost connection: ${c.reason}`;
  return "Could not connect.";
}
