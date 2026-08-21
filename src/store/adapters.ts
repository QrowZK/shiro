/**
 * Adapters from protocol shapes to the props the Shiro design components expect.
 * Kept separate so the design kit never has to know about the wire format.
 */
import type * as T from "../protocol/types.ts";
import type { AutohostMode, LoginResponse_Code } from "../protocol/enums.ts";
import type { ConnectionState } from "./lobby.ts";
import { changedOptions, type ModOptionDisplay } from "../net/modOptions.ts";
import { playerRank, rankColour } from "../net/ranks.ts";

/**
 * `AutohostMode` and `LoginResponse_Code` restated as literals.
 *
 * The unit tests run under Node's type-stripping loader, which refuses a TS
 * `enum` - a runtime construct - so this module must not import one. The
 * annotations are checked against the generated enums at compile time, so if
 * upstream renumbers a case this file stops compiling rather than quietly
 * labelling every battle "Custom". Same reasoning as store/chat.ts.
 */
const MODE_NONE: AutohostMode.None = 0;
const MODE_PLANETWARS: AutohostMode.Planetwars = 2;
const MODE_1V1: AutohostMode.Game1v1 = 3;
const MODE_FFA: AutohostMode.GameFFA = 4;
const MODE_CHICKENS: AutohostMode.GameChickens = 5;
const MODE_TEAMS: AutohostMode.Teams = 6;

/** Display labels from the upstream [Description] attributes. */
const MODE_LABEL: Record<number, string> = {
  [MODE_NONE]: "Custom",
  [MODE_PLANETWARS]: "PlanetWars",
  [MODE_1V1]: "1v1",
  [MODE_FFA]: "FFA",
  [MODE_CHICKENS]: "Cooperative",
  [MODE_TEAMS]: "Teams",
};

const CODE_INVALID_NAME: LoginResponse_Code.InvalidName = 2;
const CODE_BANNED: LoginResponse_Code.Banned = 4;

/** The upstream [Description] strings, so we say what the official client says. */
const LOGIN_CODE_LABEL: Record<number, string> = {
  0: "Ok",
  2: "invalid name",
  3: "invalid password",
  4: "banned",
  5: "invalid steam token, are you in offline mode?",
  6: "banned, too many connection attempts",
  7: "your steam account is not linked yet, send ZK login or register",
  8: "your steam account is already linked to a different account",
  9: "sorry, the server is full, please retry later",
  10: "invalid RSA signature",
  11: "RSA signature could not be verified (pub key not known)",
};

/** The upstream [Description] strings for registration outcomes. */
const REGISTER_CODE_LABEL: Record<number, string> = {
  1: "You are already connected.",
  2: "That name is taken.",
  3: "That password is not acceptable.",
  4: "That account is banned.",
  5: "That name has characters the server will not accept.",
  6: "Invalid Steam token - are you in offline mode?",
  7: "That Steam account is already registered.",
  8: "Missing both password and token.",
  9: "Too many attempts. Wait a while before trying again.",
  10: "Already linked to Steam; log in instead.",
  11: "Already registered - log in with your password.",
};

/** Turn a failed registration into something a person can act on. */
export function describeRegisterFailure(code: number, message?: string): string {
  if (code === 4 && message) return `Banned: ${message}`;
  return REGISTER_CODE_LABEL[code] ?? `Registration failed (error ${code}).`;
}

function modeLabel(mode: number | undefined): string {
  return MODE_LABEL[mode ?? MODE_NONE] ?? "Custom";
}

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
    mode: modeLabel(b.Mode),
    locked: Boolean(b.Password),
    running: Boolean(b.IsRunning),
    runningSince: elapsedSeconds(b.RunningSince),
    matchmaker: Boolean(b.IsMatchMaker),
  };
}

/**
 * The battle list, busiest first.
 *
 * "Participants" is everyone in the room, spectators included: a 1v1 with a
 * dozen people watching is a busier room than an empty 16-slot lobby, and the
 * question this list answers is where everybody is.
 *
 * Ties break public before passworded, because a room you can join is a more
 * useful answer than one you cannot.
 *
 * Running games are no longer sorted to the bottom - the order above is the
 * whole order. The list has a "Hide running" filter for people who do not want
 * to see them at all, which is a better tool for that than a sort key nobody
 * asked for.
 */
