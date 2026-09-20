import { useState } from "react";
import type { Card } from "@mtg-commander/shared";
import { api } from "../api/client";

interface Props {
  onAdd: (card: Card, asCommander: boolean) => void;
}

export default function CardSearch({ onAdd }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);

  async function runSearch(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.searchCards(q.trim());
      setResults(res.cards);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <input placeholder="Search cards by name..." value={query} onChange={(e) => runSearch(e.target.value)} style={{ width: "100%", padding: "0.5rem" }} />
      {loading && <p>Searching...</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
        {results.map((card) => (
          <div key={card.oracleId} className="card-tile">
            {card.imageNormal && <img src={card.imageNormal} alt={card.name} />}
            <div>{card.name}</div>
            <div style={{ display: "flex", gap: "0.25rem" }}>
              <button onClick={() => onAdd(card, false)}>Add</button>
              {card.canBeCommander && <button onClick={() => onAdd(card, true)}>As commander</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
