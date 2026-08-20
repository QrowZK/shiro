/* Render an SVG to a PNG at a given size, using the browser that is already a
   dependency of the e2e suite. Tauri wants raster icons and the logos arrived
   as vectors; this is the one step between them.

   Usage: node render-icon.mjs <in.svg> <out.png> <size> */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const [svgPath, outPath, sizeArg] = process.argv.slice(2);
const size = Number(sizeArg || 256);
const svg = readFileSync(svgPath, "utf8");

async function launch() {
  for (const channel of ["msedge", "chrome", "chromium"]) {
    try {
      return await chromium.launch({ channel });
    } catch {
      /* try the next one */
    }
  }
  return chromium.launch();
}

const browser = await launch();
const page = await browser.newPage({
  viewport: { width: size, height: size },
  deviceScaleFactor: 1,
});
// Transparent background: an app icon must not carry a white square with it.
await page.setContent(
  `<style>html,body{margin:0;padding:0;background:transparent}
   svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
);
await page.screenshot({ path: outPath, omitBackground: true });
await browser.close();
console.log(`${outPath} ${size}x${size}`);
