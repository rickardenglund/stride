import { decodeFit } from './fit.js';
import { readZipDirectory, readZipEntry } from './zip.js';
import { mergeRoutes, routeCategory } from './routes.js';

export function routesFromFit(decoded, activities, fileName) {
  if (decoded.fileType !== 4 || decoded.records.length < 2) return { routes: [], unmatched: 0 };
  const sessions = decoded.sessions.length ? decoded.sessions : [{ start: decoded.records.find(point => point.time)?.time }];
  const routes = [];
  let unmatched = 0;
  for (const session of sessions) {
    if (!Number.isFinite(session.start)) { unmatched++; continue; }
    const sportCategories = { 1: ['running', 'trail'], 2: ['cycling'], 11: ['walking'], 17: ['walking'] };
    const candidates = activities.filter(activity => {
      const start = Date.parse(activity.startTimeUtc);
      return Number.isFinite(start) && Math.abs(start - session.start) <= 2000
        && (!sportCategories[session.sport] || sportCategories[session.sport].includes(routeCategory(activity.type)));
    });
    if (candidates.length !== 1) { unmatched++; continue; }
    const activity = candidates[0];
    const points = decoded.records.filter(point => sessions.length === 1 ||
      (point.time >= session.start && (session.end == null || point.time <= session.end)));
    if (points.length < 2) continue;
    const step = Math.max(1, Math.ceil((points.length - 1) / 999));
    routes.push({ activityId: activity.activityId, startTime: activity.startTime,
      date: activity.date, category: routeCategory(activity.type), fileName, name: '',
      points: points.filter((point, index) => index % step === 0 || index === points.length - 1)
        .map(({ time, ...point }) => point), source: 'fit' });
  }
  return { routes, unmatched };
}

export async function importGarminRoutes(blob, entries, activities, onProgress) {
  let routes = [];
  const stats = { scanned: 0, activityFiles: 0, failed: 0, unmatched: 0, withoutGps: 0 };
  const archives = entries.filter(entry => /(?:^|\/)UploadedFiles[^/]*\.zip$/i.test(entry.name));
  if (archives.reduce((sum, entry) => sum + entry.size, 0) > 1024 * 1024 * 1024) throw new Error('Nested recording archives exceed the 1 GB import limit.');
  async function readRecordings(archive, files, label) {
    const fits = files.filter(entry => /\.fit$/i.test(entry.name));
    if (fits.length > 60000) throw new Error('Too many FIT recordings in a ZIP archive.');
    for (const [index, entry] of fits.entries()) {
      if (index % 100 === 0) onProgress({ message: `Reading routes ${label} (${index + 1}/${fits.length}) · ${routes.length} routes found…` });
      stats.scanned++;
      try {
        const decoded = decodeFit(await readZipEntry(archive, entry));
        if (decoded.fileType !== 4) continue;
        stats.activityFiles++;
        if (decoded.records.length < 2) { stats.withoutGps++; continue; }
        const result = routesFromFit(decoded, activities, entry.name.split('/').pop().replace(/^.*_/, ''));
        routes = mergeRoutes(routes, result.routes);
        stats.unmatched += result.unmatched;
      } catch { stats.failed++; }
    }
  }
  await readRecordings(blob, entries, '');
  for (const [index, entry] of archives.entries()) {
    onProgress({ message: `Opening recording archive ${index + 1}/${archives.length}…` });
    const archive = new Blob([await readZipEntry(blob, entry, 256 * 1024 * 1024)]);
    await readRecordings(archive, await readZipDirectory(archive), `${index + 1}/${archives.length}`);
  }
  return { routes, routeStats: stats };
}
