import React from "react";
import { mapCatalogue, normaliseMapName } from "../net/zkcatalogue.ts";

/**
 * The zero-k.info ResourceID for a map name, once the catalogue has loaded.
 *
 * `undefined` until then, and for any map the catalogue does not list - a brand
 * new or unlisted one. `MapImage` falls back to a search in that case, which is
 * where every map link used to land.
 *
 * The catalogue itself is fetched once per session and memoised, so this is a
 * lookup rather than a request.
 */
export function useMapResourceId(map) {
  const [id, setId] = React.useState(undefined);
  React.useEffect(() => {
    if (!map) { setId(undefined); return undefined; }
    let live = true;
    mapCatalogue().then(
      c => { if (live) setId(c.get(normaliseMapName(map))); },
      () => {},                       // offline just means links stay searches
    );
    return () => { live = false; };
  }, [map]);
  return id;
}
