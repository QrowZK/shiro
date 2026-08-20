import React from "react";
import { webProfile, webRatings } from "../net/zkweb.ts";

/**
 * A player's zero-k.info profile, and their rating history.
 *
 * Four states, deliberately distinct: `loading`, `ok`, `missing` (there is no
 * such account - the site says so in forty bytes) and `error` (we could not
 * read the page). A player with no awards and a page we could not read must
 * not look the same.
 *
 * One request per name actually looked at; the Rust side caches, so switching
 * back to somebody costs nothing. Nothing here is prefetched - see
 * docs/PROFILES-WITHOUT-ENDPOINTS.md section 5.
 */
export function useWebProfile(name) {
  const [state, setState] = React.useState({ kind: "loading" });

  React.useEffect(() => {
    if (!name) { setState({ kind: "loading" }); return undefined; }
    let live = true;
    setState({ kind: "loading" });

    webProfile(name).then(
      profile => {
        if (!live) return;
        if (!profile) { setState({ kind: "missing" }); return; }
        setState({ kind: "ok", profile, ratings: [] });
        // The series needs the numeric id, which the profile page carries.
        if (profile.accountId) {
          webRatings(profile.accountId).then(
            ratings => { if (live) setState(s => (s.kind === "ok" ? { ...s, ratings } : s)); },
            () => {},              // a missing chart is not a missing profile
          );
        }
      },
      () => { if (live) setState({ kind: "error" }); },
    );
    return () => { live = false; };
  }, [name]);

  return state;
}
