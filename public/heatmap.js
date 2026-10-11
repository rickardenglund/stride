import { normalizeActivityType } from "./activities.js";
import { routeMatchesActivity } from "./routes.js";
import { projectMapRoutes, mercatorLatitude } from "./maps.js";

// Count each route once per cell, independent of GPS sampling density.
export function buildRunHeatmap(routes, viewport = null) {
  const width = viewport?.width || 800, height = viewport?.height || 400, cellSize = 5, padding = 20;
  const validRoutes = routes.map(route => route.points.filter(point =>
    Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lon) && Math.abs(point.lon) <= 180,
  )).filter(points => points.length >= 2);
  if (!validRoutes.length) return { cells: [], routeCount: 0, maxCount: 0, width, height, cellSize };
  const { bounds, coordinates } = viewport
    ? projectViewport(validRoutes, viewport)
    : projectMapRoutes(validRoutes, width, height, padding);
  let routeCount = 0;
  const counts = new Map();
  for (const points of coordinates) {
    const visited = new Set();
    const pixels = points.map(point => ({ x: point.routeX, y: point.routeY }));
    for (let i = 1; i < pixels.length; i++) {
      const clipped = clipSegment(pixels[i - 1], pixels[i], width, height);
      if (!clipped) continue;
      const [a, b] = clipped;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / (cellSize / 2)));
      for (let step = 0; step <= steps; step++) {
        const x = Math.floor(Math.max(0, Math.min(width - 1e-7, a.x + (b.x - a.x) * step / steps)) / cellSize);
        const y = Math.floor(Math.max(0, Math.min(height - 1e-7, a.y + (b.y - a.y) * step / steps)) / cellSize);
        visited.add(`${x},${y}`);
      }
    }
    if (visited.size) routeCount++;
    for (const key of visited) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const cells = [...counts].map(([key, count]) => {
    const [x, y] = key.split(',').map(Number);
    return { x: x * cellSize, y: y * cellSize, count };
  });
  return { cells, bounds, routeCount, maxCount: cells.reduce((max, cell) => Math.max(max, cell.count), 0), width, height, cellSize };
}

export function renderRunHeatmap(model) {
  const colors = ['#7f1d1d', '#b93838', '#ef4444', '#fb923c', '#fde047'];
  return `<svg viewBox="0 0 ${model.width} ${model.height}" role="img" aria-label="Activity route heatmap: ${model.routeCount} activities, up to ${model.maxCount} activities per area. North is up.">${model.cells.map(cell => {
    const intensity = model.maxCount <= 1 ? 0 : (cell.count - 1) / (model.maxCount - 1);
    const color = colors[Math.round(intensity * (colors.length - 1))];
    return `<rect x="${cell.x}" y="${cell.y}" width="${model.cellSize}" height="${model.cellSize}" fill="${color}"><title>${cell.count} ${cell.count === 1 ? 'activity' : 'activities'}</title></rect>`;
  }).join('')}</svg>`;
}

function projectViewport(routes, { bounds, width, height }) {
  const [[south, west], [north, east]] = bounds;
  const top = mercatorLatitude(north), bottom = mercatorLatitude(south);
  const center = (west + east) / 2;
  return { bounds, coordinates: routes.map(points => {
    let previousLongitude = center;
    const projected = points.map(point => {
      const lon = point.lon + 360 * Math.round((previousLongitude - point.lon) / 360);
      previousLongitude = lon;
      return { lon, lat: point.lat };
    });
    const shift = 360 * Math.round((center - (Math.min(...projected.map(p => p.lon)) + Math.max(...projected.map(p => p.lon))) / 2) / 360);
    return projected.map(point => ({ routeX: (point.lon + shift - west) / (east - west) * width,
      routeY: (top - mercatorLatitude(point.lat)) / (top - bottom) * height }));
  }) };
}

// Clip before sampling: zoomed-outside segments must not generate millions of cells.
function clipSegment(a, b, width, height) {
  let start = 0, end = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x, width - 1e-7 - a.x, a.y, height - 1e-7 - a.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) start = Math.max(start, t); else end = Math.min(end, t);
    if (start > end) return null;
  }
  return [{ x: a.x + start * dx, y: a.y + start * dy },
    { x: a.x + end * dx, y: a.y + end * dy }];
}

// Resolve types from activity records: route categories combine several distinct sports.
export function groupHeatmapRoutes(routes, activities) {
  const groups = new Map();
  const activityRoutes = new Map();
  for (const route of routes) {
    const matches = activities.filter(activity => routeMatchesActivity(route, activity, activities));
    if (matches.length !== 1) continue;
    activityRoutes.set(matches[0], route);
  }
  for (const [activity, route] of activityRoutes) {
    const type = normalizeActivityType(activity.type);
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(route);
  }
  return groups;
}
