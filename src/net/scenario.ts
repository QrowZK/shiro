/**
 * Splaunch's client side.
 *
 * A scenario compiles to a Spring start script in Rust and launches the real
 * game, so there is no preview to keep in sync - see
 * `src-tauri/src/scenario.rs` and `docs/SCENARIO-EDITOR.md`.
 */
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./connection.ts";

export interface Placed { unit: string; team: number; x: number; z: number }
export interface ScenarioTeam { id: number; ally: number; ai: string | null; colour: string }
export interface Scenario {
  name: string;
  map: string;
  game: string;
  teams: ScenarioTeam[];
  units: Placed[];
  objectives: string[];
}

/** The script this scenario would produce, without launching it. */
export async function scenarioScript(scenario: Scenario, player: string): Promise<string> {
  if (!inTauri()) return "";
  return invoke<string>("zksc_script", { scenario, player });
}

/** What is wrong with it, in sentences. */
export async function scenarioProblems(scenario: Scenario): Promise<string[]> {
  if (!inTauri()) return [];
  return invoke<string[]>("zksc_problems", { scenario });
}

/** Compile and launch the game into it. */
export async function testScenario(
  scenario: Scenario, player: string, engine: string,
): Promise<number> {
  if (!inTauri()) throw new Error("Testing a scenario needs the desktop app.");
  return invoke<number>("zksc_test", { scenario, player, engine });
}
