/**
 * The app launcher's client side.
 *
 * The catalogue is compiled into the Rust binary rather than fetched, so this
 * is a thin wrapper: there is no network here and no way for the list to change
 * without shipping a new Shiro. See `src-tauri/src/apps.rs` and `docs/APPS.md`.
 */
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./connection.ts";

export type AppKind = "builtin" | "executable";

export interface CatalogueApp {
  id: string;
  name: string;
  summary: string;
  description: string;
  kind: AppKind;
  source: string;
  download?: string;
  sha256?: string;
  version?: string;
  run?: string;
  /** Set when it cannot be installed, and says why in a sentence. */
  unavailable?: string;
}

export interface AppStatus {
  id: string;
  installed: boolean;
  installedVersion?: string;
  path?: string;
}

export async function catalogue(): Promise<CatalogueApp[]> {
  if (!inTauri()) return [];
  return invoke<CatalogueApp[]>("zka_catalogue");
}

export async function statuses(): Promise<AppStatus[]> {
  if (!inTauri()) return [];
  return invoke<AppStatus[]>("zka_status");
}

/** Start an installed app. Only ever in response to a person pressing Launch. */
export async function launchApp(id: string): Promise<void> {
  if (!inTauri()) return;
  await invoke("zka_launch", { id });
}

export async function uninstallApp(id: string): Promise<void> {
  if (!inTauri()) return;
  await invoke("zka_uninstall", { id });
}
