import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import type { GameLogEntry, GameState, TurnPhase, ZoneId } from "@mtg-commander/shared";
import { socket } from "../socket";
import { useCardCache } from "../hooks/useCardCache";
import { useWebRTCMesh } from "../hooks/useWebRTCMesh";
import PlayerBoard from "../components/PlayerBoard";
import VideoTile from "../components/VideoTile";

const PHASES: TurnPhase[] = [
  "untap",
  "upkeep",
  "draw",
  "main1",
  "combat_begin",
  "combat_attackers",
  "combat_blockers",
  "combat_damage",
  "combat_end",
  "main2",
  "end",
  "cleanup",
];

export default function GameTable() {
  const { roomCode = "" } = useParams<{ roomCode: string }>();
  const location = useLocation();
  const navState = location.state as { displayName?: string; deckId?: string | null } | null;

  const [displayName] = useState(() => navState?.displayName || prompt("Your display name") || "Player");
  const [deckId] = useState(() => navState?.deckId ?? null);

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [chat, setChat] = useState<Array<{ seat: number; message: string; timestamp: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { get: getCard, ensure: ensureCard } = useCardCache();

  const joinedRef = useRef(false);

  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;

    socket.connect();
    socket.emit("room:join", { roomCode, displayName, deckId }, (result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setGameState(result.state);
      setMySeat(result.seat);
    });

    socket.on("room:state", setGameState);
    socket.on("game:log", (entry: GameLogEntry) => {
      setGameState((prev) => (prev ? { ...prev, log: [...prev.log, entry] } : prev));
    });
    socket.on("chat:message", (msg) => setChat((prev) => [...prev, msg]));
    socket.on("error", (e) => setError(e.message));

    return () => {
      socket.emit("room:leave");
      socket.off("room:state", setGameState);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectedSeats = (gameState?.players ?? []).filter((p) => p.connected).map((p) => p.seat);
  const { localStream, remoteStreams } = useWebRTCMesh(socket, mySeat, connectedSeats, true);

  function moveObject(instanceId: string, toZone: ZoneId) {
    socket.emit("game:moveObject", { instanceId, toZone });
  }

  function toggleTap(instanceId: string, tapped: boolean) {
    socket.emit("game:tapObject", { instanceId, tapped });
  }

  function drawCard() {
    socket.emit("game:drawCard", { count: 1 });
  }

  function shuffle() {
    socket.emit("game:shuffleLibrary");
  }

  function setPhase(phase: TurnPhase) {
    socket.emit("game:setPhase", { phase });
  }

  function passTurn() {
    socket.emit("game:passTurn");
  }

  function sendChat() {
    if (!chatInput.trim()) return;
    socket.emit("chat:message", { message: chatInput.trim() });
    setChatInput("");
  }

  if (error) {
    return (
      <div className="page">
        <h1>Could not join game</h1>
        <p>{error}</p>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="page">
        <p>Joining room {roomCode}...</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Room {gameState.roomCode}</h1>

      <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        <span>
          Turn: seat {gameState.turnSeat} · Phase:{" "}
          <select value={gameState.phase} onChange={(e) => setPhase(e.target.value as TurnPhase)}>
            {PHASES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </span>
        <button onClick={passTurn}>Pass turn</button>
        <button onClick={drawCard}>Draw a card</button>
        <button onClick={shuffle}>Shuffle library</button>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <VideoTile stream={localStream} label={`You (${displayName})`} muted />
        {Object.entries(remoteStreams).map(([seat, stream]) => {
          const p = gameState.players.find((pl) => pl.seat === Number(seat));
          return <VideoTile key={seat} stream={stream} label={p?.displayName ?? `Seat ${seat}`} />;
        })}
      </div>

      {gameState.players.map((player) => (
        <PlayerBoard
          key={player.seat}
          player={player}
          objects={gameState.objects.filter((o) => o.ownerSeat === player.seat)}
          mySeat={mySeat}
          getCard={getCard}
          ensureCard={ensureCard}
          onMove={moveObject}
          onToggleTap={toggleTap}
          onSetLife={(life) => socket.emit("game:setLife", { seat: player.seat, life })}
          onSetCommanderDamageFromMe={(amount) => {
            if (mySeat === null) return;
            socket.emit("game:setCommanderDamage", { fromSeat: mySeat, toSeat: player.seat, amount });
          }}
        />
      ))}

      <h2>Chat &amp; log</h2>
      <div style={{ display: "flex", gap: "1rem" }}>
        <div style={{ flex: 1, maxHeight: "200px", overflowY: "auto", border: "1px solid #2a2d36", padding: "0.5rem" }}>
          {gameState.log.map((entry) => (
            <div key={entry.id} style={{ fontSize: "0.8rem", opacity: 0.8 }}>
              {entry.message}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, maxHeight: "200px", overflowY: "auto", border: "1px solid #2a2d36", padding: "0.5rem" }}>
          {chat.map((c, i) => (
            <div key={i} style={{ fontSize: "0.85rem" }}>
              <strong>Seat {c.seat}:</strong> {c.message}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendChat()} style={{ flex: 1 }} />
        <button onClick={sendChat}>Send</button>
      </div>
    </div>
  );
}
