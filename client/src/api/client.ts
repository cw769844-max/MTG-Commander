import type { AuthUser, Card, CardSearchResult, DeckLegalityReport } from "@mtg-commander/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  register: (email: string, password: string, displayName: string) =>
    request<AuthUser>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, displayName }) }),
  login: (email: string, password: string) =>
    request<AuthUser>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<AuthUser>("/api/auth/me"),

  searchCards: (q: string) => request<CardSearchResult>(`/api/cards/search?q=${encodeURIComponent(q)}`),
  getCard: (oracleId: string) => request<Card>(`/api/cards/${oracleId}`),

  listDecks: () => request<Array<{ id: string; name: string }>>("/api/decks"),
  createDeck: (name: string) => request<{ id: string; name: string }>("/api/decks", { method: "POST", body: JSON.stringify({ name }) }),
  getDeck: (id: string) => request<{ id: string; name: string; cards: Array<{ cardOracleId: string; quantity: number; isCommander: boolean }>; legality: DeckLegalityReport }>(`/api/decks/${id}`),
  saveDeckCards: (id: string, cards: Array<{ cardOracleId: string; quantity: number; isCommander: boolean }>) =>
    request<{ ok: true; legality: DeckLegalityReport }>(`/api/decks/${id}/cards`, { method: "PUT", body: JSON.stringify({ cards }) }),
};
