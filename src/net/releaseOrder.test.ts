/**
 * The publish step must never advertise a download it has already deleted.
 *
 * A release replaces four packages whose filenames carry the version, so last
 * build's are stale by name and get swept. `latest.json` is not stale by name -
 * it keeps its filename forever - so it survives the sweep. Sweep first and the
 * published manifest spends the whole upload naming packages that are already
 * gone: the app sees a new version, then 404s fetching it. A Linux tester hit
 * exactly that, and a failed upload would have left the release that way until
 * the next green build.
 *
 * So the order is load-bearing, and it is three lines of shell in a YAML file
 * that nothing else looks at and that only ever runs on main. This reads the
 * file rather than parsing it: a YAML dependency to check the order of three
 * commands is a worse trade than matching the lines they are written on.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WORKFLOW = ".github/workflows/build-and-release.yml";
const yml = readFileSync(WORKFLOW, "utf8");

/** Where a line appears, and a readable failure when it does not. */
function at(needle: string): number {
  const i = yml.indexOf(needle);
  assert.notEqual(i, -1, `${WORKFLOW} no longer contains: ${needle}`);
  return i;
}

test("the packages go up before the manifest that names them", () => {
  assert.ok(
    at('gh release upload dev "${packages[@]}"') < at("gh release upload dev latest.json --clobber"),
    "latest.json is published before the packages it points at exist",
  );
});

test("nothing is swept until the new manifest is published", () => {
  assert.ok(
    at("gh release upload dev latest.json --clobber") < at("gh release delete-asset"),
    "a stale package is deleted while the old manifest still names it",
  );
});

test("the manifest is not swept as stale", () => {
  /* The sweep keeps whatever `keep` lists. Package names change every build,
     so they are listed from the build; latest.json never changes, so it has to
     be added by hand or every release deletes its own manifest.

     Asserted as a boolean rather than `assert.match`, which prints the whole
     workflow on failure and buries the one line that matters. */
  assert.ok(
    /keep=\$\(printf '%s\\nlatest\.json\\n' "\$keep"\)/.test(yml),
    "latest.json is not added to `keep`, so the sweep deletes the manifest it just published",
  );
});
