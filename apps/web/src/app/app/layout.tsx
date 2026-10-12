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
};

export default function MiniAppLayout({ children }: { children: ReactNode }) {
  return children;
}
