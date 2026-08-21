/**
 * Put the bundled apps where `tauri build` will pick them up.
 *
 * The URL and the hash are not written here. They are read out of
 * `src-tauri/src/apps.rs`, which is the same catalogue the running app checks
 * downloads against - so the bundled copy and the downloadable copy are
 * provably the same bytes, and there is only one place to change a version.
 *
 * A mismatch is fatal. Shipping a binary we cannot vouch for inside the
 * installer is worse than shipping no binary at all, because the launcher
 * would then hand it to people without the download path's hash check ever
 * running.
 *
 *   node tools/fetch-bundled-apps.mjs
 *
 * Skipping it is fine: the build then carries no bundled app and every entry
 * downloads on demand, which is how the launcher worked before any of this.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CATALOGUE = join(ROOT, "src-tauri", "src", "apps.rs");

/** Every entry that declares a `bundled` path, with what it should contain. */
function bundledEntries() {
  const source = readFileSync(CATALOGUE, "utf8");
  const out = [];
  /* One entry at a time, so a field can never be read from its neighbour. */
  for (const block of source.split("CatalogueApp {").slice(1)) {
    const entry = block.slice(0, block.indexOf("\n    },"));
    const bundled = /bundled: Some\("([^"]+)"\)/.exec(entry);
    if (!bundled) continue;
    const id = /id: "([^"]+)"/.exec(entry)?.[1];
    const url = /download: Some\(\s*"([^"]+)"/.exec(entry)?.[1];
    const sha256 = /sha256: Some\("([0-9a-f]{64})"\)/.exec(entry)?.[1];
    const run = /run: Some\("([^"]+)"\)/.exec(entry)?.[1];
    if (!id || !url || !sha256 || !run) {
      throw new Error(`${id ?? "an entry"} declares bundled but not download/sha256/run`);
    }
    /* `join` takes the forward slashes in the catalogue path as-is on both
       platforms, so the resource path stays written the way Tauri wants it. */
    out.push({ id, url, sha256, run, dest: join(ROOT, "src-tauri", bundled[1]) });
  }
  return out;
}

for (const app of bundledEntries()) {
  process.stdout.write(`${app.id}: ${app.url}\n`);
  const response = await fetch(app.url, {
    headers: { "user-agent": "shiro-build" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${app.url} answered ${response.status}`);
  const zip = Buffer.from(await response.arrayBuffer());

  const got = createHash("sha256").update(zip).digest("hex");
  if (got !== app.sha256) {
    throw new Error(
      `${app.id} did not match the catalogue's hash\n  expected ${app.sha256}\n  got      ${got}`,
    );
  }
  process.stdout.write(`  hash ok, ${zip.length.toLocaleString()} bytes\n`);

  /* Unpacked with the platform's own tool rather than a dependency: this runs
     once per build, on a file we have just verified.

     Into a scratch directory, and then only the executable is copied across.
     Unpacking straight into the resource directory spills the archive's other
     files into the installer - and the first time this ran, the zip's own
     README.md landed on top of the one explaining the directory. */
  const cache = join(ROOT, "node_modules", ".cache");
  const tmpZip = join(cache, `${app.id}.zip`);
  const tmpDir = join(cache, app.id);
  mkdirSync(cache, { recursive: true });
  rmSync(tmpDir, { recursive: true, force: true });
  writeFileSync(tmpZip, zip);

  if (process.platform === "win32") {
    execFileSync("powershell", [
      "-NoProfile", "-Command",
      `Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${tmpDir}' -Force`,
    ], { stdio: "inherit" });
  } else {
    execFileSync("unzip", ["-oq", tmpZip, "-d", tmpDir], { stdio: "inherit" });
  }

  const built = join(tmpDir, app.run);
  if (!existsSync(built)) throw new Error(`${app.url} contains no ${app.run}`);
  mkdirSync(dirname(app.dest), { recursive: true });
  copyFileSync(built, app.dest);
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(tmpZip, { force: true });
  process.stdout.write(`  ${app.run} placed at ${app.dest}\n`);
}
