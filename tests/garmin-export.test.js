import test from 'node:test';
import assert from 'node:assert/strict';
import { zip } from './fixtures/zip.js';
import { importGarminExport, parseGarminSummary } from '../public/garmin-export.js';
import { mergeActivities } from '../public/activities.js';
import { parseGarminCsv } from '../public/csv.js';
import { readZipDirectory, readZipEntry } from '../public/zip.js';

const raw = (overrides = {}) => ({ activityId: 123, activityType: 'trail_running',
  startTimeLocal: Date.UTC(2026, 9, 8, 23, 30), startTimeGmt: Date.UTC(2026, 9, 8, 21, 30),
  distance: 500000, duration: 1500000, avgSpeed: 1 / 3, avgHr: 150, ...overrides });
const summary = (...records) => [{ summarizedActivitiesExport: records }];

test('normalizes export units and retains local wall time and UTC separately', () => {
  const { activities } = parseGarminSummary(summary(raw()));
  assert.deepEqual(activities[0], { activityId: '123', type: 'trail running', date: '2026-10-08',
    startTime: '2026-10-08T23:30:00', startTimeUtc: '2026-10-08T21:30:00.000Z',
    distance: 5000, durationSeconds: 1500, paceSecondsPerKm: 300, averageHeartRate: 150 });
});

test('keeps non-running activities without distance and skips invalid records and multisport parents', () => {
  const result = parseGarminSummary(summary(raw({ activityType: 'strength_training', distance: undefined, avgHr: undefined }),
    raw({ parent: true }), raw({ activityId: null }), raw({ startTimeLocal: 1e99 })));
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0].type, 'strength');
  assert.equal(result.activities[0].distance, null);
  assert.equal(result.activities[0].averageHeartRate, null);
  assert.equal(result.skipped, 2);
  assert.equal(result.parents, 1);
  assert.throws(() => parseGarminSummary({}), /format/);
});

test('discovers all summary parts and ignores unrelated archives', async () => {
  const progress = [];
  const result = await importGarminExport(zip([
    ['prefix/DI_CONNECT/DI-Connect-Fitness/anonymous_301_summarizedActivities.json', JSON.stringify(summary(raw()))],
    ['prefix/anonymous_1_summarizedActivities.json', JSON.stringify(summary(raw({ activityId: 456, startTimeLocal: Date.UTC(2026, 9, 9) })))],
    ['UnrelatedBackup.zip', 'not a zip'], ['account.json', 'not JSON'],
  ]), value => progress.push(value));
  assert.equal(result.activities.length, 2);
  assert.equal(result.runs.length, 2);
  assert.equal(result.summaryFiles, 2);
  assert.equal(progress.length, 3);
  assert.equal(mergeActivities(result.activities, result.activities).length, 2);
});

test('CSV and ZIP imports match aliases, preserve richer details, and keep separate starts', () => {
  const csv = parseGarminCsv('Activity Type,Date,Distance,Time,Avg HR\nTrail Running,2026-10-08 23:30:00,5,00:25:00,150');
  const incoming = parseGarminSummary(summary(raw({ avgHr: undefined })));
  const merged = mergeActivities(csv.activities, incoming.activities, { preserveMissing: true });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].averageHeartRate, 150);
  assert.equal(merged[0].activityId, '123');
  const reversed = mergeActivities(merged, csv.activities, { preserveMissing: true });
  assert.equal(reversed.length, 1);
  assert.equal(reversed[0].startTimeUtc, '2026-10-08T21:30:00.000Z');
  assert.equal(mergeActivities(merged, parseGarminSummary(summary(raw({ activityId: 789, startTimeLocal: Date.UTC(2026, 9, 8, 8) }))).activities).length, 2);
});

test('rejects missing summaries, corrupt ZIPs, malformed JSON, and oversized summaries', async () => {
  await assert.rejects(importGarminExport(zip([['wellness.json', '{}']])), /No Garmin activity summaries/);
  await assert.rejects(readZipDirectory(new Blob(['invalid'])), /valid ZIP/);
  await assert.rejects(importGarminExport(zip([['a_summarizedActivities.json', '{']])), SyntaxError);
  const archive = zip([['a_summarizedActivities.json', JSON.stringify(summary(raw()))]], 0);
  const [entry] = await readZipDirectory(archive);
  await assert.rejects(readZipEntry(archive, { ...entry, size: 65 * 1024 * 1024 }), /64 MB/);
  await assert.rejects(readZipEntry(archive, { ...entry, crc: entry.crc ^ 1 }), /checksum/);
  await assert.rejects(readZipEntry(archive, { ...entry, size: 1 }), /declared size/);
  await assert.rejects(readZipEntry(archive, { ...entry, flags: 1 }), /Encrypted/);
});
