import type { GameLogEntry, GameState, TurnPhase, ZoneId } from "./game";
import type { MatchFound, PodSize, QueueStatus } from "./matchmaking";

/** Client -> server events. */
export interface ClientToServerEvents {
  "room:join": (
    payload: { roomCode: string; displayName: string; deckId: string | null },
    ack: (result: { ok: true; state: GameState; seat: number } | { ok: false; error: string }) => void
  ) => void;
  "room:leave": () => void;

  "game:moveObject": (payload: { instanceId: string; toZone: ZoneId; x?: number; y?: number }) => void;
  "game:tapObject": (payload: { instanceId: string; tapped: boolean }) => void;
  "game:drawCard": (payload: { count: number }) => void;
  "game:shuffleLibrary": () => void;
  "game:setLife": (payload: { seat: number; life: number }) => void;
  "game:setCommanderDamage": (payload: { fromSeat: number; toSeat: number; amount: number }) => void;
  "game:setPhase": (payload: { phase: TurnPhase }) => void;
  "game:passTurn": () => void;
  "game:log": (payload: { message: string }) => void;

  "chat:message": (payload: { message: string }) => void;

  /** WebRTC signaling relay; server just forwards to the target seat. */
  "rtc:signal": (payload: { toSeat: number; data: unknown }) => void;

  /**
   * The bracket is read from the deck rather than taken from the client, so a
   * player can't queue into a bracket their deck doesn't claim.
   */
  "matchmaking:join": (
    payload: { deckId: string; podSize: PodSize },
    ack: (result: { ok: true; status: QueueStatus } | { ok: false; error: string }) => void
  ) => void;
  "matchmaking:leave": () => void;
}

/** Server -> client events. */
export interface ServerToClientEvents {
  "room:state": (state: GameState) => void;
  "room:playerJoined": (payload: { seat: number; displayName: string }) => void;
  "room:playerLeft": (payload: { seat: number }) => void;
  "game:log": (entry: GameLogEntry) => void;
  "chat:message": (payload: { seat: number; message: string; timestamp: string }) => void;
  "rtc:signal": (payload: { fromSeat: number; data: unknown }) => void;
  "error": (payload: { message: string }) => void;

  "matchmaking:status": (status: QueueStatus) => void;
  "matchmaking:matched": (match: MatchFound) => void;
}