export function battleList(battles: Record<number, T.BattleHeader>): BattleRowModel[] {
  const occupants = (b: BattleRowModel) => b.players + b.spectators;
  return Object.values(battles)
    .map(battleToRow)
    .filter((b): b is BattleRowModel => b !== null)
    .sort((a, b) =>
      occupants(b) - occupants(a)
      || Number(a.locked) - Number(b.locked)
      // Stable and predictable when a room ties on both, rather than whatever
      // order the server happened to mention them in.
      || a.title.localeCompare(b.title));
}

/**
 * The three states AppShell's StatusBar knows about.
 *
 * A dropped connection with a retry already scheduled is "reconnecting", not
 * "offline": the difference to a player is whether anything is being done about
 * it, and something is. Only a session with no retry pending - never logged in,
 * or torn down - reads as offline.
 */
export function statusBarKind(
  c: ConnectionState,
  reconnectAttempt = 0,
): "online" | "reconnecting" | "offline" {
  switch (c.kind) {
    case "online": return "online";
    case "connecting":
    case "connected":
    case "loggingIn": return "reconnecting";
    default: return reconnectAttempt > 0 ? "reconnecting" : "offline";
  }
}

/**
 * Turn a failed connection into copy a player can act on. Uses the upstream
 * [Description] strings so we say what the official client says.
 */
