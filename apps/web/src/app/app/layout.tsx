import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./miniapp.css";

export const metadata: Metadata = {
  title: "Arbolito",
  description: "Cambiá y mandá pesos, reales y dólares desde MiniPay, al mejor precio y con comprobante.",
  robots: { index: false },
};

// viewport-fit=cover so env(safe-area-inset-*) works under notches and the gesture bar.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

// Applies the theme picked in Settings (store key "theme") before first paint, so it never flashes.
const THEME_SCRIPT = `try{var t=JSON.parse(localStorage.getItem("arbolito.mp.theme"));if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function MiniAppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      {children}
    </>
  );
}
