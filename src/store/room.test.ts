/**
 * Run with:  node --test src/store/room.test.ts
 * (Node strips the types; imports need explicit .ts extensions and this file
 * must not import an enum - see protocol/wire.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { Message } from "../protocol/registry.ts";
import type * as T from "../protocol/types.ts";
import { useRoom } from "./room.ts";
import { roomModel } from "./adapters.ts";

function msg<K extends string>(cmd: K, data: unknown): Message {
  return { cmd, data } as unknown as Message;
}

function fresh() {
  useRoom.getState().reset();
  return useRoom.getState();
}

const JOINED = msg("JoinBattleSuccess", {
  BattleID: 7,
  // One real modoption and one the table knows nothing about.
  Options: { noelo: "1", commshare: "1" },
  Players: [
    { Name: "Qrow", AllyNumber: 0 },
    { Name: "hexed", AllyNumber: 1 },
    { Name: "watcher", IsSpectator: true },
  ],
  Bots: [{ Name: "CAI-Brutal", AllyNumber: 1, AiLib: "CAI", Owner: "Qrow" }],
});

test("JoinBattleSuccess is a snapshot and replaces the previous room", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("JoinBattleSuccess", {
    BattleID: 9,
    Players: [{ Name: "someone", AllyNumber: 0 }],
  }));
  const s = useRoom.getState();
  assert.equal(s.battleID, 9);
  assert.deepEqual(Object.keys(s.players), ["someone"]);
  assert.deepEqual(s.bots, {});
  assert.deepEqual(s.modOptions, {});
});

test("a battle status patch merges rather than replaces", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  // Moving team must not wipe the spectator flag we already know about.
  useRoom.getState().applyMessage(msg("UpdateUserBattleStatus", { Name: "watcher", AllyNumber: 1 }));
  const w = useRoom.getState().players["watcher"];
  assert.equal(w.AllyNumber, 1);
  assert.equal(w.IsSpectator, true, "an omitted field means unchanged");
});

test("status updates outside a room are ignored", () => {
  fresh();
  useRoom.getState().applyMessage(msg("UpdateUserBattleStatus", { Name: "stray", AllyNumber: 0 }));
  assert.deepEqual(useRoom.getState().players, {});
});

test("bots can be added and removed", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("UpdateBotStatus", { Name: "CAI-Brutal", AllyNumber: 0 }));
  assert.equal(useRoom.getState().bots["CAI-Brutal"].AllyNumber, 0);
  assert.equal(useRoom.getState().bots["CAI-Brutal"].AiLib, "CAI", "merged, not replaced");
  useRoom.getState().applyMessage(msg("RemoveBot", { Name: "CAI-Brutal" }));
  assert.deepEqual(useRoom.getState().bots, {});
});

test("the room closing under us empties the room", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("BattleRemoved", { BattleID: 7 }));
  assert.equal(useRoom.getState().battleID, undefined);
});

test("someone else being removed leaves us where we are", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("BattleRemoved", { BattleID: 8 }));
  assert.equal(useRoom.getState().battleID, 7);
});

test("a kick aimed at another player is not a kick", () => {
  fresh();
  useRoom.getState().setMe("Qrow");
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("KickFromBattle", { BattleID: 7, Name: "hexed" }));
  assert.equal(useRoom.getState().battleID, 7);
  useRoom.getState().applyMessage(msg("KickFromBattle", { BattleID: 7, Name: "Qrow" }));
  assert.equal(useRoom.getState().battleID, undefined);
  assert.equal(useRoom.getState().me, "Qrow", "a kick is not a logout");
});

test("mod options are replaced wholesale, because SetModOptions is a snapshot", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("SetModOptions", { Options: { deathmode: "allunits" } }));
  assert.deepEqual(useRoom.getState().modOptions, { deathmode: "allunits" });
});

// ------------------------------------------------------------------ view ---

const HEADER: T.BattleHeader = {
  BattleID: 7,
  Title: "Teams 8v8",
  Map: "Comet Catcher Redux",
  Founder: "Qrow",
  IsRunning: false,
} as T.BattleHeader;

const USERS: Record<string, T.User> = {
  Qrow: { Name: "Qrow", Clan: "ZKF", Country: "GB", EffectiveElo: 1842.4, Level: 41 } as T.User,
  hexed: { Name: "hexed", Country: "US", EffectiveElo: 1790, Level: 33, AwaySince: "2026-08-18T10:00:00Z" } as T.User,
  watcher: { Name: "watcher" } as T.User,
};

test("the room view splits players, spectators and bots into columns", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  const s = useRoom.getState();
  const room = roomModel(HEADER, s.players, s.bots, USERS, s.modOptions)!;

  assert.equal(room.map, "Comet Catcher Redux", "display keeps the spaces");
  assert.deepEqual(room.teams.map(t => t.ally), [0, 1]);
  assert.deepEqual(room.teams[0].players.map(p => p.user.name), ["Qrow"]);
  assert.deepEqual(room.teams[1].players.map(p => p.user.name).sort(), ["CAI-Brutal", "hexed"]);
  assert.deepEqual(room.spectators.map(p => p.user.name), ["watcher"]);
  assert.equal(room.teams[0].players[0].host, true, "the founder is marked");
});

test("the view enriches players from the user directory", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  const s = useRoom.getState();
  const room = roomModel(HEADER, s.players, s.bots, USERS, s.modOptions)!;
  const qrow = room.teams[0].players[0].user;
  assert.equal(qrow.clan, "ZKF");
  assert.equal(qrow.elo, 1842, "elo is rounded for display");
  const hexed = room.teams[1].players.find(p => p.user.name === "hexed")!.user;
  assert.equal(hexed.presence, "away");
  const bot = room.teams[1].players.find(p => p.user.name === "CAI-Brutal")!.user;
  assert.equal(bot.bot, true);
  assert.equal(bot.elo, undefined, "a bot has no account to enrich from");
});

test("ally numbers are the ones present, not a range", () => {
  fresh();
  useRoom.getState().applyMessage(msg("JoinBattleSuccess", {
    BattleID: 7,
    Players: [{ Name: "a", AllyNumber: 0 }, { Name: "b", AllyNumber: 3 }],
  }));
  const s = useRoom.getState();
  const room = roomModel(HEADER, s.players, s.bots, {}, {})!;
  assert.deepEqual(room.teams.map(t => t.ally), [0, 3]);
});

test("options are shown by name, and a key we do not know is still shown", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  const s = useRoom.getState();
  const room = roomModel(HEADER, s.players, s.bots, USERS, s.modOptions)!;

  // Known options come first, by their upstream name rather than their key.
  assert.deepEqual(room.options.map(o => [o.label, o.value, o.known]), [
    ["No Elo", "1", true],
    ["commshare", "1", false],
  ]);
});

test("an option left at its default is not worth listing", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("SetModOptions", { Options: { noelo: "0" } }));
  const s = useRoom.getState();
  const room = roomModel(HEADER, s.players, s.bots, USERS, s.modOptions)!;
  assert.deepEqual(room.options, [], "noelo defaults to off");
});

test("no header means no room, rather than a half-rendered one", () => {
  assert.equal(roomModel(undefined, {}, {}, {}, {}), null);
});

// ----------------------------------------------------------------- polls ---

test("a poll is replaced on every vote, not merged", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("BattlePoll", {
    Topic: "Change map?", VotesToWin: 3, YesNoVote: true, MapSelection: false, NotifyPoll: true,
    Options: [{ Id: 1, Name: "yes", Votes: 1 }],
  }));
  useRoom.getState().applyMessage(msg("BattlePoll", {
    Topic: "Change map?", VotesToWin: 3, YesNoVote: true, MapSelection: false, NotifyPoll: true,
    Options: [{ Id: 1, Name: "yes", Votes: 2 }],
  }));
  assert.equal(useRoom.getState().poll!.Options![0].Votes, 2);
});

test("an outcome closes the poll and stays until the next one", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("BattlePoll", {
    Topic: "Change map?", VotesToWin: 3, YesNoVote: true, MapSelection: false, NotifyPoll: true,
  }));
  useRoom.getState().applyMessage(msg("BattlePollOutcome", {
    Topic: "Change map?", Message: "Map changed", Success: true, YesNoVote: true, MapSelection: false,
  }));
  assert.equal(useRoom.getState().poll, undefined);
  assert.equal(useRoom.getState().pollOutcome!.Message, "Map changed");

  useRoom.getState().applyMessage(msg("BattlePoll", {
    Topic: "Kick someone?", VotesToWin: 3, YesNoVote: true, MapSelection: false, NotifyPoll: true,
  }));
  assert.equal(useRoom.getState().pollOutcome, undefined, "a new vote clears the old result");
});

test("joining a different room drops the previous room's vote", () => {
  fresh();
  useRoom.getState().applyMessage(JOINED);
  useRoom.getState().applyMessage(msg("BattlePoll", {
    Topic: "Change map?", VotesToWin: 3, YesNoVote: true, MapSelection: false, NotifyPoll: true,
  }));
  useRoom.getState().applyMessage(msg("JoinBattleSuccess", { BattleID: 9, Players: [] }));
  assert.equal(useRoom.getState().poll, undefined);
});

test("a join asked to spectate defers the status until the room exists", () => {
  fresh();
  useRoom.getState().setMe("Qrow");
  useRoom.getState().join(7, undefined, true);
  assert.equal(useRoom.getState().pendingSpectate, true,
    "the status cannot be set before the server has put us in the room");
  useRoom.getState().applyMessage(JOINED);
  assert.equal(useRoom.getState().pendingSpectate, false, "and is spent on arrival");
});

test("an ordinary join does not silently spectate", () => {
  fresh();
  useRoom.getState().setMe("Qrow");
  useRoom.getState().join(7);
  assert.equal(useRoom.getState().pendingSpectate, false);
});

test("a forced join is acted on, and only when it names us", () => {
  fresh();
  useRoom.getState().setMe("Qrow");
  useRoom.getState().applyMessage(JOINED);
  // Someone else being moved is not our business.
  useRoom.getState().applyMessage(msg("ForceJoinBattle", { BattleID: 42, Name: "hexed" }));
  assert.equal(useRoom.getState().battleID, 7, "we stay where we are");
  // Ours clears any pending spectate request from an earlier join.
  useRoom.getState().join(99, undefined, true);
  useRoom.getState().applyMessage(msg("ForceJoinBattle", { BattleID: 42, Name: "Qrow" }));
  assert.equal(useRoom.getState().pendingSpectate, false);
});
