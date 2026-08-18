/**
 * Run with:  node --test src/store/settings.test.ts
 *
 * There is no localStorage under the test runner, which is itself worth
 * asserting: a browser in private mode refuses storage the same way, and that
 * must not take the app down.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { useSettings } from "./settings.ts";

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

test("a server override is only what was set, not a half-filled pair", () => {
  useSettings.getState().set({ host: "localhost", port: 8200 });
  assert.equal(useSettings.getState().host, "localhost");
  assert.equal(useSettings.getState().port, 8200);
  useSettings.getState().set({ host: undefined, port: undefined });
  assert.equal(useSettings.getState().host, undefined);
  assert.equal(useSettings.getState().port, undefined);
});
