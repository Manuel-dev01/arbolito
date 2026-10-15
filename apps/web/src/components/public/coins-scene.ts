/**
 * The landing's 3D coins (design/Arbolito Landing.dc.html, `arb-coins` preset "glass"): one big
 * coin plus two small ones around it, rendered with three.js into a fixed canvas behind the
 * content. Scroll drives everything, as in the design: the trio glides between per-section
 * waypoints (TRACK, copied from the design), turns over as the page goes by (landing on its
 * "US$" side, on edge, at the footer), and shifts tint from lavender to sage. Hovering the big
 * coin makes it lean toward the pointer and flick round.
 *
 * Waypoint units, as in the design: x and y are offsets from the viewport centre in half-widths
 * and half-heights (y up: 0.3 sits above the middle; 1.6 is off screen), s a scale where 1 is
 * 0.55 of the viewport height in diameter.
 *
 * Loaded on the client only (dynamic import from coin.tsx), so three.js never blocks first paint.
 */
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

type Waypoint = readonly [selector: string, x: number, y: number, s: number, tint: number];

/** The design's track, plus a tint per section (0 lavender → 1 sage). */
export const TRACK: readonly Waypoint[] = [
  ["#hero", 0.5, 0.02, 1.15, 0],
  ["#como", 0.62, 0.32, 0.62, 0.1],
  ["#calc", -0.7, 0.28, 0.55, 0.3],
  ["#recibo", -0.72, 0.42, 0.5, 0.5],
  ["#numeros", 1.6, 0.2, 0.6, 0.75],
  ["#confianza", 0.58, -0.05, 0.95, 1],
  ["#faq", -0.75, 0.3, 0.5, 1],
  ["#pie", 0.0, 0.3, 1.1, 1],
];

// Face, glyph and rim colours at both ends of the tint (sRGB; three converts to linear).
const FACE = [new Color("#d9d9ec"), new Color("#d4dcc8")];
const GLYPH = [new Color("#151b72"), new Color("#2e3d1d")];
const RIM = [new Color("#cfd0e4"), new Color("#c9d2bd")];

/**
 * A coin face as a mask: R = face (1) vs glyph (0), G = shading (brushed rings, engraved ring,
 * emboss highlight). The material mixes the tinted face/glyph colours from it in the shader.
 */
