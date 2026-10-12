/**
 * The landing's 3D coins (design/Arbolito Landing.dc.html, `arb-coins` preset "glass"): one big
 * silver coin plus two small ones orbiting it, rendered with three.js into a fixed canvas behind
 * the content. As the reader scrolls, the trio glides between per-section waypoints
 * (TRACK below, copied from the design) and keeps turning.
 *
 * Waypoint units, as in the design: x is an offset from the viewport centre in half-widths
 * (0.5 = halfway to the right edge, 1.6 = off screen), y an offset from the centre in viewport
 * heights, s a scale where 1 is half the viewport height in diameter.
 *
 * Loaded on the client only (dynamic import from coins.tsx), so three.js never blocks first paint.
 */
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  TorusGeometry,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

type Waypoint = readonly [selector: string, x: number, y: number, s: number];

export const TRACK: readonly Waypoint[] = [
  ["#hero", 0.5, 0.02, 1.15],
  ["#como", 0.62, 0.32, 0.62],
  ["#calc", -0.7, 0.28, 0.55],
  ["#recibo", -0.72, 0.42, 0.5],
  ["#numeros", 1.6, 0.2, 0.6],
  ["#confianza", 0.58, -0.05, 0.95],
  ["#faq", -0.75, 0.3, 0.5],
  ["#pie", 0.0, 0.05, 1.1], // design: y 0.3; raised so the links row under the wordmark stays readable
];

const INK = "#11166b"; // deep blue-ink glyph, as in the design's coin faces
const FACE_HI = "#eceef6";
const FACE_LO = "#c9cddd";

