/**
 * The landing's 3D coin, in CSS 3D transforms and inline SVG instead of three.js.
 *
 * Why not three.js: the design asks for a coin that only exists on the landing and only when
 * prefers-reduced-motion is off. three.js would add roughly 150 kB of gzipped JS plus a WebGL
 * context on low-end Android phones on slow connections, for a decorative object. This version
 * ships zero JS: faces are SVG, the rim is stacked layers, the spin is a CSS animation, and the
 * whole stage is `display: none` under prefers-reduced-motion (see .coin-stage in globals.css).
 */
const RIM_LAYERS = 10;

function Face({ back = false }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 200 200" className={back ? "coin-face coin-back" : "coin-face coin-front"} aria-hidden="true" focusable="false">
      <circle cx="100" cy="100" r="97" className="coin-disc" />
      <circle cx="100" cy="100" r="84" className="coin-ring" />
      <defs>
        <path id={back ? "coin-arc-b" : "coin-arc-f"} d="M100,100 m-70,0 a70,70 0 1,1 140,0 a70,70 0 1,1 -140,0" />
      </defs>
      <text className="coin-arc-text">
        <textPath href={back ? "#coin-arc-b" : "#coin-arc-f"}>{back ? "ARS · BRL · USD · ARS · BRL · USD · " : "ARBOLITO · CAMBISTA · ARBOLITO · CAMBISTA · "}</textPath>
      </text>
      {back ? (
        <text x="100" y="118" textAnchor="middle" className="coin-glyph">
          $
        </text>
      ) : (
        <g>
          <circle cx="78" cy="100" r="11" className="coin-dot-1" />
          <circle cx="100" cy="100" r="11" className="coin-dot-2" />
          <circle cx="122" cy="100" r="11" className="coin-dot-3" />
        </g>
      )}
    </svg>
  );
}

export function Coin({ className }: { className?: string }) {
  return (
    <div className={className ? `coin-stage ${className}` : "coin-stage"} aria-hidden="true">
      <div className="coin-bob">
        <div className="coin">
          <Face />
          {Array.from({ length: RIM_LAYERS }, (_, i) => (
            <span key={i} className="coin-rim" style={{ ["--i" as string]: i }} />
          ))}
          <Face back />
        </div>
      </div>
    </div>
  );
}
