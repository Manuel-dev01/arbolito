"use client";

import { useEffect, useState } from "react";

/** A moment in the reader's own time zone. The server doesn't know it, so it renders UTC first. */
export function LocalTime({ iso, locale, options, className }: { iso: string; locale: string; options: Intl.DateTimeFormatOptions; className?: string }) {
  const [zone, setZone] = useState<string | undefined>("UTC");
  useEffect(() => setZone(undefined), []);
  return (
    // Node and the browser may space a date differently; the effect writes the reader's own version.
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).format(new Date(iso))}
    </time>
  );
}
