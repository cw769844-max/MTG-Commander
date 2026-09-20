export type ZoneId =
  | "library"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "command";

export interface GameObject {
  /** Unique per game instance (not the same as oracleId, since a card can move/transform). */
  instanceId: string;
  cardOracleId: string;
  zone: ZoneId;
  /** Owner never changes; controller can via effects, but that's manual for now. */
  ownerSeat: number;
  controllerSeat: number;
  tapped: boolean;
  faceDown: boolean;
  counters: Record<string, number>;
  /** Free-form position for battlefield layout, set by drag interactions. */
  x: number;
  y: number;
}

export interface PlayerState {
  seat: number;
  userId: string;
  displayName: string;
  life: number;
  /** Damage taken from each other seat's commander(s), keyed by opposing seat. */
  commanderDamageTaken: Record<number, number>;
  poison: number;
  connected: boolean;
  deckId: string | null;
}

export interface GameLogEntry {
  id: string;
  timestamp: string;
  seat: number | null;
  message: string;
}

export interface GameState {
  roomCode: string;
  players: PlayerState[];
  objects: GameObject[];
  log: GameLogEntry[];
  turnSeat: number;
  /** Manual phase tracker; advanced explicitly by whoever has priority, not enforced. */
  phase: TurnPhase;
}

export type TurnPhase =
  | "untap"
  | "upkeep"
  | "draw"
  | "main1"
  | "combat_begin"
  | "combat_attackers"
  | "combat_blockers"
  | "combat_damage"
  | "combat_end"
  | "main2"
  | "end"
  | "cleanup";

export const MAX_PLAYERS_PER_ROOM = 4;
