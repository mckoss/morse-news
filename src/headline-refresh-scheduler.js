import { fetchHeadlines, readHeadlineCache } from './headlines.js';

export const HEADLINE_REFRESH_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

let refreshTimer = null;
let refreshCheckPromise = null;
let refreshPromise = null;

const pacificPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PACIFIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
});

export function pacificSixHourBucket(date) {
  const parts = Object.fromEntries(
    pacificPartsFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  const bucketHour = Math.floor(hour / 6) * 6;
  return `${parts.year}-${parts.month}-${parts.day}T${String(bucketHour).padStart(2, '0')}`;
}

export function isHeadlineSnapshotCurrent(snapshot, now = new Date()) {
  if (!snapshot?.fetchedAt) return false;
  const fetchedAt = new Date(snapshot.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) return false;
  return pacificSixHourBucket(fetchedAt) === pacificSixHourBucket(now);
}

export async function runHeadlineRefreshCheck({
  getNow = () => new Date(),
  readSnapshot = readHeadlineCache,
  refresh = fetchHeadlines,
  logger = console,
} = {}) {
  if (refreshCheckPromise) return { status: 'already-checking' };

  refreshCheckPromise = (async () => {
    const now = getNow();
    const snapshot = await readSnapshot();
    if (isHeadlineSnapshotCurrent(snapshot, now)) {
      return { status: 'fresh', bucket: pacificSixHourBucket(now) };
    }

    refreshPromise = (async () => {
      logger.info?.(`[headlines] refreshing for Pacific bucket ${pacificSixHourBucket(now)}`);
      await refresh({ force: true, now });
    })();

    try {
      await refreshPromise;
      return { status: 'refreshed', bucket: pacificSixHourBucket(now) };
    } finally {
      refreshPromise = null;
    }
  })();

  try {
    return await refreshCheckPromise;
  } finally {
    refreshCheckPromise = null;
  }
}

export function ensureHeadlineRefreshTimer({
  checkIntervalMs = HEADLINE_REFRESH_CHECK_INTERVAL_MS,
  logger = console,
  ...checkOptions
} = {}) {
  if (refreshTimer) return refreshTimer;

  const run = () => {
    runHeadlineRefreshCheck({ ...checkOptions, logger }).catch((error) => {
      logger.error?.('[headlines] scheduled refresh failed', error);
    });
  };

  refreshTimer = setInterval(run, checkIntervalMs);
  refreshTimer.unref?.();
  run();
  return refreshTimer;
}

export function stopHeadlineRefreshTimer() {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}
