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

export function canBeCommander(card: ScryfallCardJson): boolean {
  const text = card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? "";
  const isLegendaryCreature = /Legendary/.test(card.type_line) && /Creature/.test(card.type_line);
  const explicitlyAllowed = /can be your commander/i.test(text);
  return isLegendaryCreature || explicitlyAllowed;
}

/** Converts a raw Scryfall bulk-data entry into the row shape we store in SQLite. */
export function toPrismaCardData(card: ScryfallCardJson): Omit<PrismaCard, "updatedAt"> | null {
  if (!card.oracle_id) return null; // skip reversible/token oddities without a stable oracle id

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
    canBeCommander: canBeCommander(card),
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
