import type { Card, CommanderLegality } from "./card";

export interface DeckCard {
  cardOracleId: string;
  /** Always 1 in Commander outside basic lands, but we keep a count for basics. */
  quantity: number;
  /** True for cards in the command zone (commander/partners/background/signature spell). */
  isCommander: boolean;
}

export interface Deck {
  id: string;
  ownerId: string;
  name: string;
  cards: DeckCard[];
  createdAt: string;
  updatedAt: string;
}

/** A deck plus the resolved Card data for every entry, used for validation and display. */
export interface HydratedDeck extends Deck {
  resolvedCards: Array<{ deckCard: DeckCard; card: Card | undefined }>;
}

export type LegalityIssueSeverity = "error" | "warning";

export interface LegalityIssue {
  severity: LegalityIssueSeverity;
  code:
    | "MISSING_COMMANDER"
    | "TOO_MANY_COMMANDERS"
    | "COMMANDER_CANNOT_COMMAND"
    | "WRONG_DECK_SIZE"
    | "DUPLICATE_NONBASIC"
    | "COLOR_IDENTITY_VIOLATION"
    | "BANNED_CARD"
    | "NOT_LEGAL_CARD"
    | "GAME_CHANGER_PRESENT"
    | "UNKNOWN_CARD";
  message: string;
  cardOracleId?: string;
}

export interface DeckLegalityReport {
  legal: boolean;
  deckSize: number;
  colorIdentity: string[];
  gameChangerCount: number;
  issues: LegalityIssue[];
}

export const COMMANDER_DECK_SIZE = 100;

export function isCommanderLegal(legality: CommanderLegality): boolean {
  return legality === "legal" || legality === "restricted";
}
