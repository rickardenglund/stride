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
  return { all, groups: groups.filter(group => total(group.counts) > 0), types: sortedTypes };
}


export function renderWeekdayBars(grouped) {
  const total = counts => counts.reduce((sum, count) => sum + count, 0);
  if (!total(grouped.all)) return '<p class="weekday-empty">No activities in this period.</p>';
  const escape = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const chart = (label, counts) => {
    const maximum = Math.max(1, ...counts);
    const bars = counts.map((count, day) => {
      const x = 30 + day * 40, height = count / maximum * 100;
      return `<rect class="weekday-bar" x="${x}" y="${130 - height}" width="26" height="${height}" rx="3" tabindex="0" data-label="${escape(label)}" data-weekday="${weekdays[day]}" data-count="${count}" aria-label="${escape(label)} on ${weekdays[day]}: ${count} activities"/><text x="${x + 13}" y="${122 - height}" text-anchor="middle">${count}</text><text x="${x + 13}" y="151" text-anchor="middle">${weekdays[day]}</text>`;
    }).join('');
    return `<article class="weekday-bar-card"><h4>${escape(label)} <span>${total(counts)} activities</span></h4><svg viewBox="0 0 320 165" role="group" aria-label="${escape(label)} activity counts by weekday"><line x1="24" x2="302" y1="130" y2="130" class="weekday-bar-baseline"/>${bars}</svg></article>`;
  };
  return `<p class="weekday-bar-help">Hover or tap a bar for details. Each chart uses its own scale; values are activity counts.</p><h3 class="weekday-bar-section">All activities and groups</h3><div class="weekday-bar-grid">${chart('All activities', grouped.all)}${grouped.groups.map(group => chart(group.label, group.counts)).join('')}</div><h3 class="weekday-bar-section">Individual types</h3><div class="weekday-bar-grid">${grouped.types.map(([type, counts]) => chart(type.replace(/\b[a-z]/g, character => character.toUpperCase()), counts)).join('')}</div>`;
}
