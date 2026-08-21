/**
 * Run with:  node --test src/store/adapters.test.ts
 * (Node strips the types; imports need explicit .ts extensions and this file
 * must not import an enum - see protocol/wire.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type * as T from "../protocol/types.ts";
import { battleList, battleToRow, userToChip, chatLines, shortTime, describeFailure, statusBarKind, describeRegisterFailure, roomModel, syncMark } from "./adapters.ts";

const USERS: Record<string, T.User> = {
  hexed: { Name: "hexed", Clan: "ZKF", Country: "US", EffectiveElo: 1790.6, Level: 33 } as T.User,
  afk: { Name: "afk", AwaySince: "2026-08-18T09:00:00Z" } as T.User,
  playing: { Name: "playing", InGameSince: "2026-08-18T09:00:00Z" } as T.User,
  inroom: { Name: "inroom", BattleID: 4 } as T.User,
};

test("presence is derived, because the protocol has no status field", () => {
  assert.equal(userToChip(USERS.hexed, "hexed").presence, "online");
  assert.equal(userToChip(USERS.afk, "afk").presence, "away");
  assert.equal(userToChip(USERS.playing, "playing").presence, "ingame");
  assert.equal(userToChip(USERS.inroom, "inroom").presence, "room");
  assert.equal(userToChip(undefined, "gone").presence, "offline",
    "absent from the directory means not connected");
});

test("an unknown user still renders under their name", () => {
  const chip = userToChip(undefined, "someone");
  assert.equal(chip.name, "someone");
  assert.equal(chip.elo, undefined);
});

test("a faction the design kit has no mark for gets no mark", () => {
  assert.equal(userToChip({ Faction: "Dynasty" } as T.User, "x").faction, undefined);
  assert.equal(userToChip({ Faction: "Machines" } as T.User, "x").faction, "machines");
});

test("chat lines carry a whole chip, because that is what ChatLine spreads", () => {
  const [line] = chatLines([{ id: 1, user: "hexed", text: "hi", emote: false, ring: false, system: false }], USERS);
  assert.equal(typeof line.user, "object", "a bare name would spread into a chip as characters");
  assert.equal(line.user!.clan, "ZKF");
  assert.equal(line.user!.elo, 1791);
});

test("a system notice has no sender and must not get an empty chip", () => {
  const [line] = chatLines([{ id: 2, text: "x joined", emote: false, ring: false, system: true }], USERS);
  assert.equal(line.user, undefined);
});

test("timestamps render as local HH:MM, or not at all", () => {
  assert.equal(shortTime(undefined), undefined);
  assert.equal(shortTime("nonsense"), undefined);
  assert.match(shortTime("2026-08-18T09:51:00Z")!, /^\d{2}:\d{2}$/);
});

test("the battle list is busiest first", () => {
  const rows = battleList({
    1: { BattleID: 1, PlayerCount: 3 } as T.BattleHeader,
    2: { BattleID: 2, PlayerCount: 12 } as T.BattleHeader,
    3: { BattleID: 3, PlayerCount: 9 } as T.BattleHeader,
  });
  assert.deepEqual(rows.map(r => r.id), [2, 3, 1]);
});

test("spectators count as being in the room", () => {
  /* A 1v1 with a crowd watching is a busier room than a half-empty lobby,
     which is what "where is everybody" is really asking. */
  const rows = battleList({
    1: { BattleID: 1, PlayerCount: 8, SpectatorCount: 0 } as T.BattleHeader,
    2: { BattleID: 2, PlayerCount: 2, SpectatorCount: 12 } as T.BattleHeader,
  });
  assert.deepEqual(rows.map(r => r.id), [2, 1]);
});

test("a tie puts the room you can join first", () => {
  const rows = battleList({
    1: { BattleID: 1, Title: "a", PlayerCount: 4, Password: "x" } as T.BattleHeader,
    2: { BattleID: 2, Title: "b", PlayerCount: 4 } as T.BattleHeader,
  });
  assert.deepEqual(rows.map(r => r.id), [2, 1], "passworded sorts after open");
});

test("and a room tied on both still lands somewhere predictable", () => {
  // Otherwise the order is whatever the server happened to mention them in.
  const rows = battleList({
    7: { BattleID: 7, Title: "zulu", PlayerCount: 4 } as T.BattleHeader,
    9: { BattleID: 9, Title: "alpha", PlayerCount: 4 } as T.BattleHeader,
  });
  assert.deepEqual(rows.map(r => r.id), [9, 7]);
});

test("a running game is no longer pushed to the bottom", () => {
  /* It used to sort below everything. The list has a "Hide running" filter for
     people who do not want them, which is a better tool than a hidden rule. */
  const rows = battleList({
    1: { BattleID: 1, IsRunning: true, PlayerCount: 12 } as T.BattleHeader,
    2: { BattleID: 2, PlayerCount: 3 } as T.BattleHeader,
  });
  assert.deepEqual(rows.map(r => r.id), [1, 2]);
});

test("a locked battle is one with a password", () => {
  const [row] = battleList({ 1: { BattleID: 1, Password: "x" } as T.BattleHeader });
  assert.equal(row.locked, true);
});

test("login failures say what the official client says", () => {
  assert.match(describeFailure({ kind: "rejected", code: 2, message: "" }), /capitalisation/);
  assert.match(describeFailure({ kind: "rejected", code: 4, message: "cheating" }), /^Banned: cheating$/);
  assert.match(describeFailure({ kind: "rejected", code: 9, message: "" }), /server is full/);
  assert.match(describeFailure({ kind: "disconnected", reason: "timeout" }), /timeout/);
});