export function describeFailure(c: ConnectionState): string {
  if (c.kind === "rejected") {
    const label = LOGIN_CODE_LABEL[c.code] ?? `error ${c.code}`;
    if (c.code === CODE_INVALID_NAME) {
      // Names are case-sensitive in practice - see ARCHITECTURE.md section 5.
      return "No account with that name. Check the spelling and capitalisation.";
    }
    if (c.code === CODE_BANNED && c.message) return `Banned: ${c.message}`;
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  if (c.kind === "disconnected") return `Lost connection: ${c.reason}`;
  return "Could not connect.";
}

/* ------------------------------------------------------------------ room ---
 * The battle room screen wants teams, spectators and chips; the protocol gives
 * a header, a status map keyed by name and the global user directory. This is
 * where those meet.
 */

/** Factions the design kit has marks for. Real Planetwars faction names that
 *  are not among them get no mark rather than a wrong one. */
const FACTION_MARKS = new Set(["machines", "hegemony", "rising"]);

export interface ChipModel {
  name: string;
  clan?: string;
  country?: string;
  faction?: string;
  level?: number;
  elo?: number;
  /** The colour this player's rank icon carries. See src/net/ranks.ts. */
  eloTint?: string;
  bot?: boolean;
  admin?: boolean;
  presence: "online" | "away" | "room" | "ingame" | "offline";
}

export interface RoomPlayerModel {
  user: ChipModel;
  host?: boolean;
  party?: number;
  spectator?: boolean;
}

export interface RoomModel {
  id: number;
  title: string;
  map: string;
  /** What the room runs. Often Zero-K itself; sometimes Supreme-K or another
      custom game, which is the case worth showing. */
  game: string;
  founder: string;
  mode: string;
  running: boolean;
  /** What the host changed, by name. Defaults are not worth listing. */
  options: ModOptionDisplay[];
  teams: Array<{ ally: number; players: RoomPlayerModel[] }>;
  spectators: RoomPlayerModel[];
}

/**
 * A `User` record as the design kit's chips want it.
 *
 * Presence is derived, not sent: the protocol has no status field. `User` is
 * only broadcast for people who are connected, so someone absent from the
 * directory is offline - which is how a friend who logged off, or the author of
 * a chat line from before we connected, renders correctly.
 */
export function userToChip(u: T.User | undefined, name: string): ChipModel {
  const faction = u?.Faction?.toLowerCase();
  return {
    /* The Zero-K account name, never DisplayName. For a Steam-linked account
       DisplayName is the Steam persona, which is not the name anyone is known
       by in the lobby, is not what you type to add a friend, and is not what
       the server matches on. */
    name: u?.Name || name,
    clan: u?.Clan || undefined,
    country: u?.Country || undefined,
    faction: faction && FACTION_MARKS.has(faction) ? faction : undefined,
    level: u?.Level || undefined,
    elo: u?.EffectiveElo ? Math.round(u.EffectiveElo) : undefined,
    /* Tinted by rank, which is what the game tints the rating number by. The
       server sends the rank, so the Elo is only ever a last resort here. */
    eloTint: rankColour(playerRank({
      icon: u?.Icon, rank: u?.Rank, elo: u?.EffectiveElo || undefined,
    })),
    bot: u?.IsBot || undefined,
    admin: u?.IsAdmin || undefined,
    presence: !u ? "offline"
      : u.InGameSince ? "ingame"
      : u.AwaySince ? "away"
      : u.BattleID != null ? "room"
      : "online",
  };
}

/* ------------------------------------------------------------------ chat ---
 * `ChatLine` spreads its `user` prop into a `UserChip`, so it wants the whole
 * chip - clan, country, rating - not the bare name the store keeps. The store
 * is right to keep a name: it is what the wire carries, and the chip is a
 * snapshot that would go stale the moment the sender changed rooms. Joining
 * the two is a render-time concern, so it happens here.
 */
export interface ChatLineModel {
  id?: number;
  time?: string;
  text?: string;
  user?: ChipModel;
  emote: boolean;
  ring: boolean;
  system: boolean;
}

export interface StoredChatMessage {
  id?: number;
  time?: string;
  user?: string;
  text?: string;
  emote: boolean;
  ring: boolean;
  system: boolean;
}

/**
 * `ignored` drops lines rather than greying them: the point of ignoring someone
 * is not to read them. History is not rewritten - the messages stay in the
 * store, so un-ignoring brings the backlog back.
 */
export function chatLines(
  messages: readonly StoredChatMessage[],
  users: Record<string, T.User>,
  ignored?: ReadonlySet<string>,
): ChatLineModel[] {
  const visible = ignored && ignored.size
    ? messages.filter(m => !m.user || !ignored.has(m.user))
    : messages;
  return visible.map(m => ({
    id: m.id,
    time: shortTime(m.time),
    text: m.text,
    // A system notice has no sender, and must not get an empty chip.
    user: m.user ? userToChip(users[m.user], m.user) : undefined,
    emote: m.emote,
    ring: m.ring,
    system: m.system,
  }));
}

/**
 * `HH:MM` in local time. The server sends ISO-8601 UTC; a chat log stamped in
 * another timezone is worse than no stamp at all.
 */
export function shortTime(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Assemble the room view.
 *
 * Ally numbers are sparse and arbitrary - a 1v1 can be allies 0 and 3 - so
 * teams are the ally numbers actually present, in order, rather than a range.
 * Bots sit in their ally column beside the humans; that is where the engine
 * puts them and where a player looking for a fair game expects to count them.
 */
export function roomModel(
  battle: T.BattleHeader | undefined,
  players: Record<string, T.UpdateUserBattleStatus>,
  bots: Record<string, T.UpdateBotStatus>,
  users: Record<string, T.User>,
  modOptions: Record<string, string>,
): RoomModel | null {
  if (!battle || battle.BattleID == null) return null;

  const spectators: RoomPlayerModel[] = [];
  const byAlly = new Map<number, RoomPlayerModel[]>();
  const place = (ally: number, p: RoomPlayerModel) => {
    const list = byAlly.get(ally);
    if (list) list.push(p);
    else byAlly.set(ally, [p]);
  };

  for (const [name, status] of Object.entries(players)) {
    const entry: RoomPlayerModel = {
      user: userToChip(users[name], name),
      host: name === battle.Founder || undefined,
      party: users[name]?.PartyID || undefined,
    };
    if (status.IsSpectator) spectators.push({ ...entry, spectator: true });
    else place(status.AllyNumber ?? 0, entry);
  }

  for (const [name, bot] of Object.entries(bots)) {
    place(bot.AllyNumber ?? 0, {
      // A bot has no account, so there is no `User` record to enrich it with.
      user: { name, bot: true, presence: "room" },
    });
  }

  const teams = [...byAlly.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ally, list]) => ({
      ally,
      players: list.sort((a, b) => Number(b.host ?? 0) - Number(a.host ?? 0)
        || a.user.name.localeCompare(b.user.name)),
    }));

  return {
    id: battle.BattleID,
    title: battle.Title ?? "(untitled)",
    map: battle.Map ?? "",
    game: battle.Game ?? "",
    founder: battle.Founder ?? "",
    mode: modeLabel(battle.Mode),
    running: Boolean(battle.IsRunning),
    /* Only what the host changed. A room with all ninety options at their
       defaults has nothing to say, and upstream shows non-hosts the same
       thing. Names rather than keys, where we have a name. */
    options: changedOptions(modOptions),
    teams: teams.length ? teams : [{ ally: 0, players: [] }],
    spectators: spectators.sort((a, b) => a.user.name.localeCompare(b.user.name)),
  };
}
