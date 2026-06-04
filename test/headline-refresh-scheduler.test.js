import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureHeadlineRefreshTimer,
  isHeadlineSnapshotCurrent,
  pacificSixHourBucket,
  runHeadlineRefreshCheck,
  stopHeadlineRefreshTimer,
} from '../src/headline-refresh-scheduler.js';

test('pacificSixHourBucket groups times into Pacific refresh windows', () => {
  assert.equal(pacificSixHourBucket(new Date('2026-06-04T12:59:00Z')), '2026-06-04T00');
  assert.equal(pacificSixHourBucket(new Date('2026-06-04T13:00:00Z')), '2026-06-04T06');
  assert.equal(pacificSixHourBucket(new Date('2026-06-04T19:00:00Z')), '2026-06-04T12');
  assert.equal(pacificSixHourBucket(new Date('2026-06-05T01:00:00Z')), '2026-06-04T18');
});

test('isHeadlineSnapshotCurrent compares fetchedAt against the current Pacific bucket', () => {
  const now = new Date('2026-06-04T14:30:00Z'); // 7:30 AM Pacific, 6 AM bucket

  assert.equal(isHeadlineSnapshotCurrent({ fetchedAt: '2026-06-04T13:05:00Z' }, now), true);
  assert.equal(isHeadlineSnapshotCurrent({ fetchedAt: '2026-06-04T12:55:00Z' }, now), false);
  assert.equal(isHeadlineSnapshotCurrent({ fetchedAt: 'not-a-date' }, now), false);
  assert.equal(isHeadlineSnapshotCurrent(null, now), false);
});

test('runHeadlineRefreshCheck refreshes stale snapshots without blocking on requests', async () => {
  const calls = [];
  const castAudioCalls = [];
  const refreshedSnapshot = {
    fetchedAt: '2026-06-04T20:05:00Z',
    headlines: [{ title: 'New headline' }],
  };
  const result = await runHeadlineRefreshCheck({
    getNow: () => new Date('2026-06-04T20:05:00Z'), // 1:05 PM Pacific, noon bucket
    readSnapshot: async () => ({ fetchedAt: '2026-06-04T13:05:00Z' }),
    refresh: async (options) => {
      calls.push(options);
      return refreshedSnapshot;
    },
    ensureCastAudio: async (snapshot) => castAudioCalls.push(snapshot),
    logger: { info() {}, error() {} },
  });

  assert.equal(result.status, 'refreshed');
  assert.equal(result.bucket, '2026-06-04T12');
  assert.deepEqual(calls, [{ force: true, now: new Date('2026-06-04T20:05:00Z') }]);
  assert.deepEqual(castAudioCalls, [refreshedSnapshot]);
});

test('runHeadlineRefreshCheck skips snapshots from the current bucket', async () => {
  const calls = [];
  const castAudioCalls = [];
  const snapshot = {
    fetchedAt: '2026-06-04T19:05:00Z',
    headlines: [{ title: 'Current headline' }],
  };
  const result = await runHeadlineRefreshCheck({
    getNow: () => new Date('2026-06-04T20:05:00Z'),
    readSnapshot: async () => snapshot,
    refresh: async (options) => calls.push(options),
    ensureCastAudio: async (item) => castAudioCalls.push(item),
    logger: { info() {}, error() {} },
  });

  assert.equal(result.status, 'fresh');
  assert.deepEqual(calls, []);
  assert.deepEqual(castAudioCalls, [snapshot]);
});

test('runHeadlineRefreshCheck does not overlap refresh work', async () => {
  const calls = [];
  let finishRefresh;
  const first = runHeadlineRefreshCheck({
    getNow: () => new Date('2026-06-04T20:05:00Z'),
    readSnapshot: async () => ({ fetchedAt: '2026-06-04T13:05:00Z' }),
    refresh: async (options) => {
      calls.push(options);
      await new Promise((resolve) => { finishRefresh = resolve; });
    },
    ensureCastAudio: async () => {},
    logger: { info() {}, error() {} },
  });

  const second = await runHeadlineRefreshCheck({
    getNow: () => new Date('2026-06-04T20:05:00Z'),
    readSnapshot: async () => ({ fetchedAt: '2026-06-04T13:05:00Z' }),
    refresh: async (options) => calls.push(options),
    ensureCastAudio: async () => {},
    logger: { info() {}, error() {} },
  });

  assert.equal(second.status, 'already-checking');
  assert.equal(calls.length, 1);

  finishRefresh();
  assert.equal((await first).status, 'refreshed');
});

test('ensureHeadlineRefreshTimer is singleton for quick successive requests', async () => {
  stopHeadlineRefreshTimer();

  let checks = 0;
  const firstTimer = ensureHeadlineRefreshTimer({
    checkIntervalMs: 60 * 60 * 1000,
    getNow: () => new Date('2026-06-04T20:05:00Z'),
    readSnapshot: async () => {
      checks += 1;
      return { fetchedAt: '2026-06-04T19:05:00Z' };
    },
    refresh: async () => {},
    ensureCastAudio: async () => {},
    logger: { info() {}, error() {} },
  });
  const secondTimer = ensureHeadlineRefreshTimer({
    checkIntervalMs: 60 * 60 * 1000,
    getNow: () => new Date('2026-06-04T20:05:00Z'),
    readSnapshot: async () => {
      checks += 1;
      return { fetchedAt: '2026-06-04T19:05:00Z' };
    },
    refresh: async () => {},
    logger: { info() {}, error() {} },
  });

  await new Promise((resolve) => setImmediate(resolve));
  stopHeadlineRefreshTimer();

  assert.equal(secondTimer, firstTimer);
  assert.equal(checks, 1);
});
