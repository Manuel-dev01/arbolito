"use client";

import { useEffect, useState } from "react";
import type { ApiClient, Receipt } from "../../lib/miniapp/client/api";
import type { Lang } from "../../lib/miniapp/client/format";

const caches = new WeakMap<ApiClient, Map<string, Receipt>>();
const cacheFor = (api: ApiClient) => {
  let m = caches.get(api);
  if (!m) caches.set(api, (m = new Map()));
  return m;
};

/** One receipt, polled while its fingerprint is still registering (Registrando → Verificado / No coincide). */
export function useReceipt(api: ApiClient, id: string | null): { data: Receipt | null; error: boolean } {
  const [data, setData] = useState<Receipt | null>(() => (id ? cacheFor(api).get(id) ?? null : null));
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!id) return;
    let stop = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      tries++;
      try {
        const r = await api.receipt(id);
        if (stop) return;
        cacheFor(api).set(id, r);
        setData(r);
        setError(false);
        if (r.status === "registering" && tries < 90) timer = setTimeout(tick, 2000);
      } catch {
        if (stop) return;
        setError(true);
        if (tries < 10) timer = setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, id]);
  return { data, error };
}

/** Several receipts (list screens), fetched once each. */
export function useReceiptList(api: ApiClient, ids: string[]): Map<string, Receipt> {
  const key = ids.join(",");
  const [map, setMap] = useState<Map<string, Receipt>>(() => new Map(ids.flatMap((i) => (cacheFor(api).has(i) ? [[i, cacheFor(api).get(i)!]] : []))));
  useEffect(() => {
    let stop = false;
    const list = key ? key.split(",") : [];
    void Promise.all(
      list.map(async (id) => {
        const c = cacheFor(api).get(id);
        if (c && c.status !== "registering") return [id, c] as const;
        try {
          const r = await api.receipt(id);
          cacheFor(api).set(id, r);
          return [id, r] as const;
        } catch {
          return null;
        }
      }),
    ).then((rows) => {
      if (!stop) setMap(new Map(rows.filter((r): r is readonly [string, Receipt] => r !== null)));
    });
    return () => {
      stop = true;
    };
  }, [api, key]);
  return map;
}

const LOC: Record<Lang, string> = { es: "es-AR", pt: "pt-BR", en: "en-US" };

/** "Hoy · 10:42", "Ayer · 20:03", "7 oct · 11:30". */
export function whenLabel(iso: string, lang: Lang, words: { today: string; yesterday: string }): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(LOC[lang], { hour: "2-digit", minute: "2-digit", hour12: false });
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const day = Math.floor((start.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  const date = day === 0 ? words.today : day === 1 ? words.yesterday : d.toLocaleDateString(LOC[lang], { day: "numeric", month: "short" }).replace(".", "");
  return `${date} · ${time}`;
}

/** "Octubre 2026" style month heading. */
export function monthLabel(iso: string, lang: Lang): string {
  const s = new Date(iso).toLocaleDateString(LOC[lang], { month: "long", year: "numeric" }).replace(" de ", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
