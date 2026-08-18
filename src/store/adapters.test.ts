/**
 * Run with:  node --test src/store/adapters.test.ts
 * (Node strips the types; imports need explicit .ts extensions and this file
 * must not import an enum - see protocol/wire.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type * as T from "../protocol/types.ts";
import { battleList, userToChip, chatLines, shortTime, describeFailure, statusBarKind } from "./adapters.ts";

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

test("the battle list sorts running games below waiting ones", () => {
  const rows = battleList({
    1: { BattleID: 1, IsRunning: true, PlayerCount: 12 } as T.BattleHeader,
    2: { BattleID: 2, PlayerCount: 3 } as T.BattleHeader,
    3: { BattleID: 3, PlayerCount: 9 } as T.BattleHeader,
  });
  assert.deepEqual(rows.map(r => r.id), [3, 2, 1]);
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
