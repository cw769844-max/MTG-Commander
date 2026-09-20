import { prisma } from "../db";
import { toPrismaCardData, type ScryfallCardJson } from "./mapper";

const BULK_DATA_INDEX_URL = "https://api.scryfall.com/bulk-data";
const USER_AGENT = "MTG-Commander-Website/0.1 (local dev sync script)";
const BATCH_SIZE = 100;

interface BulkDataEntry {
  type: string;
  download_uri: string;
  updated_at: string;
  size: number;
}

async function getOracleCardsDownloadUrl(): Promise<string> {
  const res = await fetch(BULK_DATA_INDEX_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to list Scryfall bulk data: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { data: BulkDataEntry[] };
  const oracleCards = body.data.find((entry) => entry.type === "oracle_cards");
  if (!oracleCards) throw new Error("Scryfall bulk-data index did not include an oracle_cards entry");
  return oracleCards.download_uri;
}

async function downloadOracleCards(url: string): Promise<ScryfallCardJson[]> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Failed to download oracle_cards bulk file: ${res.status} ${res.statusText}`);
  return (await res.json()) as ScryfallCardJson[];
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

  console.log(`Downloading oracle_cards from ${downloadUrl} ...`);
  const cards = await downloadOracleCards(downloadUrl);
  console.log(`Downloaded ${cards.length} cards. Upserting into local database...`);

  let written = 0;
  for (let i = 0; i < cards.length; i += BATCH_SIZE) {
    const batch = cards.slice(i, i + BATCH_SIZE);
    written += await upsertBatch(batch);
    if (i % (BATCH_SIZE * 20) === 0) {
      console.log(`  ${Math.min(i + BATCH_SIZE, cards.length)} / ${cards.length}`);
    }
  }

  console.log(`Done. Upserted ${written} cards.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
