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

async function upsertBatch(batch: ScryfallCardJson[]): Promise<number> {
  const rows = batch.map(toPrismaCardData).filter((row): row is NonNullable<typeof row> => row !== null);
  await prisma.$transaction(
    rows.map((row) =>
      prisma.card.upsert({
        where: { oracleId: row.oracleId },
        create: row,
        update: row,
      })
    )
  );
  return rows.length;
}

async function main() {
  console.log("Fetching Scryfall bulk-data index...");
  const downloadUrl = await getOracleCardsDownloadUrl();

  console.log(`Streaming oracle_cards from ${downloadUrl} ...`);

  let written = 0;
  let seen = 0;
  let batch: ScryfallCardJson[] = [];

  for await (const card of streamOracleCards(downloadUrl)) {
    batch.push(card);
    seen += 1;
    if (batch.length >= BATCH_SIZE) {
      written += await upsertBatch(batch);
      batch = [];
      if (seen % (BATCH_SIZE * 20) === 0) console.log(`  ${seen} seen, ${written} upserted...`);
    }
  }
  if (batch.length > 0) written += await upsertBatch(batch);

  console.log(`Done. Saw ${seen} cards, upserted ${written}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
