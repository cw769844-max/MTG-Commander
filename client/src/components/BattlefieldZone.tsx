import { useRef, useState } from "react";
import type { Card, GameObject, PlayerState, TargetKind, ZoneId } from "@mtg-commander/shared";
import GameObjectCard from "./GameObjectCard";

const CARD_WIDTH = 100;
const CARD_HEIGHT = 150;

interface Props {
  objects: GameObject[];
  getCard: (oracleId: string | null) => Card | undefined;
  onDropAt: (instanceId: string, x: number, y: number) => void;
  onMoveZone: (instanceId: string, zone: ZoneId) => void;
  onToggleTap: (instanceId: string, tapped: boolean) => void;
  onFlip: (instanceId: string, faceDown: boolean) => void;
  onTarget: (instanceId: string, kind: TargetKind) => void;
  onGiveControl: (instanceId: string, seat: number) => void;
  highlightOf: (instanceId: string) => TargetKind | null;
  players: PlayerState[];
  mySeat: number | null;
}

/**
 * A free-form drop surface: cards keep the x/y they were last dropped at
 * (persisted on the GameObject itself) so a board can be laid out like a
 * real table instead of a card list.
 */
export default function BattlefieldZone({
  objects,
  getCard,
  onDropAt,
  onMoveZone,
  onToggleTap,
  onFlip,
  onTarget,
  onGiveControl,
  highlightOf,
  players,
  mySeat,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsOver(false);
    const instanceId = e.dataTransfer.getData("text/plain");
    if (!instanceId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - rect.left - CARD_WIDTH / 2), Math.max(0, rect.width - CARD_WIDTH));
    const y = Math.min(Math.max(0, e.clientY - rect.top - CARD_HEIGHT / 2), Math.max(0, rect.height - CARD_HEIGHT));
    onDropAt(instanceId, Math.round(x), Math.round(y));
  }

  return (
    <div
      ref={containerRef}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={() => setIsOver(true)}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
      style={{
        position: "relative",
        minHeight: `${CARD_HEIGHT + 20}px`,
        border: `1px dashed ${isOver ? "#8ab4f8" : "#2a2d36"}`,
        borderRadius: "6px",
        background: "#181a20",
        marginBottom: "0.5rem",
      }}
    >
      {objects.length === 0 && (
        <div style={{ opacity: 0.4, padding: "0.5rem", fontSize: "0.8rem" }}>Battlefield — drag cards here to play them</div>
      )}
      {objects.map((obj) => (
        <div key={obj.instanceId} style={{ position: "absolute", left: obj.x, top: obj.y }}>
          <GameObjectCard
            obj={obj}
            card={getCard(obj.cardOracleId)}
            onMove={(zone) => onMoveZone(obj.instanceId, zone)}
            onToggleTap={() => onToggleTap(obj.instanceId, !obj.tapped)}
            canManipulate={obj.controllerSeat === mySeat}
            players={players}
            mySeat={mySeat}
            highlight={highlightOf(obj.instanceId)}
            onFlip={(faceDown) => onFlip(obj.instanceId, faceDown)}
            onTarget={(kind) => onTarget(obj.instanceId, kind)}
            onGiveControl={(seat) => onGiveControl(obj.instanceId, seat)}
          />
        </div>
      ))}
    </div>
  );
}
