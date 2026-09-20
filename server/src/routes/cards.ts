import { Router } from "express";
import { prisma } from "../db";
import { fromPrismaCard } from "../scryfall/mapper";

export const cardsRouter = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

cardsRouter.get("/search", async (req, res) => {
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
});

cardsRouter.get("/:oracleId", async (req, res) => {
  const row = await prisma.card.findUnique({ where: { oracleId: req.params.oracleId } });
  if (!row) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  res.json(fromPrismaCard(row));
});
