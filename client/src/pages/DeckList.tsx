import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

export default function DeckList() {
  const [decks, setDecks] = useState<Array<{ id: string; name: string }>>([]);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    api.listDecks().then(setDecks).catch(console.error);
  }, []);

  async function createDeck() {
    if (!newName.trim()) return;
    const deck = await api.createDeck(newName.trim());
    setDecks((prev) => [...prev, deck]);
    setNewName("");
  }

  return (
    <div className="page">
      <h1>My Decks</h1>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New deck name" />
        <button onClick={createDeck}>Create deck</button>
      </div>
      <ul>
        {decks.map((deck) => (
          <li key={deck.id}>
            <Link to={`/decks/${deck.id}`}>{deck.name}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
