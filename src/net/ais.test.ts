/**
 * Run with:  node --test src/net/ais.test.ts
 *
 * These cover the two things that decide what a person sees in the picker: the
 * fallback that stands in when an install cannot be read, and the folding of
 * seven chickens into one row. Both exist because of specific failures - an
 * empty picker is worse than the single hardcoded CAI it replaces, and a
 * dropdown with seven Chicken lines in it is a list, not a choice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { BUILT_IN, groupAis, listAis, variantLabel, type Ai } from "./ais.ts";

const ai = (name: string, source: "game" | "engine" = "game"): Ai =>
  ({ lib: name, name, source });

test("the browser demo gets the built-in list rather than an empty picker", async () => {
  // No Tauri here, which is the same state the demo click-through runs in.
  const list = await listAis("2025.06.21", "Zero-K v1.14.8.0");
  assert.equal(list.guessed, true);
  assert.ok(list.note, "a guess that does not say it is one is a lie");
  assert.ok(list.ais.length > 1, "the whole complaint was a list of one");
});

test("the built-in list is Zero-K's own, and is a valid AiLib each", () => {
  assert.equal(BUILT_IN.length, 9);
  assert.equal(BUILT_IN[0].lib, "CAI");
  for (const entry of BUILT_IN) {
    // `AiLib` goes into the start script unvalidated: a LuaAI is a bare name,
    // and a `|` in one would be split into ShortName/Version by the server.
    assert.equal(entry.source, "game");
    assert.ok(!entry.lib.includes("|"), `${entry.lib} would be read as a skirmish AI`);
    assert.ok(entry.desc, `${entry.lib} has nothing to say for itself`);
  }
});

test("the chickens are one row, in the order the game declares them", () => {
  const rows = groupAis(BUILT_IN);
  assert.deepEqual(
    rows.map(r => (r.kind === "one" ? r.ai.name : r.label)),
    ["CAI", "Chicken", "Null AI"],
  );
  const chickens = rows[1];
  assert.equal(chickens.kind, "family");
  if (chickens.kind !== "family") return;
  assert.equal(chickens.members.length, 7);
  assert.equal(variantLabel("Chicken", chickens.members[0]), "Beginner");
  assert.equal(variantLabel("Chicken", chickens.members[5]), "Suicidal");
});

test("a prefix used only once stays an ordinary row", () => {
  // Otherwise a single "Chicken: Hard" would be drawn as a family of one, with
  // a difficulty picker offering exactly one difficulty.
  const rows = groupAis([ai("CAI"), ai("Chicken: Hard")]);
  assert.deepEqual(rows.map(r => r.kind), ["one", "one"]);
});

test("a family takes the place of its first member", () => {
  const rows = groupAis([
    ai("Chicken: Easy"), ai("CAI"), ai("Chicken: Hard"), ai("CircuitAI|stable", "engine"),
  ]);
  assert.deepEqual(
    rows.map(r => (r.kind === "one" ? r.ai.name : r.label)),
    ["Chicken", "CAI", "CircuitAI|stable"],
  );
});

test("a skirmish AI's version is not mistaken for a family name", () => {
  /* Engine AIs are `ShortName|Version`, not `Family: Variant`. Splitting on
     the wrong separator would file CircuitAI and NullAI under one row. */
  const rows = groupAis([ai("CircuitAI", "engine"), ai("NullAI", "engine")]);
  assert.deepEqual(rows.map(r => r.kind), ["one", "one"]);
});

test("a name that is nothing but a colon is not a family", () => {
  const rows = groupAis([ai(": lost"), ai(":")]);
  assert.deepEqual(rows.map(r => r.kind), ["one", "one"]);
});
