"use client";

import { useEffect, useState } from "react";
import { parseNames } from "../../lib/payout-link";

/** A payee's name from the link's #fragment (it never reaches the server), else the short wallet. */
export function PayeeName({ index, fallback }: { index: number; fallback: string }) {
  const [name, setName] = useState("");
  useEffect(() => {
    const read = () => setName(parseNames(window.location.hash)[index] ?? "");
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [index]);
  return name ? (
    <>
      <b>{name}</b> <span className="mono small muted">{fallback}</span>
    </>
  ) : (
    <span className="mono">{fallback}</span>
  );
}

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="btn btn-primary btn-sm no-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}
