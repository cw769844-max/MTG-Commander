import { useState } from "react";
import type { Card, GameObject, PlayerState, TargetKind } from "@mtg-commander/shared";
import CardMenu, { type CardActions } from "./CardMenu";

interface Props extends CardActions {
  obj: GameObject;
  card: Card | undefined;
  /** True when the viewer controls this card and may manipulate it. */
  canManipulate: boolean;
  players: PlayerState[];
  mySeat: number | null;
  /** Set while this card is being declared or targeted by someone. */
  highlight: TargetKind | null;
}

export default function GameObjectCard({ obj, card, canManipulate, players, mySeat, highlight, ...actions }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  // The server sends no oracle id for cards we aren't entitled to see, so
  // there is nothing to render a face from.
  const hidden = obj.cardOracleId === null;

  return (
    <div
      style={{ position: "relative", width: "100px" }}
      onMouseEnter={() => setMenuOpen(true)}
      onMouseLeave={() => setMenuOpen(false)}
    >
      <div
        className={`card-tile${highlight ? ` highlight-${highlight}` : ""}`}
        draggable={canManipulate}
        onDragStart={(e) => {
          if (!canManipulate) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData("text/plain", obj.instanceId);
          e.dataTransfer.effectAllowed = "move";
        }}
        style={{
          width: "100px",
          transform: obj.tapped ? "rotate(90deg)" : undefined,
          transition: "transform 0.15s",
          cursor: canManipulate ? "grab" : "default",
          opacity: canManipulate ? 1 : 0.92,
        }}
      >
        {hidden || obj.faceDown || !card ? (
          <div
            style={{ height: "70px", background: "#3a3d4a", borderRadius: "4px" }}
            title={obj.faceDown ? "Face down" : hidden ? "Hidden from you" : "Loading card"}
          />
        ) : (
          <img src={card.imageNormal ?? undefined} alt={card.name} />
        )}
        <div style={{ fontSize: "0.7rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {obj.faceDown ? "Face down" : hidden ? "Hidden" : card?.name ?? "..."}
        </div>
      </div>

      {menuOpen && (
        <CardMenu obj={obj} canManipulate={canManipulate} players={players} mySeat={mySeat} {...actions} />
      )}
    </div>
  );
}
