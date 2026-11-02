// Renders the product demo with headless Chrome (needs playwright-core and Google Chrome; run from a
// folder where playwright-core is installed, with DEMO_HTML pointing at design/demo/demo.html).
// The MP4 is encoded in the browser: WebCodecs H.264 + AAC, mp4-muxer.
//   node render.mjs stills <dir>    one frame from the middle of every scene
//   node render.mjs mp4 <file>      the full demo
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const [mode, out] = process.argv.slice(2);
const html = process.env.DEMO_HTML ?? new URL("./demo.html", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
await page.goto(pathToFileURL(html).href, { waitUntil: "networkidle" });
await page.evaluate(() => window.ready);
if (mode === "stills") {
  mkdirSync(out, { recursive: true });
  const starts = await page.evaluate(() => window.sceneStarts());
  const dur = await page.evaluate(() => window.duration());
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : dur;
    const t = starts[i] + (end - starts[i]) * 0.6;
    await page.evaluate((t) => window.render(t), t);
    await page.screenshot({ path: `${out}/scene-${String(i + 1).padStart(2, "0")}.png` });
  }
  console.log(`${starts.length} stills, demo ${dur.toFixed(1)} s`);
} else {
  const t0 = Date.now();
  const n = await page.evaluate(() => window.encodeToBase64Chunks());
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(Buffer.from(await page.evaluate((i) => window.__chunks[i], i), "base64"));
  const buf = Buffer.concat(parts);
  writeFileSync(out, buf);
  console.log(`wrote ${out} ${(buf.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
