/**
 * Run with:  node --test src/store/site.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSiteCommand, channelOf, isExternalUrl, useSite } from "./site.ts";
import type { Message } from "../protocol/registry.ts";

test("a bare path is a path", () => {
  assert.deepEqual(parseSiteCommand("battles"), { path: "battles", actions: [] });
});

test("the zk:// prefix is optional and case-insensitive", () => {
  assert.equal(parseSiteCommand("ZK://chat/channel/zk").path, "chat/channel/zk");
  assert.equal(parseSiteCommand("zk://battles").path, "battles");
});

test("actions come after the path, one per @", () => {
  const c = parseSiteCommand("battles@join_battle:hexed@add_friend:lorelei");
  assert.equal(c.path, "battles");
  assert.deepEqual(c.actions, [
    { command: "join_battle", arg: "hexed" },
    { command: "add_friend", arg: "lorelei" },
  ]);
});

test("an argument keeps its colons, because maps and urls have them", () => {
  const c = parseSiteCommand("@start_replay:http://a/b.sdfz,1,2,3");
  assert.deepEqual(c.actions, [{ command: "start_replay", arg: "http://a/b.sdfz,1,2,3" }]);
  assert.equal(c.path, "");
});

test("an action with no argument still parses", () => {
  assert.deepEqual(parseSiteCommand("@logout").actions, [{ command: "logout", arg: "" }]);
});

test("channels are recognised, and nothing else is", () => {
  assert.equal(channelOf("chat/channel/zk"), "zk");
  assert.equal(channelOf("chat/channel"), undefined);
  assert.equal(channelOf("battles"), undefined);
});

test("external urls are told apart from lobby paths", () => {
  assert.equal(isExternalUrl("https://zero-k.info/Maps"), true);
  assert.equal(isExternalUrl("www.zero-k.info"), true);
  assert.equal(isExternalUrl("battles"), false);
  assert.equal(isExternalUrl("chat/channel/zk"), false);
});

test("only the newest command is pending, and it is taken once", () => {
  const msg = (Command: string): Message =>
    ({ cmd: "SiteToLobbyCommand", data: { Command } }) as unknown as Message;
  useSite.getState().reset();
  useSite.getState().applyMessage(msg("battles"));
  useSite.getState().applyMessage(msg("@add_friend:hexed"));
  assert.deepEqual(useSite.getState().take()!.actions, [{ command: "add_friend", arg: "hexed" }]);
  assert.equal(useSite.getState().take(), undefined);
});
