/**
 * Bridge to the engine launcher. Mirrors net/connection.ts: the Rust side owns
 * the install, the script and the process; this module owns nothing but the
 * invoke/listen plumbing.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** A located Zero-K data directory. */
export interface Install {
  root: string;
  /** How it was found - "Steam", "Zero-K installer" - for the UI to show. */
  source: string;
}

export type GameStatus =
  | { kind: "launched"; pid: number }
  | { kind: "exited"; code: number | null }
  | { kind: "failed"; reason: string };

/** The subset of `ConnectSpring` the engine actually needs. */
export interface ConnectRequest {
  engine: string;
  ip: string;
  port: number;
  myPlayerName: string;
  scriptPassword: string;
}

/**
 * Find the Zero-K install. An explicit `root` from settings is checked like any
 * other candidate, and is remembered by the Rust side so the next launch uses
 * the same one.
 */
export function locateInstall(root?: string): Promise<Install> {
  return invoke("zks_locate_install", { root });
}

/** Resolves with the engine's pid once it has started. */
export function launchSpring(req: ConnectRequest): Promise<number> {
  return invoke("zks_launch_spring", { req });
}

export function onGame(cb: (s: GameStatus) => void): Promise<UnlistenFn> {
  return listen<GameStatus>("zks://game", e => cb(e.payload));
}
