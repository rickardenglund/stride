// Keep missing samples between observations, but omit empty edges.
export function chartDataRange(samples, hasData) {
  const start = samples.findIndex(hasData);
  if (start < 0) return { start: 0, end: 0 };
  let end = samples.length;
  while (end > start && !hasData(samples[end - 1], end - 1)) end--;
  return { start, end };
}

// Label density follows pixel spacing, not the total number of observations.
export function chartLabelIndices(count, pixelStep, minimumGap = 100) {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const step = Math.max(1, Math.ceil(minimumGap / Math.max(pixelStep, .001)));
  const indices = [];
  for (let index = 0; index < count; index += step) indices.push(index);
  const last = count - 1;
  if (indices.at(-1) !== last) {
    if (indices.length > 1 && (last - indices.at(-1)) * pixelStep < minimumGap) indices.pop();
    indices.push(last);
  }
  return indices;
}
