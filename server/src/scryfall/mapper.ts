import type { Card as PrismaCard } from "@prisma/client";
import type { Card } from "@mtg-commander/shared";

/** Fields we read off a raw Scryfall card JSON object from the bulk data dump. */
export interface ScryfallCardJson {
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  image_uris?: { normal?: string; art_crop?: string };
  card_faces?: Array<{ image_uris?: { normal?: string; art_crop?: string }; oracle_text?: string }>;
  scryfall_uri: string;
  legalities: Record<string, string>;
  game_changer?: boolean;
  layout?: string;
}

/**
 * Layouts that aren't real playable cards (art cards, tokens, emblems, and the
 * double-sided Secret Lair reprints), all of which land in the oracle_cards
 * dump with empty rules text and a "Card // Card" type line.
 */
const NON_CARD_LAYOUTS = new Set(["art_series", "token", "double_faced_token", "emblem", "reversible_card"]);

export function isNonPlayableEntry(card: ScryfallCardJson): boolean {
  if (card.layout && NON_CARD_LAYOUTS.has(card.layout)) return true;
  return card.type_line === "Card // Card";
}

/**
 * Converts a raw Scryfall bulk-data entry into the row shape we store in SQLite.
 *
 * Commander eligibility comes from Scryfall's own `is:commander` set rather
 * than from the card's rules text: cards like Shorikai, Genesis Engine are
 * legal commanders without ever saying "can be your commander".
 */
export function toPrismaCardData(
  card: ScryfallCardJson,
  commanderOracleIds: ReadonlySet<string>
): Omit<PrismaCard, "updatedAt"> | null {
  if (!card.oracle_id) return null; // skip oddities without a stable oracle id
  if (isNonPlayableEntry(card)) return null;

  const image = card.image_uris ?? card.card_faces?.[0]?.image_uris;

  return {
    oracleId: card.oracle_id,
    name: card.name,
    manaCost: card.mana_cost ?? null,
    cmc: card.cmc,
    typeLine: card.type_line,
    oracleText: card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? null,
    colors: JSON.stringify(card.colors ?? []),
    colorIdentity: JSON.stringify(card.color_identity),
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    loyalty: card.loyalty ?? null,
    imageNormal: image?.normal ?? null,
    imageArtCrop: image?.art_crop ?? null,
    scryfallUri: card.scryfall_uri,
    commanderLegality: (card.legalities.commander as Card["commanderLegality"]) ?? "not_legal",
    isGameChanger: card.game_changer ?? false,
    canBeCommander: commanderOracleIds.has(card.oracle_id),
  };
}

export function fromPrismaCard(row: PrismaCard): Card {
  return {
    oracleId: row.oracleId,
    name: row.name,
    manaCost: row.manaCost,
    cmc: row.cmc,
    typeLine: row.typeLine,
    oracleText: row.oracleText,
    colors: JSON.parse(row.colors),
    colorIdentity: JSON.parse(row.colorIdentity),
    power: row.power,
    toughness: row.toughness,
    loyalty: row.loyalty,
    imageNormal: row.imageNormal,
    imageArtCrop: row.imageArtCrop,
    scryfallUri: row.scryfallUri,
    commanderLegality: row.commanderLegality as Card["commanderLegality"],
    isGameChanger: row.isGameChanger,
    canBeCommander: row.canBeCommander,
  };
}
