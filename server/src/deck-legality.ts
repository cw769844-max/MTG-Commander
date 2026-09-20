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

/** Plain "Partner", which pairs with any other plain-Partner card. */
function hasPlainPartner(card: Card): boolean {
  const text = card.oracleText ?? "";
  return /(^|\n)Partner(?! with)\b/.test(text);
}

/** "Partner with <name>" only pairs with the one card it names. */
function partnerWithName(card: Card): string | null {
  const match = /(^|\n)Partner with ([^(\n]+)/.exec(card.oracleText ?? "");
  return match ? match[2].trim() : null;
}

function hasFriendsForever(card: Card): boolean {
  return /Friends forever/i.test(card.oracleText ?? "");
}

function hasDoctorsCompanion(card: Card): boolean {
  return /Doctor's companion/i.test(card.oracleText ?? "");
}

function isTimeLordDoctor(card: Card): boolean {
  return card.typeLine.includes("Time Lord Doctor");
}

function choosesABackground(card: Card): boolean {
  return /Choose a Background/i.test(card.oracleText ?? "");
}

/** Returns null when the pair is legal, or an explanation of why it isn't. */
function invalidPairReason(a: Card, b: Card): string | null {
  if (hasPlainPartner(a) && hasPlainPartner(b)) return null;
  if (hasFriendsForever(a) && hasFriendsForever(b)) return null;

  const aPartnerWith = partnerWithName(a);
  const bPartnerWith = partnerWithName(b);
  if (aPartnerWith || bPartnerWith) {
    if (aPartnerWith === b.name && bPartnerWith === a.name) return null;
    const named = aPartnerWith ?? bPartnerWith;
    return `${a.name} and ${b.name} can't partner together — "Partner with" only pairs with ${named}.`;
  }

  if ((choosesABackground(a) && isBackground(b)) || (choosesABackground(b) && isBackground(a))) return null;
  if (isBackground(a) || isBackground(b)) {
    return `A Background can only be paired with a commander that says "Choose a Background".`;
  }

  if ((hasDoctorsCompanion(a) && isTimeLordDoctor(b)) || (hasDoctorsCompanion(b) && isTimeLordDoctor(a))) return null;
  if (hasDoctorsCompanion(a) || hasDoctorsCompanion(b)) {
    return `"Doctor's companion" can only be paired with a Time Lord Doctor.`;
  }

  return `${a.name} and ${b.name} can't be commanders together — they need Partner, Friends forever, "Doctor's companion" with a Doctor, or a commander plus a Background.`;
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
    const reason = invalidPairReason(a, b);
    if (reason) {
      issues.push({ severity: "error", code: "COMMANDER_CANNOT_COMMAND", message: reason });
    }
  } else if (commanders.length === 1 && isBackground(commanders[0])) {
    issues.push({
      severity: "error",
      code: "COMMANDER_CANNOT_COMMAND",
      message: `${commanders[0].name} is a Background; it can only be a second commander alongside one that says "Choose a Background".`,
      cardOracleId: commanders[0].oracleId,
    });
  }

  for (const commander of commanders) {
    if (!commander.canBeCommander) {
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
