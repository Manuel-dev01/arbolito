"use client";

import { useEffect, useState } from "react";

/**
 * The address the browser actually asked for, shown on the 404. A wallet's in-app browser can
 * rewrite what the user typed (MiniPay's "Load test page" landed on the 404 on 2026-11-02 with a
 * correct-looking address); seeing the real URL is what makes that fixable.
 */
export function RequestedUrl() {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => setHref(window.location.href), []);
  if (!href) return null;
  return (
    <p className="small muted mono" style={{ wordBreak: "break-all" }}>
      {href}
    </p>
  );
}
