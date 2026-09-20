import type { ClientGameState, GameObject, GameState } from "@mtg-commander/shared";

/**
 * Builds the view of a game that one seat is allowed to see.
 *
 * Every state update leaves the server through here. The server keeps the
 * full truth; clients only ever receive what that player could see at a
 * physical table.
 *
 * A null seat is a spectator: they get the view of someone standing behind
 * the table, so every hand and every face-down card stays hidden from them.
 */
export function redactStateFor(state: GameState, viewerSeat: number | null): ClientGameState {
  const librarySizes: Record<number, number> = {};
  for (const player of state.players) librarySizes[player.seat] = 0;

  const objects: GameObject[] = [];
  for (const obj of state.objects) {
    if (obj.zone === "library") {
      // Dropped entirely, not blanked: a stable instanceId per library card
      // would let a client track the shuffled order and predict draws.
      librarySizes[obj.ownerSeat] = (librarySizes[obj.ownerSeat] ?? 0) + 1;
      continue;
    }

    const hiddenHand = obj.zone === "hand" && obj.ownerSeat !== viewerSeat;
    const hiddenFaceDown = obj.faceDown && obj.controllerSeat !== viewerSeat;

    objects.push(hiddenHand || hiddenFaceDown ? { ...obj, cardOracleId: null } : obj);
  }

  return { ...state, objects, librarySizes };
}
