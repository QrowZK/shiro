/**
 * Run with:  node --test src/store/matchmaker.test.ts
 * (Node strips the types; imports need explicit .ts extensions and this file
 * must not import an enum - see protocol/wire.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { Message } from "../protocol/registry.ts";
import { useMatchmaker, secondsLeft } from "./matchmaker.ts";

function msg(cmd: string, data: unknown): Message {
  return { cmd, data } as unknown as Message;
}

const T0 = 1_700_000_000_000;

/* Anything that sends reaches `net/session`, which reaches Tauri at import time
   and so cannot resolve under `node --test`. The store logs that and carries on,
   which is the right behaviour and the wrong thing to print here - a stack trace
   in a passing run reads as a failure. Drop that one line and nothing else. */
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("matchmaker: ")) return;
  realError(...args);
};

function fresh() {
  useMatchmaker.getState().reset();
  return useMatchmaker.getState();
}

const SETUP = msg("MatchMakerSetup", {
  PossibleQueues: [
    { Name: "1v1", Description: "1v1", MaxPartySize: 1, MaxSize: 2, MinSize: 2, Mode: 3,
      UseWinChanceLimit: false, UseCasualElo: false, MinWinChanceMult: 0, MinWinChanceOffset: 0,
      UseHandicap: false, EloCutOffExponent: 1 },
  ],
});

test("the queue list is whatever the server offers", () => {
  fresh();
  useMatchmaker.getState().applyMessage(SETUP, T0);
  assert.equal(useMatchmaker.getState().queues.length, 1);
  assert.equal(useMatchmaker.getState().queues[0].Name, "1v1");
});

test("status is the authority on which queues we are in", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("MatchMakerStatus", {
    JoinedQueues: ["Teams"], QueueCounts: { Teams: 21 }, IngameCounts: { Teams: 14 },
    JoinedTime: "2026-08-18T10:00:00Z", UserCount: 100, UserCountDiscord: 0,
  }), T0);
  const s = useMatchmaker.getState();
  assert.deepEqual(s.joined, ["Teams"]);
  assert.equal(s.counts.Teams, 21);
  assert.equal(s.ingame.Teams, 14);
  assert.equal(s.joinedTime, "2026-08-18T10:00:00Z");
});

/* The screen is switches because of this: the request is the whole set, so
   there is no join and no leave to send, only "these are the ones I want". */
test("setting the queues replaces the set rather than adding to it", () => {
  fresh();
  useMatchmaker.getState().setQueues(["Teams"]);
  assert.deepEqual(useMatchmaker.getState().joined, ["Teams"]);
  useMatchmaker.getState().setQueues(["Teams", "1v1"]);
  assert.deepEqual(useMatchmaker.getState().joined, ["Teams", "1v1"]);
  useMatchmaker.getState().setQueues(["1v1"]);
  assert.deepEqual(useMatchmaker.getState().joined, ["1v1"], "the others are dropped, not kept");
  useMatchmaker.getState().setQueues([]);
  assert.deepEqual(useMatchmaker.getState().joined, [], "and empty leaves the matchmaker");
});

test("a zero ban is no ban, not a zero-second one", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("MatchMakerStatus", {
    BannedSeconds: 0, UserCount: 1, UserCountDiscord: 0,
  }), T0);
  assert.equal(useMatchmaker.getState().bannedSeconds, undefined);
});

test("the ready check deadline is computed once, on arrival", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("AreYouReady", {
    SecondsRemaining: 30, QuickPlay: false, MinimumWinChance: 0.4,
  }), T0);
  const check = useMatchmaker.getState().check!;
  assert.equal(check.expiresAt, T0 + 30_000);
  assert.equal(secondsLeft(check, T0), 30);
  assert.equal(secondsLeft(check, T0 + 25_000), 5);
  assert.equal(secondsLeft(check, T0 + 60_000), 0, "never counts past zero");
});

test("updates refine the check without restating the countdown", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("AreYouReady", {
    SecondsRemaining: 30, QuickPlay: false, MinimumWinChance: 0.4,
  }), T0);
  useMatchmaker.getState().applyMessage(msg("AreYouReadyUpdate", {
    ReadyAccepted: true, LikelyToPlay: false, YourBattleSize: 4, YourBattleReady: 2,
  }), T0 + 5_000);
  const check = useMatchmaker.getState().check!;
  assert.equal(check.expiresAt, T0 + 30_000, "the deadline is not restarted");
  assert.equal(check.accepted, true);
  assert.equal(check.likelyToPlay, false);
  assert.equal(check.battleReady, 2);
});

test("an update outside a check is ignored rather than inventing one", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("AreYouReadyUpdate", {
    ReadyAccepted: true, LikelyToPlay: true,
  }), T0);
  assert.equal(useMatchmaker.getState().check, undefined);
});

test("a started match clears the check without an excuse", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("AreYouReady", {
    SecondsRemaining: 30, QuickPlay: false, MinimumWinChance: 0,
  }), T0);
  useMatchmaker.getState().applyMessage(msg("AreYouReadyResult", {
    IsBattleStarting: true, AreYouBanned: false,
  }), T0);
  assert.equal(useMatchmaker.getState().check, undefined);
  assert.equal(useMatchmaker.getState().lastFailure, undefined);
});

test("a collapsed match says why", () => {
  fresh();
  useMatchmaker.getState().applyMessage(msg("AreYouReady", {
    SecondsRemaining: 30, QuickPlay: false, MinimumWinChance: 0,
  }), T0);
  useMatchmaker.getState().applyMessage(msg("AreYouReadyResult", {
    IsBattleStarting: false, AreYouBanned: false,
  }), T0);
  assert.match(useMatchmaker.getState().lastFailure!, /back in the queue/);

  useMatchmaker.getState().applyMessage(msg("AreYouReady", {
    SecondsRemaining: 30, QuickPlay: false, MinimumWinChance: 0,
  }), T0);
  assert.equal(useMatchmaker.getState().lastFailure, undefined, "a new check clears the old excuse");
  useMatchmaker.getState().applyMessage(msg("AreYouReadyResult", {
    IsBattleStarting: false, AreYouBanned: true,
  }), T0);
  assert.match(useMatchmaker.getState().lastFailure!, /banned/);
});

test("secondsLeft with no check is zero, not NaN", () => {
  assert.equal(secondsLeft(undefined, T0), 0);
});
