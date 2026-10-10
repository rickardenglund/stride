import { projectMapRoutes } from "./maps.js";

// Count each route once per cell, independent of GPS sampling density.
export function buildRunHeatmap(routes) {
  const width = 800, height = 400, cellSize = 5, padding = 20;
  const validRoutes = routes.map(route => route.points.filter(point =>
    Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lon) && Math.abs(point.lon) <= 180,
  )).filter(points => points.length >= 2);
  if (!validRoutes.length) return { cells: [], routeCount: 0, maxCount: 0, width, height, cellSize };
  const { bounds, coordinates } = projectMapRoutes(validRoutes, width, height, padding);
  const counts = new Map();
  for (const points of coordinates) {
    const visited = new Set();
    const pixels = points.map(point => ({ x: point.routeX, y: point.routeY }));
    for (let i = 1; i < pixels.length; i++) {
      const a = pixels[i - 1], b = pixels[i];
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / (cellSize / 2)));
      for (let step = 0; step <= steps; step++) {
        const x = Math.floor((a.x + (b.x - a.x) * step / steps) / cellSize);
        const y = Math.floor((a.y + (b.y - a.y) * step / steps) / cellSize);
        visited.add(`${x},${y}`);
      }
    }
    for (const key of visited) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const cells = [...counts].map(([key, count]) => {
    const [x, y] = key.split(',').map(Number);
    return { x: x * cellSize, y: y * cellSize, count };
  });
  return { cells, bounds, routeCount: validRoutes.length, maxCount: Math.max(...counts.values()), width, height, cellSize };
}

export function renderRunHeatmap(model) {
  const colors = ['#7f1d1d', '#b93838', '#ef4444', '#fb923c', '#fde047'];
  return `<svg viewBox="0 0 ${model.width} ${model.height}" role="img" aria-label="Running route heatmap: ${model.routeCount} runs, up to ${model.maxCount} runs per area. North is up.">${model.cells.map(cell => {
    const intensity = model.maxCount <= 1 ? 0 : (cell.count - 1) / (model.maxCount - 1);
    const color = colors[Math.round(intensity * (colors.length - 1))];
    return `<rect x="${cell.x}" y="${cell.y}" width="${model.cellSize}" height="${model.cellSize}" fill="${color}"><title>${cell.count} ${cell.count === 1 ? 'run' : 'runs'}</title></rect>`;
  }).join('')}</svg>`;
}
