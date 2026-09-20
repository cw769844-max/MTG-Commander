import type { Card, CardSearchResult, DeckLegalityReport } from "@mtg-commander/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  searchCards: (q: string) => request<CardSearchResult>(`/api/cards/search?q=${encodeURIComponent(q)}`),
  getCard: (oracleId: string) => request<Card>(`/api/cards/${oracleId}`),

  listDecks: () => request<Array<{ id: string; name: string }>>("/api/decks"),
  createDeck: (name: string) => request<{ id: string; name: string }>("/api/decks", { method: "POST", body: JSON.stringify({ name }) }),
  getDeck: (id: string) => request<{ id: string; name: string; cards: Array<{ cardOracleId: string; quantity: number; isCommander: boolean }>; legality: DeckLegalityReport }>(`/api/decks/${id}`),
  saveDeckCards: (id: string, cards: Array<{ cardOracleId: string; quantity: number; isCommander: boolean }>) =>
    request<{ ok: true; legality: DeckLegalityReport }>(`/api/decks/${id}/cards`, { method: "PUT", body: JSON.stringify({ cards }) }),
};
