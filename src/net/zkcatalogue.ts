/**
 * Zero-K's content catalogue, for the pickers that need real names.
 *
 * The lobby protocol has no "list all maps" command - the server only tells you
 * about maps that happen to be in an open battle - which is why the host dialog
 * used to suggest whatever one or two maps were live at the time. Zero-K's own
 * content service does have a searchable catalogue; see
 * docs/DOWNLOADS-ZK-CONTENT.md for how it was found.
 */
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./connection";

export interface MapHit {
  name: string;
  /** Zero-K's rating: "MatchMaker" is the curated ladder set, and sorts first. */
  support: string;
}

export async function findMaps(query: string): Promise<MapHit[]> {
  if (!inTauri() || !query.trim()) return [];
  return invoke<MapHit[]>("zks_find_maps", { query });
}
