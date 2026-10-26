import type { Metadata, Viewport } from "next";
import { Archivo, Instrument_Serif, JetBrains_Mono, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import { messages } from "../i18n/messages";
import "./tokens.css";
import "./globals.css";

// Design system fonts: serif for headlines and amounts, sans for UI, mono for exact data.
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif", display: "swap" });
const sans = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-sans", display: "swap" });
// Archivo Black weight: only the landing coin glyphs and the spinning badge (as in the design).
const archivo = Archivo({ subsets: ["latin"], weight: ["800", "900"], variable: "--font-archivo", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });

const t = messages("es");

export const metadata: Metadata = {
  metadataBase: process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL) : undefined,
  title: { default: t.meta.title, template: "%s · Arbolito" },
  description: t.meta.description,
  openGraph: { siteName: "Arbolito", type: "website" },
};

export const viewport: Viewport = {
  themeColor: "#f2f3f7",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${serif.variable} ${sans.variable} ${mono.variable} ${archivo.variable}`}>
      <body>{children}</body>
    </html>
  );
}
