import { normalizeActivityType } from './activities.js';
import { HEATMAP_TYPE_GROUPS } from './heatmap-filter.js';

export function groupActivitiesByWeekday(activities) {
  const types = new Map();
  const all = Array(7).fill(0);
  for (const activity of activities) {
    const [year, month, day] = activity.date.split('-').map(Number);
    const weekday = (new Date(year, month - 1, day).getDay() + 6) % 7;
    const type = normalizeActivityType(activity.type);
    if (!types.has(type)) types.set(type, Array(7).fill(0));
    types.get(type)[weekday]++;
    all[weekday]++;
  }
  const groups = HEATMAP_TYPE_GROUPS.map(group => {
    const counts = Array(7).fill(0);
    for (const [type, weekdays] of types) {
      if (group.matches(type)) weekdays.forEach((count, day) => { counts[day] += count; });
    }
    return { label: group.label, counts };
  });
  const total = counts => counts.reduce((sum, count) => sum + count, 0);
  groups.sort((left, right) => total(right.counts) - total(left.counts) || left.label.localeCompare(right.label));
  const sortedTypes = [...types].sort(([left, leftCounts], [right, rightCounts]) =>
    total(rightCounts) - total(leftCounts) || left.localeCompare(right));
  return { all, groups, types: sortedTypes };
}