test("a drop with a retry pending is reconnecting, not offline", () => {
  const dropped = { kind: "disconnected" as const, reason: "reset by peer" };
  assert.equal(statusBarKind(dropped, 0), "offline", "nothing pending is genuinely offline");
  assert.equal(statusBarKind(dropped, 1), "reconnecting", "something is being done about it");
  assert.equal(statusBarKind({ kind: "online" }, 3), "online");
  assert.equal(statusBarKind({ kind: "loggingIn" }), "reconnecting");
});

test("registration failures name the actual problem", () => {
  assert.match(describeRegisterFailure(2), /name is taken/i);
  assert.match(describeRegisterFailure(4, "cheating"), /^Banned: cheating$/);
  assert.match(describeRegisterFailure(11), /log in with your password/i);
  assert.match(describeRegisterFailure(99), /error 99/);
});

/* ------------------------------------------------------------------ sync ---
   Three protocol states, three marks. The one that matters is `Unknown`: it is
   what a client that has never reported looks like, and `!start` treats it as
   unready without it being a claim that anybody lacks the map. */

test("the three sync states get three different marks", () => {
  assert.equal(syncMark(1), "ok");
  assert.equal(syncMark(2), "missing");
  assert.equal(syncMark(0), "downloading", "never reported is not the same as reported missing");
  assert.equal(syncMark(undefined), "downloading", "and neither is a status we were never sent");
});

const ROOM: T.BattleHeader = { BattleID: 5, Title: "t", Founder: "host", MaxPlayers: 8 } as T.BattleHeader;

function room(players: Record<string, Partial<T.UpdateUserBattleStatus>>,
  bots: Record<string, Partial<T.UpdateBotStatus>> = {},
  header: Partial<T.BattleHeader> = {}) {
  return roomModel({ ...ROOM, ...header } as T.BattleHeader,
    players as Record<string, T.UpdateUserBattleStatus>,
    bots as Record<string, T.UpdateBotStatus>, {}, {})!;
}

test("players carry their sync mark into the row", () => {
  const r = room({
    ready: { Name: "ready", AllyNumber: 0, Sync: 1 },
    missing: { Name: "missing", AllyNumber: 0, Sync: 2 },
    quiet: { Name: "quiet", AllyNumber: 0 },
  });
  const marks = Object.fromEntries(r.teams[0].players.map(p => [p.user.name, p.sync]));
  assert.deepEqual(marks, { ready: "ok", missing: "missing", quiet: "downloading" });
});

test("a bot is always ready, because it has nothing to download", () => {
  const r = room({}, { "CAI (1)": { Name: "CAI (1)", AllyNumber: 0, AiLib: "CAI" } });
  assert.equal(r.teams[0].players[0].sync, "ok");
});

test("a spectator gets no mark, because nobody is waiting for one", () => {
  const r = room({ watcher: { Name: "watcher", IsSpectator: true, Sync: 2 } });
  assert.equal(r.spectators[0].sync, undefined);
  assert.deepEqual(r.waitingOn, [], "and is never named as holding the start up");
});

test("the room names everyone !start would name, and nobody else", () => {
  const r = room({
    ready: { Name: "ready", AllyNumber: 0, Sync: 1 },
    zed: { Name: "zed", AllyNumber: 1, Sync: 2 },
    alice: { Name: "alice", AllyNumber: 1 },
    watcher: { Name: "watcher", IsSpectator: true },
  });
  // CmdStart gathers every non-spectator whose status is not Synced.
  assert.deepEqual(r.waitingOn, ["alice", "zed"]);
});

/* -------------------------------------------------------------- capacity ---
   There is no waitlist in the protocol. A full room silently spectates the
   arrival, so the least a list can do is say which rooms those are. */

test("a room is full when every player slot is taken", () => {
  const row = (PlayerCount: number, MaxPlayers: number) =>
    battleToRow({ BattleID: 1, PlayerCount, MaxPlayers } as T.BattleHeader)!;
  assert.equal(row(7, 8).full, false);
  assert.equal(row(8, 8).full, true);
  assert.equal(row(8, 8).queued, 0);
});

test("a room that never said how big it is cannot be full", () => {
  // Otherwise 0 >= 0 makes every unsized room look shut.
  const row = battleToRow({ BattleID: 1, PlayerCount: 0 } as T.BattleHeader)!;
  assert.equal(row.full, false);
});

test("players past the cap are the time queue, which is the nearest thing to a waitlist", () => {
  /* Only reachable with the server's time queue on: everyone counts as a
     player until `StartGame` spectates whoever claimed a slot last. */
  const row = battleToRow({ BattleID: 1, PlayerCount: 18, MaxPlayers: 16 } as T.BattleHeader)!;
  assert.equal(row.full, true);
  assert.equal(row.queued, 2);
});

test("the room counts its own slots rather than waiting for the server's number", () => {
  /* PlayerCount is re-broadcast on a five-second timer, and the roster beside
     it is instant. Bots take no slot - the server counts them separately. */
  const r = room({
    a: { Name: "a", AllyNumber: 0 },
    b: { Name: "b", AllyNumber: 1 },
    watcher: { Name: "watcher", IsSpectator: true },
  }, { "CAI (1)": { Name: "CAI (1)", AllyNumber: 1 } }, { MaxPlayers: 2, PlayerCount: 99 });
  assert.equal(r.players, 2);
  assert.equal(r.maxPlayers, 2);
  assert.equal(r.full, true);
  assert.equal(r.queued, 0);
});