function faceMask(glyph: string, font: string): CanvasTexture {
  const n = 512;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const shade = (v: number) => `rgb(255,${Math.round(v * 255)},0)`;
  const grad = g.createRadialGradient(n * 0.36, n * 0.3, n * 0.04, n / 2, n / 2, n * 0.55);
  grad.addColorStop(0, shade(1));
  grad.addColorStop(1, shade(0.82));
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  // Brushed concentric lines.
  g.globalAlpha = 0.12;
  for (let r = 6; r < n / 2; r += 4) {
    g.beginPath();
    g.arc(n / 2, n / 2, r, 0, Math.PI * 2);
    g.strokeStyle = shade(0.6);
    g.lineWidth = 1;
    g.stroke();
  }
  g.globalAlpha = 1;
  // Engraved ring: a dark groove with a light edge.
  for (const [r, v, w] of [
    [n * 0.405, 0.55, 8],
    [n * 0.39, 1, 3],
  ] as const) {
    g.beginPath();
    g.arc(n / 2, n / 2, r, 0, Math.PI * 2);
    g.strokeStyle = shade(v);
    g.lineWidth = w;
    g.stroke();
  }
  // Glyph (R = 0); a lighter offset copy underneath reads as an emboss.
  const size = glyph.length > 2 ? n * 0.3 : n * 0.44;
  g.font = `900 ${size}px ${font}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = shade(1);
  g.fillText(glyph, n / 2 + 4, n / 2 + 8);
  g.fillStyle = "rgb(0,230,0)";
  g.fillText(glyph, n / 2, n / 2 + 4);
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace; // a data mask, not a colour image
  t.anisotropy = 4;
  return t;
}

interface Tinted {
  face: Color;
  glyph: Color;
}

function faceMaterial(mask: CanvasTexture, tint: Tinted): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ map: mask, metalness: 0.35, roughness: 0.4 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFace = { value: tint.face };
    shader.uniforms.uGlyph = { value: tint.glyph };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uFace;\nuniform vec3 uGlyph;")
      .replace(
        "#include <map_fragment>",
        "vec4 mk = texture2D( map, vMapUv );\ndiffuseColor.rgb = mix( uGlyph, uFace, mk.r ) * ( 0.55 + 0.45 * mk.g );",
      );
  };
  return m;
}

interface Coin {
  group: Group;
  rim: MeshPhysicalMaterial;
}

function makeCoin(front: string, back: string, font: string, tint: Tinted): Coin {
  const R = 1;
  const T = 0.22;
  const group = new Group();
  const rim = new MeshPhysicalMaterial({ color: RIM[0]!.clone(), metalness: 1, roughness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.12 });
  const body = new Mesh(new CylinderGeometry(R, R, T, 128, 1, true), rim);
  body.rotation.x = Math.PI / 2;
  group.add(body);
  for (const z of [T / 2, -T / 2]) {
    const lip = new Mesh(new TorusGeometry(R * 0.962, T * 0.2, 18, 128), rim);
    lip.position.z = z;
    group.add(lip);
  }
  const faceGeo = new CircleGeometry(R * 0.955, 128);
  const f = new Mesh(faceGeo, faceMaterial(faceMask(front, font), tint));
  f.position.z = T / 2 - 0.004;
  group.add(f);
  const b = new Mesh(faceGeo, faceMaterial(faceMask(back, font), tint));
  b.position.z = -T / 2 + 0.004;
  b.rotation.y = Math.PI;
  group.add(b);
  return { group, rim };
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

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
  scene.environment = env;

  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  const css = getComputedStyle(document.documentElement);
  const font = css.getPropertyValue("--font-archivo").trim() || css.getPropertyValue("--font-sans").trim() || "system-ui, sans-serif";
  // One shared tint, updated per frame; every face material reads it through its uniforms.
  const tint: Tinted = { face: FACE[0]!.clone(), glyph: GLYPH[0]!.clone() };
  const main = makeCoin("R$", "US$", font, tint);
  const sats = [makeCoin("$", "ARS", font, tint), makeCoin("R$", "$", font, tint)];
  const coins = [main, ...sats];
  const rig = new Group();
  rig.add(main.group, ...sats.map((c) => c.group));
  scene.add(rig);

  let vw = 1;
  let vh = 1;
  let halfH = 1; // world half-height at z = 0
  let maxScroll = 1;
  function resize() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    measure();
  }

  // Scroll positions at which each waypoint is reached: the section's middle at mid-screen
  // (clamped to the scrollable range, so the footer's waypoint is reached at the very bottom).
  let stops: { at: number; x: number; y: number; s: number; tint: number }[] = [];
  function measure() {
    maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
    stops = TRACK.flatMap(([sel, x, y, s, t]) => {
      const el = document.querySelector(sel);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      const top = r.top + window.scrollY;
      const at = Math.min(maxScroll, Math.max(0, top + Math.min(r.height, vh) / 2 - vh / 2));
      return [{ at, x, y, s, tint: t }];
    }).sort((a, b) => a.at - b.at);
  }

  function target(scroll: number) {
    if (!stops.length) return { x: 0.5, y: 0, s: 1, tint: 0 };
    if (scroll <= stops[0]!.at) return stops[0]!;
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1]!;
      const b = stops[i]!;
      if (scroll <= b.at) {
        const t = b.at === a.at ? 1 : smooth((scroll - a.at) / (b.at - a.at));
        return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), s: lerp(a.s, b.s, t), tint: lerp(a.tint, b.tint, t) };
      }
    }
    return stops[stops.length - 1]!;
  }

  // Pointer, for the hover reaction (the canvas itself never takes events).
  const pointer = { x: -1e4, y: -1e4 };
  const onMove = (e: PointerEvent) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  };
  const onLeave = () => {
    pointer.x = pointer.y = -1e4;
  };

  const start = target(window.scrollY);
  const cur = { x: start.x, y: start.y, s: start.s, tint: start.tint, p: window.scrollY / maxScroll };
  const lean = { x: 0, y: 0 }; // hover tilt, eased
  let flick = 0; // extra spin (rad), sprung back to rest
  let flickVel = 0;
  let wasOver = false;
  let raf = 0;
  let last = performance.now();
  let time = 0;
  let visible = true;
  const tmp = new Vector3();

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!opts.reducedMotion) time += dt;
    const scroll = window.scrollY;
    const tg = target(scroll);
    const k = opts.reducedMotion ? 1 : 1 - Math.exp(-dt * 6);
    cur.x += (tg.x - cur.x) * k;
    cur.y += (tg.y - cur.y) * k;
    cur.s += (tg.s - cur.s) * k;
    cur.tint += (tg.tint - cur.tint) * k;
    cur.p += (clamp01(scroll / maxScroll) - cur.p) * k;

    // Placement: x/y from the centre in half-viewport units (y up), diameter 0.55 vh at s=1.
    const worldPerPx = (2 * halfH) / vh;
    const diamPx = Math.min(vh * 0.55, vw * 0.7) * cur.s;
    const radius = (diamPx / 2) * worldPerPx;
    rig.position.set(cur.x * (vw / 2) * worldPerPx, cur.y * (vh / 2) * worldPerPx, 0);
    rig.scale.setScalar(radius);

    tint.face.lerpColors(FACE[0]!, FACE[1]!, cur.tint);
    tint.glyph.lerpColors(GLYPH[0]!, GLYPH[1]!, cur.tint);
    for (const c of coins) c.rim.color.lerpColors(RIM[0]!, RIM[1]!, cur.tint);

    // Hover: is the pointer over the big coin's disc on screen?
    main.group.getWorldPosition(tmp).project(camera);
    const cx = (tmp.x * 0.5 + 0.5) * vw;
    const cy = (-tmp.y * 0.5 + 0.5) * vh;
    const dx = (pointer.x - cx) / (diamPx / 2);
    const dy = (pointer.y - cy) / (diamPx / 2);
    const over = dx * dx + dy * dy < 1.1;
    if (over && !wasOver && !opts.reducedMotion) flickVel += 9; // a flick on entry
    wasOver = over;
    const kl = 1 - Math.exp(-dt * 7);
    lean.x += ((over ? dy * 0.45 : 0) - lean.x) * kl;
    lean.y += ((over ? dx * 0.6 : 0) - lean.y) * kl;
    // Damped spring pulling the flick back to rest.
    flickVel += (-flick * 18 - flickVel * 5.5) * dt;
    flick += flickVel * dt;

    // Turn over with the page: the R$ face, angled, in the hero; the US$ face, on edge, at the
    // footer. A gentle sway on top so it never sits dead still.
    const p = cur.p;
    const sway = opts.reducedMotion ? 0 : Math.sin(time * 0.7) * 0.08;
    main.group.rotation.set(0.1 + lean.x + Math.sin(time * 0.5) * 0.03, -0.55 + p * (3 * Math.PI + 0.3) + sway + lean.y + flick, p * (Math.PI / 2));
    main.group.position.y = opts.reducedMotion ? 0 : Math.sin(time * 1.1) * 0.035;

    // Satellites: one either side of the big coin (left a little high, right a little low, as in
    // the design), bobbing on their own and swinging slightly with scroll.
    sats.forEach((c, i) => {
      const a = Math.PI + i * Math.PI + 0.12 + Math.sin(p * Math.PI * 2 + i) * 0.1 + (opts.reducedMotion ? 0 : Math.sin(time * 0.4 + i * 2) * 0.05);
      const bob = opts.reducedMotion ? 0 : Math.sin(time * (0.9 + i * 0.3) + i * 1.7) * 0.05;
      c.group.position.set(Math.cos(a) * 1.45, Math.sin(a) * 0.3 + (i ? -0.12 : 0.2) + bob, Math.sin(a) * 0.35);
      c.group.scale.setScalar(i ? 0.25 : 0.27);
      c.group.rotation.set(0.25, (i ? -0.7 : 1.15) + p * Math.PI * (i ? 2 : 3) + time * 0.25 + flick * 0.5, i ? 0.35 : -0.2);
    });

    renderer.render(scene, camera);
  }

  const onResize = () => resize();
  const onVis = () => {
    visible = document.visibilityState === "visible";
    last = performance.now();
  };
  // Streamed sections change the page height, so re-measure whenever the body resizes.
  const ro = new ResizeObserver(() => measure());
  ro.observe(document.body);
  window.addEventListener("resize", onResize);
  window.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", onVis);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
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
