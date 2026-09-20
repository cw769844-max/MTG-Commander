import type { Card, GameObject, PlayerState, TargetKind, ZoneId } from "@mtg-commander/shared";
import BattlefieldZone from "./BattlefieldZone";
import GameObjectCard from "./GameObjectCard";
import ZoneDropArea from "./ZoneDropArea";

interface Props {
  player: PlayerState;
  objects: GameObject[];
  mySeat: number | null;
  getCard: (oracleId: string | null) => Card | undefined;
  ensureCard: (oracleId: string | null) => void;
  players: PlayerState[];
  onMove: (instanceId: string, zone: ZoneId, x?: number, y?: number) => void;
  onToggleTap: (instanceId: string, tapped: boolean) => void;
  onFlip: (instanceId: string, faceDown: boolean) => void;
  onTarget: (instanceId: string, kind: TargetKind) => void;
  onGiveControl: (instanceId: string, seat: number) => void;
  highlightOf: (instanceId: string) => TargetKind | null;
  librarySize: number;
  onSetLife: (life: number) => void;
  onSetCommanderDamageFromMe: (amount: number) => void;
}

const STACK_ZONES: ZoneId[] = ["graveyard", "exile", "command"];

export default function PlayerBoard({
  player,
  objects,
  mySeat,
  getCard,
  ensureCard,
  librarySize,
  players,
  onMove,
  onToggleTap,
  onFlip,
  onTarget,
  onGiveControl,
  highlightOf,
  onSetLife,
  onSetCommanderDamageFromMe,
}: Props) {
  const isMine = player.seat === mySeat;
  for (const obj of objects) ensureCard(obj.cardOracleId);

  const hand = objects.filter((o) => o.zone === "hand");
  const battlefield = objects.filter((o) => o.zone === "battlefield");
  const damageFromMe = mySeat !== null ? player.commanderDamageTaken[mySeat] ?? 0 : 0;

  return (
    <div style={{ border: "1px solid #2a2d36", borderRadius: "8px", padding: "0.75rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <strong>
          {player.displayName} (seat {player.seat}) {!player.connected && "— disconnected"}
        </strong>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <span>
            Life:{" "}
            {isMine ? (
              <>
                <button onClick={() => onSetLife(player.life - 1)}>-</button> {player.life}{" "}
                <button onClick={() => onSetLife(player.life + 1)}>+</button>
              </>
            ) : (
              player.life
            )}
          </span>
          {mySeat !== null && !isMine && (
            <span>
              Commander dmg from you: <button onClick={() => onSetCommanderDamageFromMe(Math.max(0, damageFromMe - 1))}>-</button>{" "}
              {damageFromMe} <button onClick={() => onSetCommanderDamageFromMe(damageFromMe + 1)}>+</button>
            </span>
          )}
        </div>
      </div>

      {/* Hand size is public information even though the cards themselves aren't. */}
      <div style={{ fontSize: "0.8rem", opacity: 0.8, marginBottom: "0.5rem" }}>
        Library: {librarySize} · Hand: {hand.length}
      </div>

      {isMine && (
        <>
          <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Your hand</div>
          <ZoneDropArea onDropInstance={(instanceId) => onMove(instanceId, "hand")}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem", minHeight: "1.5rem" }}>
              {hand.map((obj) => (
                <GameObjectCard
                  key={obj.instanceId}
                  obj={obj}
                  card={getCard(obj.cardOracleId)}
                  onMove={(zone) => onMove(obj.instanceId, zone)}
                  onToggleTap={() => onToggleTap(obj.instanceId, !obj.tapped)}
                  canManipulate={obj.controllerSeat === mySeat}
                  players={players}
                  mySeat={mySeat}
                  highlight={highlightOf(obj.instanceId)}
                  onFlip={(faceDown) => onFlip(obj.instanceId, faceDown)}
                  onTarget={(kind) => onTarget(obj.instanceId, kind)}
                  onGiveControl={(seat) => onGiveControl(obj.instanceId, seat)}
                />
              ))}
            </div>
          </ZoneDropArea>
        </>
      )}

      <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Battlefield</div>
      <BattlefieldZone
        objects={battlefield}
        getCard={getCard}
        onDropAt={(instanceId, x, y) => onMove(instanceId, "battlefield", x, y)}
        onMoveZone={(instanceId, zone) => onMove(instanceId, zone)}
        onToggleTap={onToggleTap}
        onFlip={onFlip}
        onTarget={onTarget}
        onGiveControl={onGiveControl}
        highlightOf={highlightOf}
        players={players}
        mySeat={mySeat}
      />

      {STACK_ZONES.map((zone) => {
        const zoneObjects = objects.filter((o) => o.zone === zone);
        if (zoneObjects.length === 0) return null;
        return (
          <div key={zone} style={{ marginBottom: "0.5rem" }}>
            <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem", textTransform: "capitalize" }}>{zone}</div>
            <ZoneDropArea onDropInstance={(instanceId) => onMove(instanceId, zone)}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {zoneObjects.map((obj) => (
                  <GameObjectCard
                    key={obj.instanceId}
                    obj={obj}
                    card={getCard(obj.cardOracleId)}
                    onMove={(z) => onMove(obj.instanceId, z)}
                    onToggleTap={() => onToggleTap(obj.instanceId, !obj.tapped)}
                    canManipulate={obj.controllerSeat === mySeat}
                    players={players}
                    mySeat={mySeat}
                    highlight={highlightOf(obj.instanceId)}
                    onFlip={(faceDown) => onFlip(obj.instanceId, faceDown)}
                    onTarget={(kind) => onTarget(obj.instanceId, kind)}
                    onGiveControl={(seat) => onGiveControl(obj.instanceId, seat)}
                  />
                ))}
              </div>
            </ZoneDropArea>
          </div>
        );
      })}
    </div>
  );
}
