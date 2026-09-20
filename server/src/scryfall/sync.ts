import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { prisma } from "../db";
import { toPrismaCardData, type ScryfallCardJson } from "./mapper";

const BULK_DATA_INDEX_URL = "https://api.scryfall.com/bulk-data";
const USER_AGENT = "MTG-Commander-Website/0.1 (local dev sync script)";
const BATCH_SIZE = 100;

interface BulkDataEntry {
  type: string;
  /** Gzip-compressed JSON Lines file: one card JSON object per line. */
  jsonl_download_uri: string;
  updated_at: string;
  compressed_size: number;
}

async function getOracleCardsDownloadUrl(): Promise<string> {
  const res = await fetch(BULK_DATA_INDEX_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to list Scryfall bulk data: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { data: BulkDataEntry[] };
  const oracleCards = body.data.find((entry) => entry.type === "oracle_cards");
  if (!oracleCards) throw new Error("Scryfall bulk-data index did not include an oracle_cards entry");
  return oracleCards.jsonl_download_uri;
}

/** Streams the gzip-compressed JSONL file and yields one parsed card per line. */
async function* streamOracleCards(url: string): AsyncGenerator<ScryfallCardJson> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "gzip" } });
  if (!res.ok || !res.body) throw new Error(`Failed to download oracle_cards bulk file: ${res.status} ${res.statusText}`);

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

  while (url) {
    const res: Response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Failed to page is:commander search: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { data: Array<{ oracle_id?: string }>; has_more: boolean; next_page?: string };
    for (const card of body.data) if (card.oracle_id) ids.add(card.oracle_id);
    url = body.has_more ? body.next_page ?? null : null;
    await new Promise((resolve) => setTimeout(resolve, 100)); // Scryfall asks for ~10 req/s max
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

async function main() {
  console.log("Fetching Scryfall bulk-data index...");
  const downloadUrl = await getOracleCardsDownloadUrl();

  console.log("Fetching the is:commander set...");
  const commanderOracleIds = await fetchCommanderOracleIds();
  console.log(`  ${commanderOracleIds.size} commander-eligible cards.`);

  console.log(`Streaming oracle_cards from ${downloadUrl} ...`);

  const keptOracleIds = new Set<string>();
  let seen = 0;
  let batch: ScryfallCardJson[] = [];

  for await (const card of streamOracleCards(downloadUrl)) {
    batch.push(card);
    seen += 1;
    if (batch.length >= BATCH_SIZE) {
      for (const id of await upsertBatch(batch, commanderOracleIds)) keptOracleIds.add(id);
      batch = [];
      if (seen % (BATCH_SIZE * 20) === 0) console.log(`  ${seen} seen, ${keptOracleIds.size} upserted...`);
    }
  }
  if (batch.length > 0) {
    for (const id of await upsertBatch(batch, commanderOracleIds)) keptOracleIds.add(id);
  }

  const deleted = await deleteStaleRows(keptOracleIds);

  console.log(`Done. Saw ${seen} entries, upserted ${keptOracleIds.size}, removed ${deleted} stale/non-card rows.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
