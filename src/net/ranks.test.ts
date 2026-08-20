/**
 * Run with:  node --test src/net/ranks.test.ts
 *
 * The boundaries are upstream's, and the colours were measured off the 64 rank
 * icons Chobby ships. Both are pinned here so a change to either is a decision
 * rather than a drift.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { RANK_COLOURS, skillBracket, rankColour } from "./ranks.ts";

test("the bands are upstream's: 200 Elo apart, from 1000", () => {
  assert.equal(skillBracket(1000), 0);
  assert.equal(skillBracket(1199), 0);
  assert.equal(skillBracket(1200), 1);
  assert.equal(skillBracket(1400), 2);
  assert.equal(skillBracket(1600), 3);
  assert.equal(skillBracket(1800), 4);
  assert.equal(skillBracket(2000), 5);
  assert.equal(skillBracket(2200), 6);
  assert.equal(skillBracket(2400), 7);
});

test("and they clamp at both ends rather than running off the grid", () => {
  // There are only eight icons per row; the formula would index past them.
  assert.equal(skillBracket(0), 0);
  assert.equal(skillBracket(-500), 0);
  assert.equal(skillBracket(9000), 7);
});

test("every band has a colour, and no two share one", () => {
  assert.equal(RANK_COLOURS.length, 8);
  assert.equal(new Set(RANK_COLOURS).size, 8);
  for (const c of RANK_COLOURS) assert.match(c, /^#[0-9A-F]{6}$/);
});

test("a rating maps to the colour its rank icon carries", () => {
  assert.equal(rankColour(1100), "#767676");   // grey
  assert.equal(rankColour(1250), "#BD272F");   // red
  assert.equal(rankColour(1850), "#DEB90B");   // yellow
  assert.equal(rankColour(2500), "#9113D0");   // purple
});

test("no rating is not the bottom band", () => {
  /* A player we have no rating for and a player rated under 1200 would
     otherwise look identical, and only one of those is a fact. */
  assert.equal(rankColour(undefined), undefined);
  assert.equal(rankColour(NaN), undefined);
  assert.notEqual(rankColour(1100), undefined);
});
