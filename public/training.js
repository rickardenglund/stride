export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function summarizeTraining(runs, activities, { month = null, period = "90", today = new Date() } = {}) {
  const start = new Date(today);
  if (period !== "all") start.setDate(start.getDate() - Number(period) + 1);
  const startKey = dateKey(start);
  const endKey = dateKey(today);
  const monthKey = month ? dateKey(month).slice(0, 7) : null;
  const inPeriod = ({ date }) => monthKey
    ? date.startsWith(`${monthKey}-`)
    : period === "all" || (date >= startKey && date <= endKey);
  const periodRuns = runs.filter(inPeriod);
  return {
    distanceKm: periodRuns.reduce((sum, run) => sum + run.distance, 0) / 1000,
    runCount: periodRuns.length,
    activeDays: new Set(activities.filter(inPeriod).map(({ date }) => date)).size,
  };
}

export function distanceScale(daily, averages, totals, includeTotals = false) {
  const maxValue = Math.max(5, ...daily, ...averages, ...(includeTotals ? totals : []));
  const tickStep = Math.max(1, Math.ceil(maxValue / 5));
  return { tickStep, maxY: Math.ceil(maxValue / tickStep) * tickStep };
}
