/**
 * The engine's own settings, as opposed to the lobby's.
 *
 * These live in `springsettings.cfg` inside the Zero-K data dir and are read by
 * spring.exe at startup, not by us. Shiro previously never touched the file, so
 * a game booted with whatever the last client left there — which is how the
 * in-game UI ended up at the wrong scale.
 *
 * See src-tauri/src/engine_settings.rs; writes patch keys in place and never
 * discard the ~110 settings we do not model.
 */
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./connection";

export type EngineSettings = Record<string, string>;

/** The handful worth surfacing, with the metadata the UI needs to render them. */
export interface EngineSettingField {
  key: string;
  label: string;
  hint?: string;
  min?: number;
  max?: number;
}

export const ENGINE_FIELDS: EngineSettingField[] = [
  {
    key: "interfaceScale",
    label: "Interface scale",
    hint: "Percent. The in-game UI, not this window.",
    min: 50,
    max: 300,
  },
  { key: "FontSize", label: "Font size", min: 8, max: 48 },
  { key: "XResolution", label: "Fullscreen width", min: 640, max: 7680 },
  { key: "YResolution", label: "Fullscreen height", min: 480, max: 4320 },
  { key: "XResolutionWindowed", label: "Windowed width", min: 640, max: 7680 },
  { key: "YResolutionWindowed", label: "Windowed height", min: 480, max: 4320 },
];

export async function readEngineSettings(installRoot?: string): Promise<EngineSettings> {
  if (!inTauri()) return {};
  return invoke<EngineSettings>("zks_read_engine_settings", { installRoot });
}

export async function writeEngineSettings(
  changes: EngineSettings,
  installRoot?: string,
): Promise<void> {
  if (!inTauri()) return;
  return invoke("zks_write_engine_settings", { installRoot, changes });
}
