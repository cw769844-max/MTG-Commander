import { describe, expect, it } from "vitest";
import type { Card } from "@mtg-commander/shared";
import { validateDeckLegality, type ResolvedDeckEntry } from "./deck-legality";

/**
 * Card fixtures are hand-built rather than read from the synced database so
 * these tests describe the rules themselves and don't break when Scryfall
 * reprints something.
 */
function card(overrides: Partial<Card> & Pick<Card, "name">): Card {
  return {
    oracleId: overrides.oracleId ?? `oracle-${overrides.name.toLowerCase().replace(/\W+/g, "-")}`,
    manaCost: "{1}",
    cmc: 1,
    typeLine: "Creature — Human",
    oracleText: "",
    colors: [],
    colorIdentity: [],
    power: null,
    toughness: null,
    loyalty: null,
    imageNormal: null,
    imageArtCrop: null,
    scryfallUri: "https://scryfall.test",
    commanderLegality: "legal",
    isGameChanger: false,
    canBeCommander: false,
    ...overrides,
  };
}

const legendaryCreature = (name: string, extra: Partial<Card> = {}) =>
  card({ name, typeLine: "Legendary Creature — Human", canBeCommander: true, ...extra });

const plains = card({ name: "Plains", typeLine: "Basic Land — Plains", colorIdentity: ["W"], manaCost: null, cmc: 0 });

/** Colourless padding, so filling a deck to 100 never affects colour identity. */
const wastes = card({ name: "Wastes", typeLine: "Basic Land", colorIdentity: [], manaCost: null, cmc: 0 });

/** Builds a deck of exactly 100 cards: the commanders plus padding. */
function deck(commanders: Card[], rest: Array<{ card: Card; quantity: number }> = []): ResolvedDeckEntry[] {
  const used = commanders.length + rest.reduce((n, r) => n + r.quantity, 0);
  const entries: ResolvedDeckEntry[] = [
    ...commanders.map((c) => ({ deckCard: { cardOracleId: c.oracleId, quantity: 1, isCommander: true }, card: c })),
    ...rest.map((r) => ({
      deckCard: { cardOracleId: r.card.oracleId, quantity: r.quantity, isCommander: false },
      card: r.card,
    })),
  ];
  const padding = 100 - used;
  if (padding > 0) {
    entries.push({ deckCard: { cardOracleId: wastes.oracleId, quantity: padding, isCommander: false }, card: wastes });
  }
  return entries;
}

const errorsOf = (entries: ResolvedDeckEntry[]) =>
  validateDeckLegality(entries)
    .issues.filter((i) => i.severity === "error")
    .map((i) => i.code);

describe("deck size and singleton", () => {
  it("accepts a legal 100-card deck", () => {
    const report = validateDeckLegality(deck([legendaryCreature("Commander", { colorIdentity: ["W"] })]));
    expect(report.legal).toBe(true);
    expect(report.deckSize).toBe(100);
  });

  it("rejects a deck that isn't exactly 100 cards", () => {
    const commander = legendaryCreature("Commander", { colorIdentity: ["W"] });
    const short: ResolvedDeckEntry[] = [
      { deckCard: { cardOracleId: commander.oracleId, quantity: 1, isCommander: true }, card: commander },
      { deckCard: { cardOracleId: plains.oracleId, quantity: 98, isCommander: false }, card: plains },
    ];
    expect(errorsOf(short)).toContain("WRONG_DECK_SIZE");
  });

  it("rejects duplicate non-basic cards", () => {
    const commander = legendaryCreature("Commander", { colorIdentity: ["W"] });
    const spell = card({ name: "Some Spell", typeLine: "Instant" });
    expect(errorsOf(deck([commander], [{ card: spell, quantity: 2 }]))).toContain("DUPLICATE_NONBASIC");
  });

  it("allows any number of basic lands", () => {
    const commander = legendaryCreature("Commander", { colorIdentity: ["W"] });
    expect(errorsOf(deck([commander], [{ card: plains, quantity: 50 }]))).not.toContain("DUPLICATE_NONBASIC");
  });
});

