import "dotenv/config";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { prisma } from "./db";

/**
 * Answers "is this ready for people to join?" before anyone is waiting on it.
 * Everything here is a common way a playtest falls over in the first minute.
 */

const PORT = Number(process.env.PORT) || 4000;

type Level = "ok" | "warn" | "fail";
const results: Array<{ level: Level; label: string; detail: string }> = [];
const add = (level: Level, label: string, detail: string) => results.push({ level, label, detail });

function lanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

async function main() {
  // A built client is what makes the single-port setup work at all.
  const clientDist = path.resolve(__dirname, "../../client/dist/index.html");
  existsSync(clientDist)
    ? add("ok", "Client build", "client/dist is present")
    : add("fail", "Client build", "missing — run: npm run build");

  if (!process.env.JWT_SECRET) {
    add("fail", "JWT_SECRET", "not set — copy server/.env.example to server/.env");
  } else if (process.env.JWT_SECRET.includes("dev-only")) {
    add("warn", "JWT_SECRET", "still the example value; fine for a private playtest");
  } else {
    add("ok", "JWT_SECRET", "set");
  }

  // Cookies marked secure are dropped over http, which looks like login
  // silently failing for everyone who isn't on https.
  const cookieSecure = process.env.COOKIE_SECURE === "true";
  if (cookieSecure) {
    add("warn", "COOKIE_SECURE", "true — only works if guests reach you over https");
  } else {
    add("ok", "COOKIE_SECURE", "false — correct for plain http on a LAN");
  }

  try {
    const cards = await prisma.card.count();
    if (cards === 0) {
      add("fail", "Card data", "no cards — run: npm run sync:cards");
    } else {
      const state = await prisma.cardSyncState.findUnique({ where: { id: "singleton" } });
      const age = state?.lastSyncedAt ? (Date.now() - state.lastSyncedAt.getTime()) / 86_400_000 : null;
      add("ok", "Card data", `${cards.toLocaleString()} cards${age !== null ? `, synced ${age.toFixed(1)} days ago` : ""}`);
    }

    const decks = await prisma.deck.count();
    add(decks > 0 ? "ok" : "warn", "Decks", decks > 0 ? `${decks} saved` : "none yet — build one before the game starts");
  } catch (err) {
    add("fail", "Database", `unreachable — run: npm run prisma:generate && npx prisma db push (${(err as Error).message})`);
  }

  const lan = lanAddress();
  lan
    ? add("ok", "Network address", `guests should open http://${lan}:${PORT}`)
    : add("warn", "Network address", "no LAN address found; localhost only");

  const symbols: Record<Level, string> = { ok: "PASS", warn: "WARN", fail: "FAIL" };
  console.log("\n  Playtest readiness\n");
  for (const r of results) {
    console.log(`  ${symbols[r.level].padEnd(5)} ${r.label.padEnd(17)} ${r.detail}`);
  }

  const failed = results.filter((r) => r.level === "fail");
  if (failed.length > 0) {
    console.log(`\n  ${failed.length} thing(s) to fix before hosting.\n`);
    process.exitCode = 1;
    return;
  }

  console.log("\n  Ready. Start with: npm run playtest");
  console.log("  Note: browsers block webcam and mic unless the page is https or localhost,");
  console.log("  so over plain http guests can play but won't have video. Use a tunnel");
  console.log("  (e.g. cloudflared) for an https URL, and set COOKIE_SECURE=true with it.\n");
}

main().finally(async () => {
  await prisma.$disconnect();
});
