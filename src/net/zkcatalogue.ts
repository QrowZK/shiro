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

/**
 * One of Zero-K's featured custom game modes.
 *
 * A mode is not simply "a different game". Of the seven featured modes, most
 * name a `game`, Zero Wars names a `map` and runs on stock Zero-K, and Tech-K
 * names neither and is one modoption. Treating a mode as a game would host a
 * plain Zero-K room for two of the seven.
 */
export interface GameMode {
  shortName: string;
  displayName: string;
  game?: string;
  map?: string;
  options: Record<string, string>;
}

export async function gameModes(): Promise<GameMode[]> {
  if (!inTauri()) return [];
  return invoke<GameMode[]>("zks_game_modes");
}

// -------------------------------------------------------------- map pages ---

export interface CatalogueMap {
  name: string;
  resourceId: number;
}

/**
 * Every featured and supported map, with the id that addresses its page.
 *
 * A map's detail page on zero-k.info is `/Maps/Detail/<ResourceID>`; `?name=`
 * is ignored, which is why map links used to land on a search. The id is not
 * derivable from a name, and asking `FindResourceData` per map would be a
 * request per minimap - so the whole catalogue is fetched once instead.
 *
 * Memoised for the session. It changes when maps are added, not while you play.
 */
let catalogue: Promise<Map<string, number>> | undefined;

export function mapCatalogue(): Promise<Map<string, number>> {
  if (!catalogue) {
    catalogue = (async () => {
      if (!inTauri()) return new Map<string, number>();
      const maps = await invoke<CatalogueMap[]>("zks_map_catalogue");
      /* Keyed by the normalised name. The lobby sends "Comet Catcher Redux"
         and the catalogue says "Comet_Catcher_Redux" for the same map. */
      return new Map(maps.map(m => [normaliseMapName(m.name), m.resourceId]));
    })().catch(() => new Map<string, number>());   // offline is not an error here
  }
  return catalogue;
}

/** Underscores and spaces are the same separator as far as a map name goes. */
export function normaliseMapName(name: string): string {
  return String(name).replace(/_/g, " ").trim().toLowerCase();
}
