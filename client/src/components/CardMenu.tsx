import type { GameObject, PlayerState, TargetKind, ZoneId } from "@mtg-commander/shared";

export interface CardActions {
  onMove: (zone: ZoneId) => void;
  onToggleTap: () => void;
  onFlip: (faceDown: boolean) => void;
  onTarget: (kind: TargetKind) => void;
  onGiveControl: (seat: number) => void;
}

interface Props extends CardActions {
  obj: GameObject;
  /** True when the viewer controls this card and may actually manipulate it. */
  canManipulate: boolean;
  players: PlayerState[];
  mySeat: number | null;
}

const MOVE_TARGETS: Array<{ zone: ZoneId; label: string }> = [
  { zone: "battlefield", label: "To battlefield" },
  { zone: "hand", label: "To hand" },
  { zone: "graveyard", label: "Send to graveyard" },
  { zone: "exile", label: "Exile" },
  { zone: "library", label: "To library" },
  { zone: "command", label: "To command zone" },
];

const itemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "0.25rem 0.5rem",
  background: "transparent",
  border: "none",
  color: "#e8e8ec",
  fontSize: "0.75rem",
  cursor: "pointer",
};

/**
 * The hover menu for a card. Cards you don't control offer only ways to point
 * at them, since resolving what happens to a card is always its controller's
 * job.
 */
export default function CardMenu({
  obj,
  canManipulate,
  players,
  mySeat,
  onMove,
  onToggleTap,
  onFlip,
  onTarget,
  onGiveControl,
}: Props) {
  // Spectators have no seat, and pointing at cards is a player's action.
  if (mySeat === null) return null;

  const otherPlayers = players.filter((p) => p.seat !== mySeat);

  return (
    <div
      style={{
        position: "absolute",
        left: "100%",
        top: 0,
        marginLeft: "4px",
        minWidth: "150px",
        background: "#1d2029",
        border: "1px solid #3a3d4a",
        borderRadius: "6px",
        padding: "0.25rem 0",
        zIndex: 60,
        boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
      }}
    >
      {canManipulate && (
        <button style={itemStyle} onClick={() => onTarget("declare")}>
          Declare
        </button>
      )}
      <button style={itemStyle} onClick={() => onTarget("target")}>
        Target
      </button>

      {canManipulate && (
        <>
          <div style={{ borderTop: "1px solid #2a2d36", margin: "0.25rem 0" }} />
          {obj.zone === "battlefield" && (
            <>
              <button style={itemStyle} onClick={onToggleTap}>
                {obj.tapped ? "Untap" : "Tap"}
              </button>
              <button style={itemStyle} onClick={() => onFlip(!obj.faceDown)}>
                {obj.faceDown ? "Turn face up" : "Turn face down"}
              </button>
            </>
          )}
          {MOVE_TARGETS.filter((t) => t.zone !== obj.zone).map(({ zone, label }) => (
            <button key={zone} style={itemStyle} onClick={() => onMove(zone)}>
              {label}
            </button>
          ))}
          {obj.zone === "battlefield" && otherPlayers.length > 0 && (
            <>
              <div style={{ borderTop: "1px solid #2a2d36", margin: "0.25rem 0" }} />
              <div style={{ ...itemStyle, opacity: 0.6, cursor: "default" }}>Give control to</div>
              {otherPlayers.map((p) => (
                <button key={p.seat} style={{ ...itemStyle, paddingLeft: "1rem" }} onClick={() => onGiveControl(p.seat)}>
                  {p.displayName}
                </button>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
