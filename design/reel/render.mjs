// Renders the launch reel with headless Chrome (needs playwright-core and Google Chrome; run from a folder\n// where playwright-core is installed). The MP4 is encoded in the browser: WebCodecs H.264 + AAC, mp4-muxer.\n// Drive the reel page: `stills <dir> [lang]` screenshots one frame per chapter; `mp4 <file> [lang]` encodes the full reel.
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const [mode, out, lang = "en", times] = process.argv.slice(2);
const page_ = process.env.REEL_HTML ?? new URL("./reel.html", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
await page.goto(`${pathToFileURL(page_).href}?lang=${lang}`, { waitUntil: "networkidle" });
await page.evaluate(() => window.ready);
if (mode === "stills") {
  mkdirSync(out, { recursive: true });
  const ts = (times ?? "1.9,4.4,6.9,9.4,11.9,15.2,17.9,20.2,22.4,23.6,24.9,28.6").split(",").map(Number);
  for (const t of ts) {
    await page.evaluate((t) => window.render(t), t);
    await page.screenshot({ path: `${out}/s-${lang}-${String(t.toFixed(1)).padStart(4, "0")}.png` });
  }
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
