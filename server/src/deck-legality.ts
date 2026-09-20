import {
  COMMANDER_DECK_SIZE,
  isCommanderLegal,
  type Card,
  type DeckCard,
  type DeckLegalityReport,
  type LegalityIssue,
} from "@mtg-commander/shared";

export interface ResolvedDeckEntry {
  deckCard: DeckCard;
  card: Card | undefined;
}

function isBasicLand(card: Card): boolean {
  return card.typeLine.includes("Basic Land");
}

function isBackground(card: Card): boolean {
  return card.typeLine.includes("Background");
}

function hasPartner(card: Card): boolean {
  return /\bPartner\b/.test(card.oracleText ?? "");
}

function unionColorIdentity(cards: Card[]): string[] {
  const set = new Set<string>();
  for (const card of cards) for (const color of card.colorIdentity) set.add(color);
  return [...set];
}

export function validateDeckLegality(entries: ResolvedDeckEntry[]): DeckLegalityReport {
  const issues: LegalityIssue[] = [];

  const unknown = entries.filter((e) => !e.card);
  for (const e of unknown) {
    issues.push({
      severity: "error",
      code: "UNKNOWN_CARD",
      message: `Card ${e.deckCard.cardOracleId} could not be resolved against the local card database.`,
      cardOracleId: e.deckCard.cardOracleId,
    });
  }

  const resolved = entries.filter((e): e is { deckCard: DeckCard; card: Card } => !!e.card);
  const commanders = resolved.filter((e) => e.deckCard.isCommander).map((e) => e.card);
  const nonCommanders = resolved.filter((e) => !e.deckCard.isCommander);

  // Commander count and eligibility.
  if (commanders.length === 0) {
    issues.push({ severity: "error", code: "MISSING_COMMANDER", message: "Deck has no commander assigned." });
  } else if (commanders.length > 2) {
    issues.push({
      severity: "error",
      code: "TOO_MANY_COMMANDERS",
      message: "A deck can have at most two commanders (Partner pair, or a commander plus its Background).",
    });
  } else if (commanders.length === 2) {
    const [a, b] = commanders;
    const validPair =
      (hasPartner(a) && hasPartner(b)) || (isBackground(a) && !isBackground(b)) || (isBackground(b) && !isBackground(a));
    if (!validPair) {
      issues.push({
        severity: "error",
        code: "COMMANDER_CANNOT_COMMAND",
        message: `${a.name} and ${b.name} cannot both be commanders (need Partner, or a commander + Background).`,
      });
    }
  }

  for (const commander of commanders) {
    if (!commander.canBeCommander && !isBackground(commander)) {
      issues.push({
        severity: "error",
        code: "COMMANDER_CANNOT_COMMAND",
        message: `${commander.name} is not a legal commander.`,
        cardOracleId: commander.oracleId,
      });
    }
  }

  // Deck size: exactly 100 including commander(s).
  const deckSize = resolved.reduce((sum, e) => sum + e.deckCard.quantity, 0);
  if (deckSize !== COMMANDER_DECK_SIZE) {
    issues.push({
      severity: "error",
      code: "WRONG_DECK_SIZE",
      message: `Deck has ${deckSize} cards; Commander decks must have exactly ${COMMANDER_DECK_SIZE}.`,
    });
  }

  // Singleton, outside of basic lands.
  for (const { deckCard, card } of nonCommanders) {
    if (deckCard.quantity > 1 && !isBasicLand(card)) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_NONBASIC",
        message: `${card.name} appears ${deckCard.quantity} times; only basic lands may exceed 1 copy.`,
        cardOracleId: card.oracleId,
      });
    }
  }

  // Color identity.
  const identity = unionColorIdentity(commanders);
  for (const { card } of resolved) {
    const outOfIdentity = card.colorIdentity.some((c) => !identity.includes(c));
    if (outOfIdentity) {
      issues.push({
        severity: "error",
        code: "COLOR_IDENTITY_VIOLATION",
        message: `${card.name} (${card.colorIdentity.join("") || "C"}) is outside the commander's color identity (${identity.join("") || "C"}).`,
        cardOracleId: card.oracleId,
      });
    }
  }

  // Banlist, straight from Scryfall's own legalities.commander field.
  let gameChangerCount = 0;
  for (const { card } of resolved) {
    if (card.commanderLegality === "banned") {
      issues.push({
        severity: "error",
        code: "BANNED_CARD",
        message: `${card.name} is banned in Commander.`,
        cardOracleId: card.oracleId,
      });
    } else if (!isCommanderLegal(card.commanderLegality)) {
      issues.push({
        severity: "error",
        code: "NOT_LEGAL_CARD",
        message: `${card.name} is not legal in Commander.`,
        cardOracleId: card.oracleId,
      });
    }
    if (card.isGameChanger) {
      gameChangerCount += 1;
      issues.push({
        severity: "warning",
        code: "GAME_CHANGER_PRESENT",
        message: `${card.name} is on the Commander "Game Changers" list — factor it into your bracket/power-level rating.`,
        cardOracleId: card.oracleId,
      });
    }
  }

  const legal = issues.every((i) => i.severity !== "error");

  return { legal, deckSize, colorIdentity: identity, gameChangerCount, issues };
}