/** A coin face: brushed silver disc, an engraved ring, and the currency glyph. */
function faceTexture(glyph: string, font: string): CanvasTexture {
  const n = 512;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(n * 0.38, n * 0.32, n * 0.05, n / 2, n / 2, n * 0.52);
  grad.addColorStop(0, FACE_HI);
  grad.addColorStop(1, FACE_LO);
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  // Fine concentric "brushed" lines.
  g.globalAlpha = 0.07;
  g.strokeStyle = "#5a6080";
  for (let r = 8; r < n / 2; r += 5) {
    g.beginPath();
    g.arc(n / 2, n / 2, r, 0, Math.PI * 2);
    g.lineWidth = 1;
    g.stroke();
  }
  g.globalAlpha = 1;
  // Engraved ring: a dark line with a light highlight under it.
  for (const [r, col, w] of [
    [n * 0.415, "rgba(70,76,120,.55)", 7],
    [n * 0.4, "rgba(255,255,255,.7)", 3],
  ] as const) {
    g.beginPath();
    g.arc(n / 2, n / 2, r, 0, Math.PI * 2);
    g.strokeStyle = col;
    g.lineWidth = w;
    g.stroke();
  }
  // Glyph, slightly embossed.
  const size = glyph.length > 2 ? n * 0.26 : n * 0.42;
  g.font = `800 ${size}px ${font}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(255,255,255,.65)";
  g.fillText(glyph, n / 2 + 3, n / 2 + 5);
  g.fillStyle = INK;
  g.fillText(glyph, n / 2, n / 2 + 2);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeCoin(front: string, back: string, font: string): Group {
  const R = 1;
  const T = 0.24;
  const coin = new Group();
  const metal = new MeshPhysicalMaterial({ color: 0xc8ccd9, metalness: 1, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.15 });
  // Body (the rim), with a ridged look from many segments.
  const body = new Mesh(new CylinderGeometry(R, R, T, 128, 1, true), metal);
  body.rotation.x = Math.PI / 2;
  coin.add(body);
  // Raised lips on both faces.
  for (const z of [T / 2, -T / 2]) {
    const lip = new Mesh(new TorusGeometry(R * 0.965, T * 0.2, 16, 128), metal);
    lip.position.z = z;
    coin.add(lip);
  }
  // Faces, slightly recessed inside the lips.
  const faceGeo = new CircleGeometry(R * 0.955, 128);
  const mk = (glyph: string) =>
    new MeshStandardMaterial({ map: faceTexture(glyph, font), metalness: 0.55, roughness: 0.3, envMapIntensity: 0.9 });
  const f = new Mesh(faceGeo, mk(front));
  f.position.z = T / 2 - 0.004;
  coin.add(f);
  const b = new Mesh(faceGeo, mk(back));
  b.position.z = -T / 2 + 0.004;
  b.rotation.y = Math.PI;
  coin.add(b);
  return coin;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type CoinsHandle = { dispose(): void };

export function mountCoins(canvas: HTMLCanvasElement, opts: { reducedMotion: boolean }): CoinsHandle | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  } catch {
    return null; // no WebGL: the page reads fine without the coins
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
  env.colorSpace = LinearSRGBColorSpace;
  scene.environment = env;

  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  const font = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "Manrope, system-ui, sans-serif";
  const main = makeCoin("R$", "$", font);
  const sats = [makeCoin("$", "ARS", font), makeCoin("R$", "$", font)];
  const rig = new Group();
  rig.add(main, ...sats);
  scene.add(rig);

  // Viewport → world mapping at z = 0.
  let vw = 1;
  let vh = 1;
  let halfH = 1; // world half-height at z=0
  function resize() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    measure();
  }

  // Scroll positions at which each waypoint is fully reached: the section's middle at mid-screen.
  let stops: { at: number; x: number; y: number; s: number }[] = [];
  function measure() {
    const max = Math.max(0, document.documentElement.scrollHeight - vh);
    stops = TRACK.flatMap(([sel, x, y, s]) => {
      const el = document.querySelector(sel);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      const top = r.top + window.scrollY;
      const at = Math.min(max, Math.max(0, top + Math.min(r.height, vh) / 2 - vh / 2));
      return [{ at, x, y, s }];
    }).sort((a, b) => a.at - b.at);
  }

  function target(scroll: number) {
    if (!stops.length) return { x: 0.5, y: 0, s: 1 };
    if (scroll <= stops[0]!.at) return stops[0]!;
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1]!;
      const b = stops[i]!;
      if (scroll <= b.at) {
        const t = b.at === a.at ? 1 : smooth((scroll - a.at) / (b.at - a.at));
        return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), s: lerp(a.s, b.s, t) };
      }
    }
    return stops[stops.length - 1]!;
  }

  const cur = { ...target(window.scrollY) };
  let raf = 0;
  let last = performance.now();
  let time = 0;
  let visible = true;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!opts.reducedMotion) time += dt;
    const scroll = window.scrollY;
    const tg = target(scroll);
    const k = opts.reducedMotion ? 1 : 1 - Math.exp(-dt * 4.5);
    cur.x += (tg.x - cur.x) * k;
    cur.y += (tg.y - cur.y) * k;
    cur.s += (tg.s - cur.s) * k;

    // Diameter in px: half the viewport height at s=1, capped on narrow phones.
    const diamPx = Math.min(vh * 0.5, vw * 0.62) * cur.s;
    const worldPerPx = (2 * halfH) / vh;
    const radius = (diamPx / 2) * worldPerPx;
    rig.position.set(cur.x * (vw / 2) * worldPerPx, -cur.y * vh * worldPerPx, 0);
    rig.scale.setScalar(radius);

    const spin = time * 0.35 + scroll * 0.0016;
    main.rotation.set(0.12 + Math.sin(time * 0.6) * 0.05, -0.55 + spin, Math.sin(time * 0.4) * 0.04);
    main.position.y = Math.sin(time * 1.1) * 0.04;

    // Satellites on a tilted orbit around the big coin.
    sats.forEach((c, i) => {
      const a = time * 0.28 + scroll * 0.0009 + i * Math.PI;
      c.position.set(Math.cos(a) * 1.75, Math.sin(a) * 0.32 + (i ? -0.08 : 0.1), Math.sin(a) * 0.9);
      c.scale.setScalar(i ? 0.24 : 0.2);
      c.rotation.set(0.2, time * (0.9 + i * 0.3) + i, 0.1);
    });

    renderer.render(scene, camera);
  }

  const onResize = () => resize();
  const onVis = () => {
    visible = document.visibilityState === "visible";
    last = performance.now();
  };
  // Content above the coins can change height (streamed sections), so re-measure on body resize.
  const ro = new ResizeObserver(() => measure());
  ro.observe(document.body);
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVis);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      scene.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose();
          const m = o.material as MeshStandardMaterial;
          m.map?.dispose();
          m.dispose();
        }
      });
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