describe("colour identity", () => {
  it("rejects cards outside the commander's identity", () => {
    const commander = legendaryCreature("Mono White", { colorIdentity: ["W"] });
    const green = card({ name: "Green Thing", colorIdentity: ["G"] });
    expect(errorsOf(deck([commander], [{ card: green, quantity: 1 }]))).toContain("COLOR_IDENTITY_VIOLATION");
  });

  it("accepts cards inside the commander's identity", () => {
    const commander = legendaryCreature("Azorius", { colorIdentity: ["W", "U"] });
    const blue = card({ name: "Blue Thing", colorIdentity: ["U"] });
    expect(errorsOf(deck([commander], [{ card: blue, quantity: 1 }]))).not.toContain("COLOR_IDENTITY_VIOLATION");
  });

  it("uses the union of both commanders' identities", () => {
    const a = legendaryCreature("Partner A", { colorIdentity: ["W"], oracleText: "Partner" });
    const b = legendaryCreature("Partner B", { colorIdentity: ["U"], oracleText: "Partner" });
    const blue = card({ name: "Blue Thing", colorIdentity: ["U"] });
    const report = validateDeckLegality(deck([a, b], [{ card: blue, quantity: 1 }]));
    expect(report.colorIdentity.sort()).toEqual(["U", "W"]);
    expect(report.legal).toBe(true);
  });

  it("treats colourless cards as always in identity", () => {
    const commander = legendaryCreature("Mono White", { colorIdentity: ["W"] });
    const artifact = card({ name: "Colourless Thing", typeLine: "Artifact", colorIdentity: [] });
    expect(errorsOf(deck([commander], [{ card: artifact, quantity: 1 }]))).not.toContain("COLOR_IDENTITY_VIOLATION");
  });
});

describe("banlist", () => {
  it("rejects banned cards", () => {
    const commander = legendaryCreature("Commander", { colorIdentity: ["W"] });
    const banned = card({ name: "Banned Thing", commanderLegality: "banned" });
    expect(errorsOf(deck([commander], [{ card: banned, quantity: 1 }]))).toContain("BANNED_CARD");
  });

  it("rejects cards that were never Commander-legal", () => {
    const commander = legendaryCreature("Commander", { colorIdentity: ["W"] });
    const notLegal = card({ name: "Acorn Thing", commanderLegality: "not_legal" });
    expect(errorsOf(deck([commander], [{ card: notLegal, quantity: 1 }]))).toContain("NOT_LEGAL_CARD");
  });

  it("flags Game Changers as a warning, not an error", () => {
    const commander = legendaryCreature("Commander", { colorIdentity: ["W"] });
    const gc = card({ name: "Game Changer Thing", isGameChanger: true });
    const report = validateDeckLegality(deck([commander], [{ card: gc, quantity: 1 }]));
    expect(report.legal).toBe(true);
    expect(report.gameChangerCount).toBe(1);
    expect(report.issues.some((i) => i.code === "GAME_CHANGER_PRESENT" && i.severity === "warning")).toBe(true);
  });
});

describe("commander eligibility", () => {
  it("requires a commander", () => {
    const entries: ResolvedDeckEntry[] = [
      { deckCard: { cardOracleId: plains.oracleId, quantity: 100, isCommander: false }, card: plains },
    ];
    expect(errorsOf(entries)).toContain("MISSING_COMMANDER");
  });

  it("rejects a card that isn't commander-eligible", () => {
    const notACommander = card({ name: "The Great Henge", typeLine: "Legendary Artifact", canBeCommander: false });
    expect(errorsOf(deck([notACommander]))).toContain("COMMANDER_CANNOT_COMMAND");
  });

  it("accepts a non-creature commander that Scryfall marks eligible", () => {
    // Shorikai is a legal commander despite never saying so in its rules text.
    const vehicle = card({ name: "Shorikai", typeLine: "Legendary Artifact — Vehicle", canBeCommander: true });
    expect(validateDeckLegality(deck([vehicle])).legal).toBe(true);
  });

  it("rejects more than two commanders", () => {
    const a = legendaryCreature("A", { oracleText: "Partner" });
    const b = legendaryCreature("B", { oracleText: "Partner" });
    const c = legendaryCreature("C", { oracleText: "Partner" });
    expect(errorsOf(deck([a, b, c]))).toContain("TOO_MANY_COMMANDERS");
  });
});

