import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import type { ClientGameState, GameLogEntry, GameObject, TargetKind, TurnPhase, ZoneId } from "@mtg-commander/shared";
import { socket } from "../socket";
import { useAuth } from "../context/AuthContext";
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
  const navState = location.state as
    | { displayName?: string; deckId?: string | null; asSpectator?: boolean }
    | null;
  const { user } = useAuth();

  const [displayName] = useState(() => navState?.displayName || user?.displayName || "Player");
  const [deckId] = useState(() => navState?.deckId ?? null);
  const [asSpectator] = useState(() => navState?.asSpectator === true);

  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [chat, setChat] = useState<
    Array<{ seat: number | null; displayName: string; isSpectator: boolean; message: string; timestamp: string }>
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState<GameObject[] | null>(null);
  // instanceId -> the kind of pulse currently playing on that card.
  const [highlights, setHighlights] = useState<Record<string, TargetKind>>({});
  const { get: getCard, ensure: ensureCard } = useCardCache();

  useEffect(() => {
    // Named handlers (rather than inline closures passed straight to `.on`)
    // so cleanup can remove exactly what this effect run added. Needed for
    // React 18 StrictMode, which mounts effects twice in dev: without
    // symmetric add/remove, the first run's cleanup either leaves listeners
    // behind (duplicated log/chat entries) or, if it disconnects the shared
    // socket, kills the second run's connection before it can join.
    const handleState = (state: ClientGameState) => setGameState(state);
    const handleLog = (entry: GameLogEntry) => {
      setGameState((prev) => (prev ? { ...prev, log: [...prev.log, entry] } : prev));
    };
    const handleChat = (msg: { seat: number | null; displayName: string; isSpectator: boolean; message: string; timestamp: string }) =>
      setChat((prev) => [...prev, msg]);
    const handleError = (e: { message: string }) => setError(e.message);
    const handleTargeted = ({ instanceId, kind }: { instanceId: string; kind: TargetKind }) => {
      setHighlights((prev) => ({ ...prev, [instanceId]: kind }));
      // Long enough for the three pulses to finish before the ring clears.
      window.setTimeout(() => {
        setHighlights((prev) => {
          const next = { ...prev };
          delete next[instanceId];
          return next;
        });
      }, 2200);
    };

    socket.on("room:state", handleState);
    socket.on("game:log", handleLog);
    socket.on("chat:message", handleChat);
    socket.on("error", handleError);
    socket.on("game:targeted", handleTargeted);

    socket.connect();
    socket.emit("room:join", { roomCode, displayName, deckId, asSpectator }, (result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setGameState(result.state);
      setMySeat(result.seat);
    });

    return () => {
      socket.emit("room:leave");
      socket.off("room:state", handleState);
      socket.off("game:log", handleLog);
      socket.off("chat:message", handleChat);
      socket.off("error", handleError);
      socket.off("game:targeted", handleTargeted);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectedSeats = (gameState?.players ?? []).filter((p) => p.connected).map((p) => p.seat);
  const { localStream, remoteStreams } = useWebRTCMesh(socket, mySeat, connectedSeats, !asSpectator);

  function moveObject(instanceId: string, toZone: ZoneId, x?: number, y?: number) {
    socket.emit("game:moveObject", { instanceId, toZone, x, y });
  }

  function toggleTap(instanceId: string, tapped: boolean) {
    socket.emit("game:tapObject", { instanceId, tapped });
  }

  function flipObject(instanceId: string, faceDown: boolean) {
    socket.emit("game:flipObject", { instanceId, faceDown });
  }

  function targetObject(instanceId: string, kind: TargetKind) {
    socket.emit("game:targetObject", { instanceId, kind });
  }

  function giveControl(instanceId: string, seat: number) {
    socket.emit("game:setController", { instanceId, toSeat: seat });
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

  function searchLibrary() {
    socket.emit("game:searchLibrary", (result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      for (const obj of result.cards) ensureCard(obj.cardOracleId);
      setLibrarySearch(result.cards);
    });
  }

  function takeFromLibrary(instanceId: string, zone: ZoneId) {
    moveObject(instanceId, zone);
    setLibrarySearch((prev) => prev && prev.filter((o) => o.instanceId !== instanceId));
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

      {asSpectator && (
        <div
          style={{
            border: "1px solid #8ab4f8",
            borderRadius: "6px",
            padding: "0.5rem 0.75rem",
            marginBottom: "1rem",
            fontSize: "0.9rem",
          }}
        >
          You're watching this game. Hands and libraries stay hidden from spectators, and you can't touch the board —
          but you can chat.
        </div>
      )}

      <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        <span>
          Turn: seat {gameState.turnSeat} · Phase:{" "}
          {asSpectator ? (
            <strong>{gameState.phase}</strong>
          ) : (
            <select value={gameState.phase} onChange={(e) => setPhase(e.target.value as TurnPhase)}>
              {PHASES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </span>
        {!asSpectator && (
          <>
            <button onClick={passTurn}>Pass turn</button>
            <button onClick={drawCard}>Draw a card</button>
            <button onClick={shuffle}>Shuffle library</button>
            <button onClick={searchLibrary}>Search library</button>
          </>
        )}
        {gameState.spectators.length > 0 && (
          <span style={{ opacity: 0.75, fontSize: "0.85rem" }}>
            Watching: {gameState.spectators.map((s) => s.displayName).join(", ")}
          </span>
        )}
      </div>

      {librarySearch && (
        <div style={{ border: "1px solid #2a2d36", borderRadius: "8px", padding: "0.75rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Your library ({librarySearch.length})</strong>
            <button onClick={() => setLibrarySearch(null)}>Close</button>
          </div>
          <p style={{ fontSize: "0.8rem", opacity: 0.7, margin: "0.25rem 0" }}>
            Shown in a random order — the real order stays hidden, so shuffle after you take something.
          </p>
          <div style={{ maxHeight: "220px", overflowY: "auto" }}>
            {[...librarySearch]
              .sort((a, b) => (getCard(a.cardOracleId)?.name ?? "").localeCompare(getCard(b.cardOracleId)?.name ?? ""))
              .map((obj) => (
                <div key={obj.instanceId} style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.85rem" }}>
                  <span style={{ flex: 1 }}>{getCard(obj.cardOracleId)?.name ?? "..."}</span>
                  <button onClick={() => takeFromLibrary(obj.instanceId, "hand")}>To hand</button>
                  <button onClick={() => takeFromLibrary(obj.instanceId, "battlefield")}>To battlefield</button>
                </div>
              ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {!asSpectator && <VideoTile stream={localStream} label={`You (${displayName})`} muted />}
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
          librarySize={gameState.librarySizes[player.seat] ?? 0}
          players={gameState.players}
          onMove={moveObject}
          onToggleTap={toggleTap}
          onFlip={flipObject}
          onTarget={targetObject}
          onGiveControl={giveControl}
          highlightOf={(instanceId) => highlights[instanceId] ?? null}
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
              <strong>
                {c.displayName}
                {c.isSpectator && " (watching)"}:
              </strong>{" "}
              {c.message}
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
