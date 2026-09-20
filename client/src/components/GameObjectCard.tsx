import type { Card, GameObject, ZoneId } from "@mtg-commander/shared";

const ZONES: ZoneId[] = ["library", "hand", "battlefield", "graveyard", "exile", "command"];

interface Props {
  obj: GameObject;
  card: Card | undefined;
  /** Hide the face for cards an opponent hasn't revealed (their hand/library). */
  hidden: boolean;
  onMove: (zone: ZoneId) => void;
  onToggleTap: () => void;
}

export default function GameObjectCard({ obj, card, hidden, onMove, onToggleTap }: Props) {
  return (
    <div
      className="card-tile"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", obj.instanceId);
        e.dataTransfer.effectAllowed = "move";
      }}
      style={{
        width: "100px",
        transform: obj.tapped ? "rotate(90deg)" : undefined,
        transition: "transform 0.15s",
        cursor: "grab",
      }}
    >
      {hidden || !card ? (
        <div style={{ height: "70px", background: "#3a3d4a", borderRadius: "4px" }} title="Face down" />
      ) : (
        <img src={card.imageNormal ?? undefined} alt={card.name} />
      )}
      <div style={{ fontSize: "0.7rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {hidden ? "Hidden" : card?.name ?? obj.cardOracleId}
      </div>
      {obj.zone === "battlefield" && (
        <button onClick={onToggleTap} style={{ fontSize: "0.65rem" }}>
          {obj.tapped ? "Untap" : "Tap"}
        </button>
      )}
      <select value={obj.zone} onChange={(e) => onMove(e.target.value as ZoneId)} style={{ fontSize: "0.65rem", width: "100%" }}>
        {ZONES.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>
    </div>
  );
}
