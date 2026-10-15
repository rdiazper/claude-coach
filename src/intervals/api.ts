import type { Credentials } from "../lib/config.js";
import { log } from "../lib/logging.js";
import type { IntervalsActivity, IntervalsAthlete } from "./types.js";

const API_BASE = "https://intervals.icu/api/v1";

// intervals.icu authenticates with HTTP Basic auth: username is the literal
// string "API_KEY", password is the athlete's actual key from
// intervals.icu/settings. No OAuth, no browser flow, no refresh tokens.
function authHeader(apiKey: string): string {
  return "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
}

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  retries = 3
): Promise<Response> {
  const response = await fetch(url, { headers });

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get("retry-after") || "60");
    log.warn(`Rate limited. Waiting ${retryAfter}s...`);
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return fetchWithRetry(url, headers, retries);
  }

  // Don't retry 4xx errors (bad credentials, bad request, not found) - retrying
  // a 401 three times just delays telling the user their API key is wrong.
  // Only retry server errors (5xx) and the generic !ok fallback below is scoped
  // to that range.
  if (!response.ok && response.status >= 500 && retries > 0) {
    log.warn(`Request failed (${response.status}), retrying...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return fetchWithRetry(url, headers, retries - 1);
  }

  return response;
}

export async function getAthlete(creds: Credentials): Promise<IntervalsAthlete> {
  const response = await fetchWithRetry(`${API_BASE}/athlete/${creds.athlete_id}`, {
    Authorization: authHeader(creds.api_key),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Authentication failed (${response.status}). Check that your Athlete ID and API Key ` +
          `are correct - find both at https://intervals.icu/settings under "Developer Settings".`
      );
    }
    throw new Error(`Failed to fetch athlete: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// intervals.icu's activity list is not paginated the way Strava's is (no page/per_page
// params) - it returns everything in the requested date range in one response. For a
// multi-year sync that single response can get large, so we chunk the range into
// ~120-day windows to keep each request reasonably sized and to give retries a smaller
// blast radius if one window fails.
const CHUNK_DAYS = 120;

function toDateParam(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function getActivitiesInRange(
  creds: Credentials,
  oldest: Date,
  newest: Date
): Promise<IntervalsActivity[]> {
  const url = new URL(`${API_BASE}/athlete/${creds.athlete_id}/activities`);
  url.searchParams.set("oldest", toDateParam(oldest));
  url.searchParams.set("newest", toDateParam(newest));

  const response = await fetchWithRetry(url.toString(), {
    Authorization: authHeader(creds.api_key),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch activities: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function getAllActivities(
  creds: Credentials,
  afterDate: Date
): Promise<IntervalsActivity[]> {
  const activities: IntervalsActivity[] = [];
  const today = new Date();

  log.start(`Fetching activities since ${afterDate.toISOString().split("T")[0]}...`);

  let windowStart = new Date(afterDate);
  while (windowStart < today) {
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + CHUNK_DAYS);
    const effectiveEnd = windowEnd > today ? today : windowEnd;

    const batch = await getActivitiesInRange(creds, windowStart, effectiveEnd);
    activities.push(...batch);
    log.progress(`   Fetched ${activities.length} activities...`);

    windowStart = effectiveEnd;
    // Be nice to the API between chunks.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  log.progressEnd();
  log.success(`Fetched ${activities.length} activities total`);
  return activities;
}
