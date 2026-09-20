import { Router } from "express";
import { prisma } from "../db";
import { fromPrismaCard } from "../scryfall/mapper";
import { validateDeckLegality, type ResolvedDeckEntry } from "../deck-legality";

export const decksRouter = Router();

async function resolveDeckEntries(deckCards: { cardOracleId: string; quantity: number; isCommander: boolean }[]) {
  const oracleIds = deckCards.map((dc) => dc.cardOracleId);
  const rows = await prisma.card.findMany({ where: { oracleId: { in: oracleIds } } });
  const byId = new Map(rows.map((r) => [r.oracleId, fromPrismaCard(r)]));
  const entries: ResolvedDeckEntry[] = deckCards.map((dc) => ({
    deckCard: dc,
    card: byId.get(dc.cardOracleId),
  }));
  return entries;
}

decksRouter.get("/", async (req, res) => {
  const decks = await prisma.deck.findMany({ where: { ownerId: req.userId }, include: { cards: true } });
  res.json(decks);
});

decksRouter.get("/:id", async (req, res) => {
  const deck = await prisma.deck.findFirst({ where: { id: req.params.id, ownerId: req.userId }, include: { cards: true } });
  if (!deck) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  const legality = validateDeckLegality(await resolveDeckEntries(deck.cards));
  res.json({ ...deck, legality });
});

decksRouter.post("/", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const deck = await prisma.deck.create({ data: { name, ownerId: req.userId! } });
  res.status(201).json(deck);
});

decksRouter.put("/:id/cards", async (req, res) => {
  const { cards } = req.body as { cards: Array<{ cardOracleId: string; quantity: number; isCommander: boolean }> };
  const deck = await prisma.deck.findFirst({ where: { id: req.params.id, ownerId: req.userId } });
  if (!deck) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }

  await prisma.$transaction([
    prisma.deckCard.deleteMany({ where: { deckId: deck.id } }),
    prisma.deckCard.createMany({
      data: cards.map((c) => ({ ...c, deckId: deck.id })),
    }),
  ]);

  const legality = validateDeckLegality(await resolveDeckEntries(cards));
  res.json({ ok: true, legality });
});

decksRouter.delete("/:id", async (req, res) => {
  await prisma.deck.deleteMany({ where: { id: req.params.id, ownerId: req.userId } });
  res.status(204).end();
});