describe("commander pairing", () => {
  it("allows two plain Partner commanders", () => {
    const a = legendaryCreature("Thrasios", { oracleText: "Partner (You can have two commanders if both have partner.)" });
    const b = legendaryCreature("Tymna", { oracleText: "Partner (You can have two commanders if both have partner.)" });
    expect(validateDeckLegality(deck([a, b])).legal).toBe(true);
  });

  it("allows a matched 'Partner with' pair", () => {
    const a = legendaryCreature("Regna, the Redeemer", { oracleText: "Partner with Krav, the Unredeemed" });
    const b = legendaryCreature("Krav, the Unredeemed", { oracleText: "Partner with Regna, the Redeemer" });
    expect(validateDeckLegality(deck([a, b])).legal).toBe(true);
  });

  it("rejects a mismatched 'Partner with' pair", () => {
    const a = legendaryCreature("Regna, the Redeemer", { oracleText: "Partner with Krav, the Unredeemed" });
    const other = legendaryCreature("Trynn", { oracleText: "Partner with Silvar, Devourer of the Free" });
    expect(errorsOf(deck([a, other]))).toContain("COMMANDER_CANNOT_COMMAND");
  });

  it("rejects pairing plain Partner with a 'Partner with' card", () => {
    const plain = legendaryCreature("Tana", { oracleText: "Partner (You can have two commanders if both have partner.)" });
    const restricted = legendaryCreature("Regna", { oracleText: "Partner with Krav, the Unredeemed" });
    expect(errorsOf(deck([plain, restricted]))).toContain("COMMANDER_CANNOT_COMMAND");
  });

  it("allows two Friends forever commanders", () => {
    const a = legendaryCreature("Sophina", { oracleText: "Friends forever" });
    const b = legendaryCreature("Othelm", { oracleText: "Friends forever" });
    expect(validateDeckLegality(deck([a, b])).legal).toBe(true);
  });

  it("allows Doctor's companion with a Time Lord Doctor", () => {
    const companion = legendaryCreature("Donna Noble", { oracleText: "Doctor's companion" });
    const doctor = card({
      name: "The Tenth Doctor",
      typeLine: "Legendary Creature — Time Lord Doctor",
      canBeCommander: true,
    });
    expect(validateDeckLegality(deck([companion, doctor])).legal).toBe(true);
  });

  it("rejects Doctor's companion without a Doctor", () => {
    const companion = legendaryCreature("Donna Noble", { oracleText: "Doctor's companion" });
    const notADoctor = legendaryCreature("Atraxa");
    expect(errorsOf(deck([companion, notADoctor]))).toContain("COMMANDER_CANNOT_COMMAND");
  });

  it("allows a commander that chooses a Background plus a Background", () => {
    const commander = legendaryCreature("Halsin", { oracleText: "Choose a Background" });
    const background = card({
      name: "Dungeon Delver",
      typeLine: "Legendary Enchantment — Background",
      canBeCommander: true,
    });
    expect(validateDeckLegality(deck([commander, background])).legal).toBe(true);
  });

  it("rejects a Background paired with a commander that can't choose one", () => {
    const commander = legendaryCreature("Atraxa");
    const background = card({
      name: "Dungeon Delver",
      typeLine: "Legendary Enchantment — Background",
      canBeCommander: true,
    });
    expect(errorsOf(deck([commander, background]))).toContain("COMMANDER_CANNOT_COMMAND");
  });

  it("rejects a Background as the only commander", () => {
    const background = card({
      name: "Dungeon Delver",
      typeLine: "Legendary Enchantment — Background",
      canBeCommander: true,
    });
    expect(errorsOf(deck([background]))).toContain("COMMANDER_CANNOT_COMMAND");
  });

  it("rejects two unrelated legends", () => {
    expect(errorsOf(deck([legendaryCreature("Atraxa"), legendaryCreature("Kenrith")]))).toContain(
      "COMMANDER_CANNOT_COMMAND"
    );
  });
});

describe("unresolved cards", () => {
  it("reports cards missing from the local database", () => {
    const entries: ResolvedDeckEntry[] = [
      { deckCard: { cardOracleId: "unknown-id", quantity: 1, isCommander: false }, card: undefined },
    ];
    expect(errorsOf(entries)).toContain("UNKNOWN_CARD");
  });
});
