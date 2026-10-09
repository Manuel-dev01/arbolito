import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { messages } from "../i18n/messages";
import "./globals.css";

const t = messages("es");

export const metadata: Metadata = {
  metadataBase: process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL) : undefined,
  title: { default: t.meta.title, template: "%s · Arbolito" },
  description: t.meta.description,
  openGraph: { siteName: "Arbolito", type: "website" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1411" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
