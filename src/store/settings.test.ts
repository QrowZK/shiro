/**
 * Run with:  node --test src/store/settings.test.ts
 *
 * There is no localStorage under the test runner, which is itself worth
 * asserting: a browser in private mode refuses storage the same way, and that
 * must not take the app down.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { useSettings, applySkin, SKINS } from "./settings.ts";

test("settings survive having nowhere to persist to", () => {
  assert.equal(globalThis.localStorage, undefined, "precondition for this test");
  useSettings.getState().set({ name: "Qrow", remember: true, password: "secret" });
  assert.equal(useSettings.getState().name, "Qrow");
});

test("forgetting the password keeps the name, which is not a secret", () => {
  useSettings.getState().set({ name: "Qrow", remember: true, password: "secret" });
  useSettings.getState().forgetPassword();
  assert.equal(useSettings.getState().password, undefined);
  assert.equal(useSettings.getState().remember, false);
  assert.equal(useSettings.getState().name, "Qrow");
});

test("choosing a skin does not need a document to put it on", () => {
  assert.equal(globalThis.document, undefined, "precondition for this test");
  useSettings.getState().set({ skin: "graphite" });
  assert.equal(useSettings.getState().skin, "graphite");
});

test("paper clears the attribute instead of setting an unmatched one", () => {
  const root = { dataset: {} as Record<string, string | undefined> };
  (globalThis as { document?: unknown }).document = { documentElement: root };
  try {
    applySkin("slate");
    assert.equal(root.dataset.skin, "slate");
    // Paper is colors.css itself, so the default state is no attribute at all.
    applySkin("paper");
    assert.equal(root.dataset.skin, undefined);
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
});

test("every skin the picker offers is one the loader will keep", () => {
  // load() falls back to paper for an id it does not recognise, so a typo in
  // SKINS would silently make a listed skin unselectable.
  assert.ok(SKINS.some(s => s.id === "paper"));
  assert.equal(new Set(SKINS.map(s => s.id)).size, SKINS.length);
});

test("a server override is only what was set, not a half-filled pair", () => {
  useSettings.getState().set({ host: "localhost", port: 8200 });
  assert.equal(useSettings.getState().host, "localhost");
  assert.equal(useSettings.getState().port, 8200);
  useSettings.getState().set({ host: undefined, port: undefined });
  assert.equal(useSettings.getState().host, undefined);
  assert.equal(useSettings.getState().port, undefined);
});

test("turning the debriefing off is actually written down", () => {
  /* It was in Settings and read by App, but save() never listed it, so the
     toggle came back on at every launch. Storage has to be faked here: the
     test runner has none, which is the point of the first test in this file. */
  const store: Record<string, string> = {};
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  };
  try {
    useSettings.getState().set({ autoOpenDebriefing: false, skin: "vellum" });
    const written = JSON.parse(store["shiro.settings"]);
    assert.equal(written.autoOpenDebriefing, false);
    assert.equal(written.skin, "vellum", "the skin was already persisted");
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    useSettings.getState().set({ autoOpenDebriefing: true, skin: "paper" });
  }
});
