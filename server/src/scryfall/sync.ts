import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { prisma } from "../db";
import { scryfallFetch } from "./client";
import { toPrismaCardData, type ScryfallCardJson } from "./mapper";

const BULK_DATA_INDEX_URL = "https://api.scryfall.com/bulk-data";
const BATCH_SIZE = 100;

interface BulkDataEntry {
  type: string;
  /** Gzip-compressed JSON Lines file: one card JSON object per line. */
  jsonl_download_uri: string;
  updated_at: string;
  compressed_size: number;
}

async function getOracleCardsEntry(): Promise<BulkDataEntry> {
  const res = await scryfallFetch(BULK_DATA_INDEX_URL, { onRetry: console.warn });
  const body = (await res.json()) as { data: BulkDataEntry[] };
  const oracleCards = body.data.find((entry) => entry.type === "oracle_cards");
  if (!oracleCards) throw new Error("Scryfall bulk-data index did not include an oracle_cards entry");
  return oracleCards;
}

/** Streams the gzip-compressed JSONL file and yields one parsed card per line. */
async function* streamOracleCards(url: string): AsyncGenerator<ScryfallCardJson> {
  const res = await scryfallFetch(url, { accept: "application/x-ndjson", onRetry: console.warn });
  if (!res.body) throw new Error("Scryfall returned an empty bulk file body");

  const gunzip = createGunzip();
  Readable.fromWeb(res.body as import("node:stream/web").ReadableStream).pipe(gunzip);
  const lines = createInterface({ input: gunzip, crlfDelay: Infinity });

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    yield JSON.parse(trimmed) as ScryfallCardJson;
  }
}

/**
 * Scryfall computes commander eligibility itself, covering cases that rules
 * text alone doesn't reveal (Shorikai, Genesis Engine is a legal commander but
 * never says so on the card). Paginating `is:commander` is ~22 requests.
 */
async function fetchCommanderOracleIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let url: string | null = "https://api.scryfall.com/cards/search?q=is%3Acommander&unique=cards";

  // The client paces these: /cards/search is capped at 2 requests per second.
  while (url) {
    const res: Response = await scryfallFetch(url, { onRetry: console.warn });
    const body = (await res.json()) as { data: Array<{ oracle_id?: string }>; has_more: boolean; next_page?: string };
    for (const card of body.data) if (card.oracle_id) ids.add(card.oracle_id);
    url = body.has_more ? body.next_page ?? null : null;
  }

  return ids;
}

async function upsertBatch(batch: ScryfallCardJson[], commanderOracleIds: ReadonlySet<string>): Promise<string[]> {
  const rows = batch
    .map((card) => toPrismaCardData(card, commanderOracleIds))
    .filter((row): row is NonNullable<typeof row> => row !== null);
  await prisma.$transaction(
    rows.map((row) =>
      prisma.card.upsert({
        where: { oracleId: row.oracleId },
        create: row,
        update: row,
      })
    )
  );
  return rows.map((row) => row.oracleId);
}

/** Drops rows for entries Scryfall no longer publishes, or that we now filter out. */
async function deleteStaleRows(keptOracleIds: ReadonlySet<string>): Promise<number> {
  const existing = await prisma.card.findMany({ select: { oracleId: true } });
  const stale = existing.map((row) => row.oracleId).filter((id) => !keptOracleIds.has(id));

  for (let i = 0; i < stale.length; i += 500) {
    await prisma.card.deleteMany({ where: { oracleId: { in: stale.slice(i, i + 500) } } });
  }
  return stale.length;
}

export const SYNC_STATE_ID = "singleton";

export interface SyncResult {
  status: "updated" | "already-current" | "failed";
  cardCount: number;
  bulkUpdatedAt: Date | null;
  message: string;
}

async function recordState(data: {
  status: string;
  cardCount?: number;
  bulkUpdatedAt?: Date | null;
  error?: string | null;
  synced?: boolean;
}) {
  const now = new Date();
  const fields = {
    lastCheckedAt: now,
    lastStatus: data.status,
    lastError: data.error ?? null,
    ...(data.synced ? { lastSyncedAt: now } : {}),
    ...(data.cardCount !== undefined ? { cardCount: data.cardCount } : {}),
    ...(data.bulkUpdatedAt !== undefined ? { bulkUpdatedAt: data.bulkUpdatedAt } : {}),
  };
  await prisma.cardSyncState.upsert({
    where: { id: SYNC_STATE_ID },
    create: { id: SYNC_STATE_ID, ...fields },
    update: fields,
  });
}

/**
 * Pulls card data if Scryfall has published a newer bulk file than the one we
 * already hold. Scryfall rebuilds bulk data every 12-24 hours and asks that
 * clients not re-download unchanged data, so the common case is a single
 * cheap request that changes nothing.
 */
export async function syncCards({ force = false, log = console.log }: { force?: boolean; log?: (m: string) => void } = {}): Promise<SyncResult> {
  try {
    log("Checking Scryfall bulk-data index...");
    const entry = await getOracleCardsEntry();
    const bulkUpdatedAt = new Date(entry.updated_at);

    const state = await prisma.cardSyncState.findUnique({ where: { id: SYNC_STATE_ID } });
    const current = state?.bulkUpdatedAt?.getTime() === bulkUpdatedAt.getTime() && (state?.cardCount ?? 0) > 0;

    if (current && !force) {
      await recordState({ status: "already-current", bulkUpdatedAt });
      const message = `Card data is already current (Scryfall bulk file from ${entry.updated_at}).`;
      log(message);
      return { status: "already-current", cardCount: state?.cardCount ?? 0, bulkUpdatedAt, message };
    }

    log("Fetching the is:commander set...");
    const commanderOracleIds = await fetchCommanderOracleIds();
    log(`  ${commanderOracleIds.size} commander-eligible cards.`);

    log(`Streaming oracle_cards published ${entry.updated_at} ...`);
    const keptOracleIds = new Set<string>();
    let seen = 0;
    let batch: ScryfallCardJson[] = [];

    for await (const card of streamOracleCards(entry.jsonl_download_uri)) {
      batch.push(card);
      seen += 1;
      if (batch.length >= BATCH_SIZE) {
        for (const id of await upsertBatch(batch, commanderOracleIds)) keptOracleIds.add(id);
        batch = [];
        if (seen % (BATCH_SIZE * 20) === 0) log(`  ${seen} seen, ${keptOracleIds.size} upserted...`);
      }
    }
    if (batch.length > 0) {
      for (const id of await upsertBatch(batch, commanderOracleIds)) keptOracleIds.add(id);
    }

    const deleted = await deleteStaleRows(keptOracleIds);
    await recordState({ status: "updated", cardCount: keptOracleIds.size, bulkUpdatedAt, synced: true });

    const message = `Saw ${seen} entries, upserted ${keptOracleIds.size}, removed ${deleted} stale/non-card rows.`;
    log(`Done. ${message}`);
    return { status: "updated", cardCount: keptOracleIds.size, bulkUpdatedAt, message };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A failed refresh leaves the previous card data in place; the table is
    // only ever replaced by a run that got all the way through.
    await recordState({ status: "failed", error: message });
    return { status: "failed", cardCount: 0, bulkUpdatedAt: null, message };
  }
}

/** Run directly (npm run sync:cards), optionally with --force. */
if (require.main === module) {
  syncCards({ force: process.argv.includes("--force") })
    .then((result) => {
      if (result.status === "failed") {
        console.error(result.message);
        process.exitCode = 1;
      }
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
