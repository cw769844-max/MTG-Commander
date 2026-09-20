import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function Lobby() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [decks, setDecks] = useState<Array<{ id: string; name: string }>>([]);
  const [deckId, setDeckId] = useState<string>("");
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    api.listDecks().then(setDecks).catch(console.error);
  }, []);

  function enterRoom(roomCode: string) {
    navigate(`/game/${roomCode}`, { state: { displayName: user!.displayName, deckId: deckId || null } });
  }

  return (
    <div className="page">
      <h1>Play Commander</h1>
      <p>Playing as {user?.displayName}</p>

      <div style={{ marginBottom: "1rem" }}>
        <label>
          Deck to bring{" "}
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            <option value="">(no deck / spectate manually)</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: "flex", gap: "2rem" }}>
        <button onClick={() => enterRoom(randomCode())}>Create new game</button>

        <div>
          <input placeholder="Room code" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
          <button onClick={() => enterRoom(joinCode.trim())} disabled={!joinCode.trim()}>
            Join game
          </button>
        </div>
      </div>

      <p style={{ marginTop: "1rem", opacity: 0.7 }}>Up to 4 players per game. Share the room code with your pod.</p>
    </div>
  );
}
