import { syncCards } from "./sync";

const DEFAULT_INTERVAL_HOURS = 24;

/**
 * Keeps card data current without anyone remembering to run the sync.
 *
 * Scryfall rebuilds bulk data every 12-24 hours and suggests gameplay-only
 * consumers refresh daily at most, so each tick is usually one request that
 * finds nothing new and stops. Set CARD_SYNC_INTERVAL_HOURS=0 to disable.
 */
export function startCardSyncScheduler() {
  const hours = Number(process.env.CARD_SYNC_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.log("Card sync scheduler disabled (CARD_SYNC_INTERVAL_HOURS=0).");
    return;
  }

  const run = async () => {
    const result = await syncCards({ log: (m) => console.log(`[card-sync] ${m}`) });
    if (result.status === "failed") {
      console.error(`[card-sync] refresh failed, keeping existing data: ${result.message}`);
    }
  };

  void run();
  const timer = setInterval(run, hours * 60 * 60 * 1000);
  timer.unref(); // never hold the process open just for a refresh
  console.log(`Card sync scheduler running every ${hours}h.`);
}
