import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BRACKETS, POD_SIZES, type MatchFound, type PodSize, type QueueStatus } from "@mtg-commander/shared";
import { api, type DeckSummary } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { socket } from "../socket";

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function Lobby() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [deckId, setDeckId] = useState<string>("");
  const [joinCode, setJoinCode] = useState("");
  const [watchCode, setWatchCode] = useState("");
  const [podSize, setPodSize] = useState<PodSize>(4);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  const selectedDeck = decks.find((d) => d.id === deckId) ?? null;

  useEffect(() => {
    api.listDecks().then(setDecks).catch(console.error);
  }, []);

  useEffect(() => {
    const handleStatus = (status: QueueStatus) => setQueueStatus(status);
    const handleMatched = (match: MatchFound) => {
      setQueueStatus(null);
      navigate(`/game/${match.roomCode}`, { state: { displayName: user?.displayName, deckId } });
    };

    socket.on("matchmaking:status", handleStatus);
    socket.on("matchmaking:matched", handleMatched);
    return () => {
      socket.off("matchmaking:status", handleStatus);
      socket.off("matchmaking:matched", handleMatched);
    };
  }, [navigate, user, deckId]);

  // Leaving the page shouldn't leave a ghost in the queue.
  useEffect(() => {
    return () => {
      if (socket.connected) socket.emit("matchmaking:leave");
    };
  }, []);

  function enterRoom(roomCode: string) {
    navigate(`/game/${roomCode}`, { state: { displayName: user!.displayName, deckId: deckId || null } });
  }

  function findPod() {
    if (!deckId) {
      setQueueError("Pick a deck to queue with.");
      return;
    }
    setQueueError(null);
    if (!socket.connected) socket.connect();
    socket.emit("matchmaking:join", { deckId, podSize }, (result) => {
      if (!result.ok) {
        setQueueError(result.error);
        setQueueStatus(null);
        return;
      }
      setQueueStatus(result.status);
    });
  }

  function cancelQueue() {
    socket.emit("matchmaking:leave");
    setQueueStatus(null);
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
                {d.name} — bracket {d.bracket} ({BRACKETS[d.bracket].name})
              </option>
            ))}
          </select>
        </label>
      </div>

      <section style={{ border: "1px solid #2a2d36", borderRadius: "8px", padding: "0.75rem", marginBottom: "1.5rem" }}>
        <h2 style={{ marginTop: 0 }}>Find a pod</h2>
        <p style={{ fontSize: "0.85rem", opacity: 0.8, marginTop: 0 }}>
          You're matched with players whose decks are in the same bracket. Your deck has to be Commander-legal and
          actually match the bracket it claims.
        </p>

        {queueStatus ? (
          <div>
            <p>
              Searching for a bracket {queueStatus.bracket} ({BRACKETS[queueStatus.bracket].name}) pod —{" "}
              <strong>
                {queueStatus.waiting} / {queueStatus.podSize}
              </strong>{" "}
              players ready.
            </p>
            <button onClick={cancelQueue}>Cancel search</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <label>
              Pod size{" "}
              <select value={podSize} onChange={(e) => setPodSize(Number(e.target.value) as PodSize)}>
                {POD_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} players
                  </option>
                ))}
              </select>
            </label>
            <span style={{ opacity: 0.8 }}>
              Queueing at bracket{" "}
              {selectedDeck ? `${selectedDeck.bracket} (${BRACKETS[selectedDeck.bracket].name})` : "— pick a deck"}
            </span>
            <button onClick={findPod} disabled={!deckId}>
              Find a pod
            </button>
          </div>
        )}

        {queueError && <p className="issue-error">{queueError}</p>}
      </section>

      <h2>Play with friends</h2>
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

      <h2>Watch a game</h2>
      <p style={{ fontSize: "0.85rem", opacity: 0.8, marginTop: 0 }}>
        Spectators see the same thing as someone standing behind the table: the battlefield and everyone's graveyards,
        but no hands or libraries.
      </p>
      <div>
        <input placeholder="Room code" value={watchCode} onChange={(e) => setWatchCode(e.target.value.toUpperCase())} />
        <button
          onClick={() =>
            navigate(`/game/${watchCode.trim()}`, {
              state: { displayName: user!.displayName, deckId: null, asSpectator: true },
            })
          }
          disabled={!watchCode.trim()}
        >
          Watch game
        </button>
      </div>
    </div>
  );
}
