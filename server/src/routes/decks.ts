import { Router } from "express";
import {
  BRACKET_IDS,
  COMMANDER_DECK_SIZE,
  evaluateBracket,
  type BracketId,
  type BracketSelfReport,
} from "@mtg-commander/shared";
import { wrap } from "../async-handler";
import { prisma } from "../db";
import { fromPrismaCard } from "../scryfall/mapper";
import { validateDeckLegality, type ResolvedDeckEntry } from "../deck-legality";

export const decksRouter = Router();

interface DeckCardInput {
  cardOracleId: string;
  quantity: number;
  isCommander: boolean;
}

async function resolveDeckEntries(deckCards: DeckCardInput[]): Promise<ResolvedDeckEntry[]> {
  const oracleIds = deckCards.map((dc) => dc.cardOracleId);
  const rows = await prisma.card.findMany({ where: { oracleId: { in: oracleIds } } });
  const byId = new Map(rows.map((r) => [r.oracleId, fromPrismaCard(r)]));
  return deckCards.map((dc) => ({ deckCard: dc, card: byId.get(dc.cardOracleId) }));
}

/** Pulls the bracket self-report off a deck row. */
export function selfReportOf(deck: {
  bracket: number;
  hasMassLandDenial: boolean;
  hasChainedExtraTurns: boolean;
  hasTwoCardCombos: boolean;
  combosAreLateGameOnly: boolean;
  hasHeavyTutoring: boolean;
}): BracketSelfReport {
  return {
    bracket: (BRACKET_IDS.includes(deck.bracket as BracketId) ? deck.bracket : 2) as BracketId,
    hasMassLandDenial: deck.hasMassLandDenial,
    hasChainedExtraTurns: deck.hasChainedExtraTurns,
    hasTwoCardCombos: deck.hasTwoCardCombos,
    combosAreLateGameOnly: deck.combosAreLateGameOnly,
    hasHeavyTutoring: deck.hasHeavyTutoring,
  };
}

function parseDeckCards(body: unknown): DeckCardInput[] | null {
  const cards = (body as { cards?: unknown })?.cards;
  if (!Array.isArray(cards)) return null;
  if (cards.length > COMMANDER_DECK_SIZE * 2) return null;

  const parsed: DeckCardInput[] = [];
  for (const entry of cards) {
    const { cardOracleId, quantity, isCommander } = (entry ?? {}) as Partial<DeckCardInput>;
    if (typeof cardOracleId !== "string" || !cardOracleId) return null;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > COMMANDER_DECK_SIZE) {
      return null;
    }
    parsed.push({ cardOracleId, quantity, isCommander: isCommander === true });
  }
  return parsed;
}

decksRouter.get(
  "/",
  wrap(async (req, res) => {
    const decks = await prisma.deck.findMany({ where: { ownerId: req.userId }, include: { cards: true } });
    res.json(decks);
  })
);

decksRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const deck = await prisma.deck.findFirst({
      where: { id: req.params.id, ownerId: req.userId },
      include: { cards: true },
    });
    if (!deck) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }
    const legality = validateDeckLegality(await resolveDeckEntries(deck.cards));
    const bracketReport = evaluateBracket(selfReportOf(deck), legality.gameChangerCount);
    res.json({ ...deck, legality, bracketReport });
  })
);

decksRouter.post(
  "/",
  wrap(async (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const deck = await prisma.deck.create({ data: { name: name.trim(), ownerId: req.userId! } });
    res.status(201).json(deck);
  })
);

decksRouter.put(
  "/:id/cards",
  wrap(async (req, res) => {
    const cards = parseDeckCards(req.body);
    if (!cards) {
      res.status(400).json({ error: "cards must be a list of { cardOracleId, quantity, isCommander }" });
      return;
    }

    const deck = await prisma.deck.findFirst({ where: { id: req.params.id, ownerId: req.userId } });
    if (!deck) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }

    await prisma.$transaction([
      prisma.deckCard.deleteMany({ where: { deckId: deck.id } }),
      prisma.deckCard.createMany({ data: cards.map((c) => ({ ...c, deckId: deck.id })) }),
    ]);

    const legality = validateDeckLegality(await resolveDeckEntries(cards));
    const bracketReport = evaluateBracket(selfReportOf(deck), legality.gameChangerCount);
    res.json({ ok: true, legality, bracketReport });
  })
);

decksRouter.put(
  "/:id/bracket",
  wrap(async (req, res) => {
    const body = req.body as Partial<BracketSelfReport>;
    if (!BRACKET_IDS.includes(body.bracket as BracketId)) {
      res.status(400).json({ error: "bracket must be 1-5" });
      return;
    }

    const deck = await prisma.deck.findFirst({
      where: { id: req.params.id, ownerId: req.userId },
      include: { cards: true },
    });
    if (!deck) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }

    const updated = await prisma.deck.update({
      where: { id: deck.id },
      data: {
        bracket: body.bracket as BracketId,
        hasMassLandDenial: body.hasMassLandDenial === true,
        hasChainedExtraTurns: body.hasChainedExtraTurns === true,
        hasTwoCardCombos: body.hasTwoCardCombos === true,
        combosAreLateGameOnly: body.combosAreLateGameOnly === true,
        hasHeavyTutoring: body.hasHeavyTutoring === true,
      },
    });

    const legality = validateDeckLegality(await resolveDeckEntries(deck.cards));
    res.json({ ok: true, bracketReport: evaluateBracket(selfReportOf(updated), legality.gameChangerCount) });
  })
);

decksRouter.delete(
  "/:id",
  wrap(async (req, res) => {
    await prisma.deck.deleteMany({ where: { id: req.params.id, ownerId: req.userId } });
    res.status(204).end();
  })
);
