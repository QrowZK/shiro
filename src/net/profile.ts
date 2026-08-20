/**
 * What the machine is, according to the engine.
 *
 * The report is parsed in Rust from Zero-K's own `infolog.txt` - the same file
 * `gameSettings.ts` already reads for one boolean. Nothing here probes the
 * hardware directly, on purpose: the engine's view is the one that decides
 * whether the game runs well, and a second opinion would disagree with it on
 * exactly the machines most likely to have trouble.
 */
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./connection.ts";
import { readInfolog } from "./engineSettings.ts";

export type Level = "ok" | "warn" | "fail";

export interface Finding {
  level: Level;
  title: string;
  detail: string;
}

export interface Profile {
  /** False when the game has never run here - a normal state, not a fault. */
  seen: boolean;
  physicalCores?: number;
  logicalCores?: number;
  glVendor?: string;
  glRenderer?: string;
  glVersion?: string;
  vramTotalMb?: number;
  vramFreeMb?: number;
  sdlVersion?: string;
  window?: string;
}

export interface Report {
  profile: Profile;
  verdict: { findings: Finding[]; preset?: string; reason?: string };
}

export async function profileMachine(installRoot?: string): Promise<Report> {
  if (!inTauri()) throw new Error("The profiler needs the desktop app.");
  const infolog = await readInfolog(installRoot).catch(() => null);
  return invoke<Report>("zkp_profile", { infolog });
}
