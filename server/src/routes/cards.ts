import { Router } from "express";
import { wrap } from "../async-handler";
import { prisma } from "../db";
import { fromPrismaCard } from "../scryfall/mapper";

export const cardsRouter = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Card-data health. The whole rules layer depends on this table, so it's worth
 * being able to see at a glance whether it's fresh.
 */
cardsRouter.get(
  "/sync-status",
  wrap(async (_req, res) => {
    const [state, cardCount] = await Promise.all([
      prisma.cardSyncState.findUnique({ where: { id: "singleton" } }),
      prisma.card.count(),
    ]);

    const ageHours = state?.lastSyncedAt ? (Date.now() - state.lastSyncedAt.getTime()) / 3_600_000 : null;
    res.json({
      cardCount,
      // Scryfall rebuilds bulk data every 12-24h; well past that means the
      // refresh has stopped running.
      healthy: cardCount > 0 && ageHours !== null && ageHours < 72,
      lastStatus: state?.lastStatus ?? "never-run",
      lastSyncedAt: state?.lastSyncedAt ?? null,
      lastCheckedAt: state?.lastCheckedAt ?? null,
      bulkUpdatedAt: state?.bulkUpdatedAt ?? null,
      ageHours: ageHours === null ? null : Number(ageHours.toFixed(1)),
      lastError: state?.lastError ?? null,
    });
  })
);

cardsRouter.get(
  "/search",
  wrap(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);

  if (!q) {
    res.json({ cards: [], total: 0 });
    return;
  }

  const [rows, total] = await Promise.all([
    prisma.card.findMany({
      where: { name: { contains: q } },
      orderBy: { name: "asc" },
      take: limit,
    }),
    prisma.card.count({ where: { name: { contains: q } } }),
  ]);

    res.json({ cards: rows.map(fromPrismaCard), total });
  })
);

cardsRouter.get(
  "/:oracleId",
  wrap(async (req, res) => {
    const row = await prisma.card.findUnique({ where: { oracleId: req.params.oracleId } });
    if (!row) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    res.json(fromPrismaCard(row));
  })
);
