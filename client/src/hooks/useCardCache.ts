import { useCallback, useRef, useState } from "react";
import type { Card } from "@mtg-commander/shared";
import { api } from "../api/client";

export function useCardCache() {
  const cache = useRef(new Map<string, Card>());
  const inflight = useRef(new Set<string>());
  const [, forceRender] = useState(0);

  const ensure = useCallback((oracleId: string) => {
    if (cache.current.has(oracleId) || inflight.current.has(oracleId)) return;
    inflight.current.add(oracleId);
    api
      .getCard(oracleId)
      .then((card) => {
        cache.current.set(oracleId, card);
        forceRender((n) => n + 1);
      })
      .catch(console.error)
      .finally(() => inflight.current.delete(oracleId));
  }, []);

  const get = useCallback((oracleId: string) => cache.current.get(oracleId), []);

  return { get, ensure };
}
