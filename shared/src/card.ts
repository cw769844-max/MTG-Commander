/** Subset of a Scryfall card object that we persist locally after bulk sync. */
export interface Card {
  oracleId: string;
  name: string;
  manaCost: string | null;
  cmc: number;
  typeLine: string;
  oracleText: string | null;
  colors: string[];
  colorIdentity: string[];
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  imageNormal: string | null;
  imageArtCrop: string | null;
  scryfallUri: string;
  /** legalities.commander from Scryfall: "legal" | "banned" | "restricted" | "not_legal" */
  commanderLegality: CommanderLegality;
  /** Scryfall's own flag for the Commander "Game Changers" list (bracket 3+ signal). */
  isGameChanger: boolean;
  /** True for legendary creatures/planeswalkers that read "can be your commander", etc. */
  canBeCommander: boolean;
}

export type CommanderLegality = "legal" | "banned" | "restricted" | "not_legal";

export interface CardSearchResult {
  cards: Card[];
  total: number;
}
