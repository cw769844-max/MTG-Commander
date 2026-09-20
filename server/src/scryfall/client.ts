/**
 * A polite Scryfall client.
 *
 * Scryfall publishes hard per-endpoint rate limits and asks that 429s never be
 * ignored — repeatedly overrunning them can get an application banned, which
 * for us would mean no card data at all. Every request to Scryfall goes
 * through here so the pacing and backoff live in one place.
 *
 * https://scryfall.com/docs/api/rate-limits
 */

/** Documented hard limits, as the minimum gap between requests. */
const SEARCH_ENDPOINT_DELAY_MS = 500; // /cards/search, /named, /random, /collection: 2 per second
const DEFAULT_DELAY_MS = 100; // everything else on api.scryfall.com: 10 per second

/** Scryfall limits access for 30 seconds after a 429. */
const RATE_LIMITED_BACKOFF_MS = 30_000;
const MAX_ATTEMPTS = 4;

const STRICT_PATHS = ["/cards/search", "/cards/named", "/cards/random", "/cards/collection"];

const APP_VERSION = "0.1";
const CONTACT = process.env.SCRYFALL_CONTACT_URL || "https://github.com/cw769844-max/MTG-Commander";

/**
 * Scryfall asks that the User-Agent name the application rather than being
 * whatever the HTTP library picks by default.
 */
export const USER_AGENT = `MTG-Commander/${APP_VERSION} (${CONTACT})`;

let nextAllowedAt = 0;

function delayFor(url: string): number {
  const { hostname, pathname } = new URL(url);
  // The *.scryfall.io file origins (bulk downloads, card images) are explicitly
  // not rate limited.
  if (!hostname.endsWith("api.scryfall.com")) return 0;
  return STRICT_PATHS.some((p) => pathname.startsWith(p)) ? SEARCH_ENDPOINT_DELAY_MS : DEFAULT_DELAY_MS;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serialises requests so the configured gap is honoured across all callers. */
async function waitForTurn(url: string) {
  const delay = delayFor(url);
  if (delay === 0) return;

  const now = Date.now();
  const waitMs = Math.max(0, nextAllowedAt - now);
  nextAllowedAt = Math.max(now, nextAllowedAt) + delay;
  if (waitMs > 0) await sleep(waitMs);
}

export interface ScryfallFetchOptions {
  /** Content type to ask for; Scryfall requires an Accept header. */
  accept?: string;
  onRetry?: (message: string) => void;
}

export async function scryfallFetch(url: string, options: ScryfallFetchOptions = {}): Promise<Response> {
  const { accept = "application/json", onRetry } = options;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await waitForTurn(url);

    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: accept } });
    if (res.ok) return res;

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`Scryfall request failed: ${res.status} ${res.statusText} (${url})`);
    }

    // Back off for the documented lockout on a 429, and exponentially on 5xx.
    const backoff = res.status === 429 ? RATE_LIMITED_BACKOFF_MS : 1000 * 2 ** (attempt - 1);
    onRetry?.(`${res.status} from Scryfall; waiting ${Math.round(backoff / 1000)}s before retry ${attempt + 1}`);
    nextAllowedAt = Date.now() + backoff;
    await sleep(backoff);
  }

  throw new Error(`Scryfall request failed after ${MAX_ATTEMPTS} attempts (${url})`);
}
