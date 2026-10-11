import { chartDataRange, chartLabelIndices } from "./chart-range.js";
import { dateKey } from './training.js';

const number = (value, max = Infinity) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
const oxygen = value => number(value, 100) > 0 ? value : null;
const timestamp = value => {
  if (typeof value !== 'string') return null;
  const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

export function parseGarminSleep(data) {
  if (!Array.isArray(data)) throw new Error('Unrecognized Garmin sleep format.');
  return data.flatMap(raw => {
    const date = raw?.calendarDate;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return [];
    const start = timestamp(raw.sleepStartTimestampGMT), end = timestamp(raw.sleepEndTimestampGMT);
    if (!start || !end || end <= start || Date.parse(end) - Date.parse(start) > 48 * 3600000) return [];
    const deep = number(raw.deepSleepSeconds, 172800), light = number(raw.lightSleepSeconds, 172800), rem = number(raw.remSleepSeconds, 172800);
    return [{ date, start, end, deep, light, rem, awake: number(raw.awakeSleepSeconds, 172800),
      duration: deep !== null && light !== null ? deep + light + (rem ?? 0) : null,
      averageSpo2: oxygen(raw.spo2SleepSummary?.averageSPO2), lowestSpo2: oxygen(raw.spo2SleepSummary?.lowestSPO2),
      score: number(raw.sleepScores?.overallScore, 100), respiration: number(raw.averageRespiration, 100),
      measurementStart: timestamp(raw.spo2SleepSummary?.sleepMeasurementStartGMT), measurementEnd: timestamp(raw.spo2SleepSummary?.sleepMeasurementEndGMT),
    }];
  });
}

export function mergeSleep(existing, incoming) {
  const nights = new Map(existing.map(night => [night.date, night]));
  for (const night of incoming) {
    const previous = nights.get(night.date) || {};
    nights.set(night.date, { ...previous, ...Object.fromEntries(Object.entries(night).filter(([key, value]) => value !== null || previous[key] == null)) });
  }
  return [...nights.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function sleepInPeriod(nights, period, today = new Date()) {
  const start = new Date(today);
  start.setDate(start.getDate() - Number(period) + 1);
  return nights.filter(night => period === 'all' || (night.date >= dateKey(start) && night.date <= dateKey(today)));
}

const duration = seconds => seconds === null ? '—' : `${Math.floor(Math.round(seconds / 60) / 60)}h ${Math.round(seconds / 60) % 60}m`;
const percent = value => value === null ? '—' : `${value.toFixed(1)}%`;
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function oxygenChart(nights) {
  if (!nights.some(night => night.averageSpo2 !== null || night.lowestSpo2 !== null)) return '<p class="empty-message">No overnight SpO₂ measurements in this period.</p>';
  const width = Math.max(700, nights.length * 6), height = 230;
  const min = Math.max(0, Math.floor(Math.min(...nights.flatMap(n => [n.averageSpo2, n.lowestSpo2]).filter(v => v !== null)) / 5) * 5 - 5);
  const x = night => 8 + (Date.parse(night.date) - Date.parse(nights[0].date)) / Math.max(86400000, Date.parse(nights.at(-1).date) - Date.parse(nights[0].date)) * (width - 80);
  const y = value => 190 - (value - min) / (100 - min) * 160;
  let svg = `<svg class="sleep-plot" viewBox="0 0 ${width - 48} ${height}" style="width:${width - 48}px" tabindex="0" role="group" aria-describedby="sleep-chart-help" aria-label="Nightly average and lowest oxygen saturation, ${min} to 100 percent">`;
  let axis = `<svg class="sleep-y-axis" width="48" height="${height}" viewBox="0 0 48 ${height}" aria-hidden="true">`;
  for (let tick = min; tick <= 100; tick += 5) {
    svg += `<line x1="0" x2="${width - 72}" y1="${y(tick)}" y2="${y(tick)}" stroke="currentColor" opacity=".12"/>`;
    axis += `<text x="40" y="${y(tick) + 4}" text-anchor="end">${tick}%</text>`;
  }
  axis += '</svg>';
  for (const [key, color, label] of [['averageSpo2', '#358a80', 'Average'], ['lowestSpo2', '#a16bbc', 'Lowest']]) {
    let previous = null;
    for (const [index, night] of nights.entries()) {
      if (night[key] === null) { previous = null; continue; }
      if (previous && Date.parse(night.date) - Date.parse(previous.date) <= 86400000) svg += `<line x1="${x(previous)}" y1="${y(previous[key])}" x2="${x(night)}" y2="${y(night[key])}" stroke="${color}"/>`;
      svg += `<circle data-night="${index}" cx="${x(night)}" cy="${y(night[key])}" r="3" fill="${color}"><title>${night.date} · ${label}: ${percent(night[key])}</title></circle>`;
      previous = night;
    }
  }
  const startTime = Date.parse(nights[0].date);
  const daySpan = Math.round((Date.parse(nights.at(-1).date) - startTime) / 86400000);
  const labels = chartLabelIndices(daySpan + 1, (width - 80) / Math.max(1, daySpan), 110).map(day => {
    const date = new Date(startTime + day * 86400000).toISOString().slice(0, 10);
    const anchor = day === 0 ? 'start' : day === daySpan ? 'end' : 'middle';
    return `<text x="${8 + day / Math.max(1, daySpan) * (width - 80)}" y="220" text-anchor="${anchor}">${date}</text>`;
  }).join('');
  return `${axis}<div class="sleep-plot-scroll">${svg}<line class="sleep-hover-line" y1="30" y2="190" visibility="hidden" stroke="currentColor" stroke-dasharray="3 3" pointer-events="none"/>${labels}</svg></div>`;
}

let chartEvents;

export function attachSleepChart(element, nights) {
  const chart = element.querySelector('.sleep-chart');
  const svg = chart?.querySelector('.sleep-plot');
  if (!svg) return;
  const tooltip = element.querySelector('.sleep-tooltip');
  const marker = svg.querySelector('.sleep-hover-line');
  const circles = [...svg.querySelectorAll('[data-night]')];
  const points = [...new Map(circles.map(circle => [Number(circle.dataset.night), {
    index: Number(circle.dataset.night), x: Number(circle.getAttribute('cx')),
  }])).values()].sort((a, b) => a.x - b.x);
  let active = -1;
  const hide = () => {
    tooltip.hidden = true;
    marker.setAttribute('visibility', 'hidden');
    circles.forEach(circle => circle.setAttribute('r', '3'));
  };
  const show = (position, clientX, clientY) => {
    active = position;
    const point = points[position], night = nights[point.index];
    const exact = value => value === null ? 'Unavailable' : `${value}%`;
    tooltip.children[0].textContent = night.date;
    tooltip.children[1].children[1].textContent = exact(night.averageSpo2);
    tooltip.children[2].children[1].textContent = exact(night.lowestSpo2);
    tooltip.hidden = false;
    const bounds = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - bounds.width - 8, clientX - bounds.width / 2))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - bounds.height - 8, clientY - bounds.height - 16))}px`;
    marker.setAttribute('x1', point.x);
    marker.setAttribute('x2', point.x);
    marker.setAttribute('visibility', 'visible');
    circles.forEach(circle => circle.setAttribute('r', Number(circle.dataset.night) === point.index ? '5' : '3'));
  };
  const inspect = event => {
    if (event.target?.closest && event.target.closest('svg') !== svg) { hide(); return; }
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width) return;
    const x = (event.clientX - bounds.left) / bounds.width * svg.viewBox.baseVal.width;
    let nearest = 0;
    points.forEach((point, index) => {
      if (Math.abs(point.x - x) < Math.abs(points[nearest].x - x)) nearest = index;
    });
    show(nearest, event.clientX, event.clientY);
  };
  chart.addEventListener('pointermove', event => { if (event.pointerType !== 'touch') inspect(event); });
  // A scrolling gesture cancels its pointer, so only a completed tap selects a night.
  chart.addEventListener('pointerup', event => { if (event.pointerType === 'touch') inspect(event); });
  chart.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') hide(); });
  chart.addEventListener('pointercancel', hide);
  chart.addEventListener('scroll', hide, { capture: true, passive: true });
  svg.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') hide(); });
  svg.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hide(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const position = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1
      : Math.max(0, Math.min(points.length - 1, active < 0 ? 0 : active + (event.key === 'ArrowLeft' ? -1 : 1)));
    const pointCircle = circles.find(circle => Number(circle.dataset.night) === points[position].index);
    pointCircle.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const bounds = pointCircle.getBoundingClientRect();
    show(position, bounds.left + bounds.width / 2, bounds.top);
  });
  svg.addEventListener('blur', hide);
  chartEvents = new AbortController();
  document.addEventListener('pointerdown', event => { if (!chart.contains(event.target)) hide(); }, { signal: chartEvents.signal });
  document.addEventListener('scroll', event => { if (event.target !== chart) hide(); }, { capture: true, signal: chartEvents.signal });
}

export function renderSleep(element, nights, period, page = 0) {
  chartEvents?.abort();
  const selected = sleepInPeriod(nights, period);
  if (!nights.length) { element.innerHTML = '<article class="chart-card"><h2>Explore your sleep</h2><p>Import or reimport your complete Garmin ZIP to add sleep history and overnight SpO₂. Activity CSV files do not include sleep.</p></article>'; return; }
  const range = chartDataRange(selected, night => night.averageSpo2 !== null || night.lowestSpo2 !== null);
  const chartNights = selected.slice(range.start, range.end);
  const oxygenNights = selected.filter(n => n.averageSpo2 !== null);
  const durations = selected.map(n => n.duration).filter(v => v !== null);
  const pages = Math.max(1, Math.ceil(selected.length / 25));
  page = Math.min(page, pages - 1);
  const rows = [...selected].reverse().slice(page * 25, (page + 1) * 25);
  element.innerHTML = `<dl class="summary-grid" aria-label="Sleep summary"><div><dt>Average overnight SpO₂</dt><dd>${percent(average(oxygenNights.map(n => n.averageSpo2)))}</dd></div><div><dt>Average sleep duration</dt><dd>${duration(average(durations))}</dd></div><div><dt>SpO₂ coverage</dt><dd>${oxygenNights.length}<span class="stat-note">of ${selected.length} imported nights have an average</span></dd></div></dl>
  <article class="chart-card"><h2>Overnight SpO₂</h2><p><span class="sleep-average">● Average</span> · <span class="sleep-lowest">● Lowest</span></p><p id="sleep-chart-help">Hover or tap the chart for exact values. Use the arrow keys when the chart is focused.</p><p>Each point summarizes a night, rather than readings during the night. Missing measurements create gaps.</p><div class="sleep-chart">${oxygenChart(chartNights)}</div><div class="sleep-tooltip" role="status" aria-live="polite" hidden><strong class="sleep-tooltip-date"></strong><div class="sleep-tooltip-metric"><span>Average SpO₂</span><strong class="sleep-tooltip-value"></strong></div><div class="sleep-tooltip-metric"><span>Lowest SpO₂</span><strong class="sleep-tooltip-value"></strong></div></div></article>
  <section class="runs-card"><div class="runs-heading"><div><h2>Your nights</h2><p>${selected.length} nights · Dates refer to the morning you woke up. — means unavailable.</p></div></div><div class="runs-table-wrap"><table class="sleep-table"><thead><tr>${['Date', 'Avg SpO₂', 'Lowest SpO₂', 'Sleep', 'Deep', 'Light', 'REM', 'Awake', 'Score', 'Breaths/min'].map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(n => `<tr><th scope="row">${n.date}</th><td>${percent(n.averageSpo2)}</td><td>${percent(n.lowestSpo2)}</td>${[n.duration, n.deep, n.light, n.rem, n.awake].map(v => `<td>${duration(v)}</td>`).join('')}<td>${n.score ?? '—'}</td><td>${n.respiration?.toFixed(1) ?? '—'}</td></tr>`).join('') || '<tr><td colspan="10">No sleep records in this period. Try All imported.</td></tr>'}</tbody></table></div><nav class="sleep-pagination" aria-label="Sleep pagination"><button type="button" data-sleep-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>Previous</button><span>Page ${page + 1} of ${pages}</span><button type="button" data-sleep-page="${page + 1}" ${page + 1 >= pages ? 'disabled' : ''}>Next</button></nav></section>`;
  if (element.querySelector) {
    attachSleepChart(element, chartNights);
    const scroll = element.querySelector('.sleep-plot-scroll');
    if (scroll) scroll.scrollLeft = scroll.scrollWidth;
  }
}
