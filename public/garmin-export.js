import { importGarminRoutes } from './garmin-routes.js';
import { mergeActivities, runningActivities, normalizeActivityType } from './activities.js';
import { readZipDirectory, readZipEntry } from './zip.js';

function positive(value, multiplier = 1) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value * multiplier : null;
}

export function parseGarminSummary(data) {
  if (!Array.isArray(data) || !data.length || data.some(group => !Array.isArray(group?.summarizedActivitiesExport))) {
    throw new Error('Unrecognized Garmin activity summary format.');
  }
  const activities = [];
  let skipped = 0;
  let parents = 0;
  for (const group of data) for (const raw of group.summarizedActivitiesExport) {
    if (raw?.parent === true) { parents++; continue; }
    if (!raw || typeof raw.activityType !== 'string' || !raw.activityType.trim()
      || !Number.isSafeInteger(raw.activityId) || raw.activityId <= 0
      || !Number.isFinite(raw.startTimeLocal)) { skipped++; continue; }
    const local = new Date(raw.startTimeLocal);
    if (Number.isNaN(local.getTime())) { skipped++; continue; }
    // Garmin encodes local wall time as an epoch value. UTC getters preserve it
    // even when this browser is in a different timezone from the activity.
    const startTime = local.toISOString().slice(0, 19);
    const distance = positive(raw.distance, 0.01);
    const durationSeconds = positive(raw.duration, 0.001);
    const speed = positive(raw.avgSpeed, 10); // centimeters/millisecond -> m/s
    activities.push({ activityId: String(raw.activityId), date: startTime.slice(0, 10), startTime,
      ...(Number.isFinite(raw.startTimeGmt) && !Number.isNaN(new Date(raw.startTimeGmt).getTime()) ? { startTimeUtc: new Date(raw.startTimeGmt).toISOString() } : {}),
      type: normalizeActivityType(raw.activityType), distance, durationSeconds,
      paceSecondsPerKm: speed ? 1000 / speed : (distance && durationSeconds ? durationSeconds / (distance / 1000) : null),
      averageHeartRate: positive(raw.avgHr),
    });
  }
  return { activities, skipped, parents };
}

export async function importGarminExport(blob, onProgress = () => {}) {
  onProgress({ message: 'Reading Garmin ZIP…' });
  const directory = await readZipDirectory(blob);
  const entries = directory.filter(entry => /(?:^|\/)[^/]*_summarizedActivities\.json$/i.test(entry.name));
  if (!entries.length) throw new Error('No Garmin activity summaries found. Choose your complete Garmin data export ZIP.');
  if (entries.reduce((sum, entry) => sum + entry.size, 0) > 128 * 1024 * 1024) throw new Error('Activity summaries exceed the 128 MB import limit.');
  let activities = [];
  let skipped = 0;
  let parents = 0;
  for (const [index, entry] of entries.entries()) {
    onProgress({ message: `Reading activity summaries (${index + 1}/${entries.length})…` });
    const result = parseGarminSummary(JSON.parse(new TextDecoder().decode(await readZipEntry(blob, entry))));
    activities = mergeActivities(activities, result.activities, { preserveMissing: true });
    skipped += result.skipped;
    parents += result.parents;
  }
  if (!activities.length) throw new Error('No valid activities found in the Garmin export.');
  const routeResult = await importGarminRoutes(blob, directory, activities, onProgress);
  return { activities, runs: runningActivities(activities), skipped, parents, summaryFiles: entries.length, ...routeResult };
}
