import { normalizeStoredRuns, parseGarminCsv } from "./csv.js";

const dashboard = document.querySelector("#dashboard");
const dashboardNav = document.querySelector("#dashboard-nav");
const connectState = document.querySelector("#connect-state");
const notice = document.querySelector("#notice");
const dashboardPeriod = document.querySelector("#dashboard-period");
const dashboardPeriodControl = document.querySelector("#dashboard-period-control");
const rollingPeriod = document.querySelector("#rolling-period");
const connectionLabel = document.querySelector("#connection-label");
const statusDot = document.querySelector(".status-dot");
const csvInput = document.querySelector("#csv-input");
const calendarDays = document.querySelector("#calendar-days");
const calendarLegend = document.querySelector("#calendar-legend");
const calendarPrev = document.querySelector("#calendar-prev");
const calendarNext = document.querySelector("#calendar-next");
const runsList = document.querySelector("#runs-list");
const runsSummary = document.querySelector("#runs-summary");
const weekdayFrequency = document.querySelector("#weekday-frequency");
const activityFrequencyChart = document.querySelector("#activity-frequency-chart");
const runningLoadLatest = document.querySelector("#running-load-latest");
const activityTimelineLatest = document.querySelector("#activity-timeline-latest");
const runDetailDialog = document.querySelector("#run-detail-dialog");
const runDetailTitle = document.querySelector("#run-detail-title");
const runDetailDate = document.querySelector("#run-detail-date");
const runDetailList = document.querySelector("#run-detail-list");
const runDetailClose = document.querySelector("#run-detail-close");
const chart = document.querySelector("#chart");
const importButtons = [document.querySelector("#import-button"), document.querySelector("#import-cta")];
let importedRuns = [];
let importedActivities = [];
let importedFileName = "";
let calendarMonth = null;
let visibleRuns = [];

const activityCategories = {
  running: { label: "Running", color: "#1d4f7a", background: "#dfeef8", stripe: "#244760" },
  trail: { label: "Trail running", color: "#8b5a39", background: "#f3e5d9", stripe: "#5a4635" },
  cycling: { label: "Cycling", color: "#2c7bb8", background: "#dfe9f7", stripe: "#214b44" },
  walking: { label: "Walking & hiking", color: "#3a5d8b", background: "#e7edf9", stripe: "#41395a" },
  swimming: { label: "Swimming", color: "#0d5c73", background: "#dff4fb", stripe: "#224956" },
  strength: { label: "Strength", color: "#865528", background: "#f5e7da", stripe: "#573b3b" },
  climbing: { label: "Climbing", color: "#4f3d7d", background: "#efeafb", stripe: "#5a512f" },
  yoga: { label: "Yoga", color: "#2d5e71", background: "#e9f3f7", stripe: "#57394f" },
  other: { label: "Other", color: "#303a34", background: "#eef2f4", stripe: "#46515c" },
};

function categoryForActivity(type) {
  const normalized = type.toLowerCase();
  if (/trail/.test(normalized)) return "trail";
  if (/run|running/.test(normalized)) return "running";
  if (/cycl|bike|biking/.test(normalized)) return "cycling";
  if (/walk|hike/.test(normalized)) return "walking";
  if (/swim/.test(normalized)) return "swimming";
  if (/yoga/.test(normalized)) return "yoga";
  if (/climb|boulder/.test(normalized)) return "climbing";
  if (/strength|weight|workout|cardio/.test(normalized)) return "strength";
  return "other";
}

function formatDistance(distance, fractionDigits = 1) {
  return distance.toLocaleString(undefined, { maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits });
}

function formatDate(date, options) {
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function getISOWeekNumber(date) {
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7));
  return 1 + Math.round((thursday - firstThursday) / 604_800_000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatPace(secondsPerKm) {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return "—";
  const rounded = Math.round(secondsPerKm);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")} /km`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function showError(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function makeChart(daily, dates, rollingAverage, rollingTotals, averageDays, totalDays) {
  const width = Math.max(800, dates.length * 10);
  const height = 260;
  const left = 43;
  const right = 12;
  const top = 12;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(5, ...daily, ...rollingAverage, ...rollingTotals);
  const maxY = Math.ceil(maxValue / 5) * 5;
  const x = (index) => left + (index / Math.max(1, dates.length - 1)) * plotWidth;
  const y = (value) => top + plotHeight - (value / maxY) * plotHeight;
  const barWidth = Math.max(2, Math.min(7, (plotWidth / dates.length) * 0.55));
  const grid = [];
  const yAxisLabels = [];

  for (let value = 0; value <= maxY; value += maxY <= 10 ? 2 : 5) {
    const position = y(value);
    grid.push(`<line class="grid-line" x1="${left}" y1="${position}" x2="${width - right}" y2="${position}"></line>`);
    yAxisLabels.push(`<text class="axis-label" x="${left - 10}" y="${position + 3}" text-anchor="end">${value}</text>`);
  }
  const bars = daily.map((value, index) => {
    const barHeight = (value / maxY) * plotHeight;
    const barX = x(index) - barWidth / 2;
    return `<rect class="daily-bar" x="${barX}" y="${y(value)}" width="${barWidth}" height="${barHeight}" rx="2"><title>${formatDate(dates[index], { month: "short", day: "numeric" })}: ${formatDistance(value)} km</title></rect>`;
  }).join("");

  const linePoints = rollingAverage.map((value, index) => `${x(index)},${y(value)}`);
  const linePath = linePoints.map((point, index) => `${index === 0 ? "M" : "L"}${point}`).join(" ");
  const totalPoints = rollingTotals.map((value, index) => `${x(index)},${y(value)}`);
  const totalPath = totalPoints.map((point, index) => `${index === 0 ? "M" : "L"}${point}`).join(" ");
  const areaPath = `${linePath} L${x(dates.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const labelStep = Math.max(1, Math.ceil(80 * (dates.length - 1) / plotWidth));
  const labels = dates.map((date, index) => {
    if (index % labelStep !== 0 && index !== dates.length - 1) return "";
    const label = formatDate(date, { month: "short", day: "numeric" });
    return `<text class="axis-label" x="${x(index)}" y="${height - 9}" text-anchor="middle">${label}</text>`;
  }).join("");
  const points = rollingAverage.map((value, index) => {
    const windowStart = Math.max(0, index - averageDays + 1);
    const startDate = formatDate(dates[windowStart], { month: "short", day: "numeric" });
    const endDate = formatDate(dates[index], { month: "short", day: "numeric" });
    const tooltip = `${averageDays}-day rolling average: ${formatDistance(value)} km/day, window: ${startDate}–${endDate}`;
    return `<circle class="avg-point" cx="${x(index)}" cy="${y(value)}" r="5" tabindex="0" data-kind="average" data-window-days="${averageDays}" data-average="${formatDistance(value)}" data-window="${startDate}–${endDate}" aria-label="${tooltip}"></circle>`;
  }).join("");
  const totalMarkers = rollingTotals.map((value, index) =>
    `<circle class="sum-point" cx="${x(index)}" cy="${y(value)}" r="4" tabindex="0" data-kind="total" data-window-days="${totalDays}" data-average="${formatDistance(rollingAverage[index])}" data-distance="${formatDistance(value)}" data-window="${formatDate(dates[Math.max(0, index - totalDays + 1)], { month: "short", day: "numeric" })}–${formatDate(dates[index], { month: "short", day: "numeric" })}" aria-label="${totalDays}-day total: ${formatDistance(value)} km"></circle>`,
  ).join("");

  return `<svg class="running-load-y-axis" width="${left}" height="${height}" viewBox="0 0 ${left} ${height}" aria-hidden="true">
    ${yAxisLabels.join("")}
  </svg>
  <div class="running-load-plot-scroll">
    <svg width="${width - left}" height="${height}" viewBox="0 0 ${width - left} ${height}" role="img" aria-label="Daily running distance bars, ${averageDays}-day rolling average line, and ${totalDays}-day rolling total line. All use the same vertical scale in kilometers">
      <g transform="translate(${-left} 0)">
        ${grid.join("")}
        <path class="avg-area" d="${areaPath}"></path>
        ${bars}
        <path class="avg-path" d="${linePath}"></path>
        <path class="sum-path" d="${totalPath}"></path>
        ${points}
        ${totalMarkers}
        ${labels}
      </g>
    </svg>
  </div>`;
}

function createChartTooltip() {
  const tooltip = document.createElement("div");
  tooltip.className = "calendar-tooltip chart-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.innerHTML = "<strong></strong><span></span><span></span><span></span>";
  document.body.append(tooltip);
  return tooltip;
}

const chartTooltip = createChartTooltip();

function showChartTooltip(point, clientX, clientY) {
  const windowDays = Number(point.dataset.windowDays);
  chartTooltip.children[0].textContent = `${windowDays}-day rolling ${point.dataset.kind}`;
  chartTooltip.children[1].textContent = point.dataset.kind === "average"
    ? `Average distance: ${point.dataset.average} km/day`
    : `Total distance: ${point.dataset.distance} km`;
  chartTooltip.children[2].textContent = `Window: ${point.dataset.window}`;
  chartTooltip.children[3].textContent = `Window length: ${windowDays} days`;
  positionChartTooltip(clientX, clientY);
}

function positionChartTooltip(clientX, clientY) {
  chartTooltip.style.left = `${clientX}px`;
  chartTooltip.style.top = `${clientY - 12}px`;
  chartTooltip.classList.add("visible");
  chartTooltip.setAttribute("aria-hidden", "false");

  const bounds = chartTooltip.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(
    window.innerWidth - bounds.width / 2 - margin,
    Math.max(bounds.width / 2 + margin, clientX),
  );
  const top = clientY - bounds.height - 14 >= margin
    ? clientY - bounds.height - 14
    : Math.min(window.innerHeight - bounds.height - margin, clientY + 14);
  chartTooltip.style.left = `${left}px`;
  chartTooltip.style.top = `${top}px`;
}

function showFrequencyTooltip(bar, clientX, clientY) {
  chartTooltip.children[0].textContent = bar.dataset.dateRange;
  chartTooltip.children[1].textContent = `${bar.dataset.count} ${bar.dataset.count === "1" ? "activity" : "activities"}`;
  chartTooltip.children[2].textContent = `Grouped by ${bar.dataset.interval}`;
  chartTooltip.children[3].textContent = "All activity types";
  positionChartTooltip(clientX, clientY);
}

function hideChartTooltip() {
  chartTooltip.classList.remove("visible");
  chartTooltip.setAttribute("aria-hidden", "true");
}

function scrollChartToLatest(scrollContainer) {
  const chartScroll = scrollContainer.querySelector(":scope > .running-load-plot-scroll, :scope > .frequency-chart-scroll");
  if (chartScroll) chartScroll.scrollTo({ left: chartScroll.scrollWidth, behavior: "smooth" });
}

runningLoadLatest.addEventListener("click", () => scrollChartToLatest(chart));
activityTimelineLatest.addEventListener("click", () => scrollChartToLatest(activityFrequencyChart));

function updateLatestButton(chartScroll, button) {
  const isAtLatest = chartScroll.scrollLeft + chartScroll.clientWidth >= chartScroll.scrollWidth - 2;
  button.hidden = isAtLatest;
}

function monitorChartScroll(scrollContainer, button) {
  const chartScroll = scrollContainer.querySelector(":scope > .running-load-plot-scroll, :scope > .frequency-chart-scroll");
  if (!chartScroll) {
    button.hidden = true;
    return;
  }
  const updateButton = () => updateLatestButton(chartScroll, button);
  chartScroll.addEventListener("scroll", updateButton, { passive: true });
  updateButton();
}

function refreshChartLatestButton(scrollContainer, button) {
  const chartScroll = scrollContainer.querySelector(":scope > .running-load-plot-scroll, :scope > .frequency-chart-scroll");
  if (chartScroll) updateLatestButton(chartScroll, button);
}

chart.addEventListener("pointerover", (event) => {
  const point = event.target.closest(".avg-point, .sum-point");
  if (point) showChartTooltip(point, event.clientX, event.clientY);
});
chart.addEventListener("pointermove", (event) => {
  const point = event.target.closest(".avg-point, .sum-point");
  if (point) showChartTooltip(point, event.clientX, event.clientY);
});
chart.addEventListener("pointerout", (event) => {
  if (event.target.closest(".avg-point, .sum-point") && !event.relatedTarget?.closest?.(".avg-point, .sum-point")) {
    hideChartTooltip();
  }
});
chart.addEventListener("focusin", (event) => {
  const point = event.target.closest(".avg-point, .sum-point");
  if (point) {
    const bounds = point.getBoundingClientRect();
    showChartTooltip(point, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  }
});
chart.addEventListener("focusout", (event) => {
  if (event.target.closest(".avg-point, .sum-point")) hideChartTooltip();
});

activityFrequencyChart.addEventListener("pointerover", (event) => {
  const bar = event.target.closest(".frequency-bar");
  if (bar) showFrequencyTooltip(bar, event.clientX, event.clientY);
});
activityFrequencyChart.addEventListener("pointermove", (event) => {
  const bar = event.target.closest(".frequency-bar");
  if (bar) showFrequencyTooltip(bar, event.clientX, event.clientY);
});
activityFrequencyChart.addEventListener("pointerout", (event) => {
  if (event.target.closest(".frequency-bar") && !event.relatedTarget?.closest?.(".frequency-bar")) {
    hideChartTooltip();
  }
});
activityFrequencyChart.addEventListener("focusin", (event) => {
  const bar = event.target.closest(".frequency-bar");
  if (bar) {
    const bounds = bar.getBoundingClientRect();
    showFrequencyTooltip(bar, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  }
});
activityFrequencyChart.addEventListener("focusout", (event) => {
  if (event.target.closest(".frequency-bar")) hideChartTooltip();
});

function renderRuns(runs, days) {
  const totals = new Map();
  for (const run of runs) totals.set(run.date, (totals.get(run.date) || 0) + run.distance / 1000);
  renderCalendar(importedActivities, runs);
  renderWeekdayFrequency(importedActivities, dashboardPeriod.value);

  const windowDays = Number(rollingPeriod.value);
  const lookback = windowDays - 1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (days === "all") {
    const earliestRun = runs.reduce((earliest, run) => run.date < earliest ? run.date : earliest, runs[0].date);
    const [year, month, day] = earliestRun.split("-").map(Number);
    const start = new Date(year, month - 1, day);
    days = Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
      - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000) + 1;
  } else {
    days = Number(days);
  }
  const dates = Array.from({ length: days + lookback }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days + lookback - 1) + index);
    return date;
  });
  const daily = dates.map((date) => {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return totals.get(key) || 0;
  });
  const rollingAverage = daily.map((_, index) => {
    const start = Math.max(0, index - windowDays + 1);
    const sample = daily.slice(start, index + 1);
    return sample.reduce((sum, distance) => sum + distance, 0) / windowDays;
  });
  const rollingTotals = daily.map((_, index) => {
    const start = Math.max(0, index - windowDays + 1);
    return daily.slice(start, index + 1).reduce((sum, distance) => sum + distance, 0);
  });
  const visibleDaily = daily.slice(lookback);
  const visibleRolling = rollingAverage.slice(lookback);
  const visibleTotals = rollingTotals.slice(lookback);
  const visibleDates = dates.slice(lookback);
  const timePeriodDescription = dashboardPeriod.value === "all" ? "all imported dates" : `the last ${days} days`;
  const periodRuns = runs
    .filter((run) => run.date >= dateKey(visibleDates[0]) && run.date <= dateKey(visibleDates.at(-1)))
    .sort((left, right) => right.date.localeCompare(left.date));
  const runningLoadChart = document.querySelector("#chart");
  runningLoadChart.innerHTML = makeChart(visibleDaily, visibleDates, visibleRolling, visibleTotals, windowDays, windowDays);
  const chartScroll = runningLoadChart.querySelector(".running-load-plot-scroll");
  chartScroll.scrollLeft = chartScroll.scrollWidth;
  monitorChartScroll(runningLoadChart, runningLoadLatest);
  document.querySelector("#chart").setAttribute("aria-label", `Running distance with ${windowDays}-day rolling average and ${windowDays}-day rolling total for ${timePeriodDescription}`);
  document.querySelector("#average-legend-label").textContent = `${windowDays}-day average`;
  document.querySelector("#total-legend-label").textContent = `${windowDays}-day total`;
  document.querySelector("#chart-range").textContent = `${formatDate(visibleDates[0], { month: "short", day: "numeric" }).toUpperCase()} — ${formatDate(visibleDates.at(-1), { month: "short", day: "numeric" }).toUpperCase()}`;
  renderRunList(periodRuns);
}

function renderWeekdayFrequency(activities, period) {
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const counts = new Map();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = dateKey(today);
  const periodDays = period === "all" ? null : Number(period);
  const start = new Date(today);
  if (periodDays) start.setDate(start.getDate() - periodDays + 1);
  const startKey = dateKey(start);
  const periodActivities = activities.filter(({ date }) =>
    period === "all" || (date >= startKey && date <= todayKey),
  );
  renderActivityTimeline(periodActivities, period, start, today);

  for (const activity of periodActivities) {
    const [year, month, day] = activity.date.split("-").map(Number);
    const weekday = (new Date(year, month - 1, day).getDay() + 6) % 7;
    const category = categoryForActivity(activity.type);
    const categoryCounts = counts.get(category) || Array(weekdays.length).fill(0);
    categoryCounts[weekday] += 1;
    counts.set(category, categoryCounts);
  }

  document.querySelector("#weekday-description").textContent = period === "all"
    ? `Activity counts across all ${periodActivities.length} imported activities, grouped by weekday`
    : `Activity counts for the last ${period} days, grouped by weekday (${periodActivities.length} activities)`;
  if (!counts.size) {
    weekdayFrequency.innerHTML = '<tr><td class="weekday-empty" colspan="8">No activities in this period.</td></tr>';
    return;
  }

  const allCounts = Array(weekdays.length).fill(0);
  for (const categoryCounts of counts.values()) {
    categoryCounts.forEach((count, weekday) => {
      allCounts[weekday] += count;
    });
  }
  const renderRow = (label, rowCounts, category = null) => {
    const maximum = Math.max(...rowCounts);
    const cells = rowCounts.map((count, weekday) => {
      const level = count ? Math.max(1, Math.ceil((count / maximum) * 4)) : 0;
      const accessibleCount = `${label} on ${weekdays[weekday]}: ${count} ${count === 1 ? "activity" : "activities"}`;
      return `<td class="weekday-frequency-cell level-${level}" aria-label="${accessibleCount}" title="${accessibleCount}">${count || "—"}</td>`;
    }).join("");
    const marker = category ? `<i class="calendar-legend-dot marker-${category}" aria-hidden="true"></i>` : "";
    return `<tr${category ? "" : ' class="weekday-total-row"'}><th scope="row"><span class="weekday-activity-name">${marker}${label}</span></th>${cells}</tr>`;
  };

  const rows = [...counts.entries()]
    .map(([category, categoryCounts]) => renderRow(activityCategories[category].label, categoryCounts, category));
  rows.push(renderRow("All activities", allCounts));
  weekdayFrequency.innerHTML = rows.join("");
}

function renderActivityTimeline(activities, period, periodStart, periodEnd) {
  const description = document.querySelector("#frequency-timeline-description");
  if (activities.length === 0) {
    description.textContent = "No activities in this period.";
    activityFrequencyChart.innerHTML = '<p class="weekday-empty">No activities to chart.</p>';
    activityTimelineLatest.hidden = true;
    return;
  }

  const firstActivityDate = new Date(`${activities.reduce((earliest, item) => item.date < earliest ? item.date : earliest, activities[0].date)}T00:00:00`);
  const lastActivityDate = new Date(`${activities.reduce((latest, item) => item.date > latest ? item.date : latest, activities[0].date)}T00:00:00`);
  const startDate = period === "all" ? firstActivityDate : periodStart;
  const endDate = period === "all" ? lastActivityDate : periodEnd;
  const spanDays = Math.round(
    (Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
      - Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()))
      / 86_400_000,
  ) + 1;
  const interval = spanDays > 365 ? "month" : "week";
  const buckets = new Map();

  for (const activity of activities) {
    const [year, month, day] = activity.date.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (interval === "week") date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    if (interval === "month") date.setDate(1);
    const key = dateKey(date);
    const bucket = buckets.get(key) || { date, count: 0 };
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  let bucketStart = new Date(startDate);
  if (interval === "week") bucketStart.setDate(bucketStart.getDate() - ((bucketStart.getDay() + 6) % 7));
  if (interval === "month") bucketStart.setDate(1);
  const bucketsInRange = [];
  while (bucketStart <= endDate) {
    const key = dateKey(bucketStart);
    bucketsInRange.push({
      date: new Date(bucketStart),
      count: buckets.get(key)?.count || 0,
    });
    if (interval === "day") bucketStart.setDate(bucketStart.getDate() + 1);
    else if (interval === "week") bucketStart.setDate(bucketStart.getDate() + 7);
    else bucketStart.setMonth(bucketStart.getMonth() + 1);
  }

  const intervalLabel = interval === "day" ? "daily" : interval === "week" ? "weekly" : "monthly";
  description.textContent = `${activities.length} activities, grouped ${intervalLabel}`;
  const height = 210;
  const margin = { top: 12, right: 12, bottom: 38, left: 40 };
  const xStep = 28;
  const plotWidth = bucketsInRange.length * xStep;
  const width = margin.left + plotWidth + margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxCount = Math.max(1, ...bucketsInRange.map((bucket) => bucket.count));
  const barWidth = Math.max(3, Math.min(22, xStep * 0.66));
  const y = (count) => margin.top + plotHeight - (count / maxCount) * plotHeight;
  const tickCount = Math.min(4, maxCount);
  const grid = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = Math.round((maxCount / tickCount) * index);
    const yPosition = y(value);
    return `<line class="frequency-grid-line" x1="${margin.left}" y1="${yPosition}" x2="${width - margin.right}" y2="${yPosition}"></line>`;
  }).join("");
  const yAxisLabels = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = Math.round((maxCount / tickCount) * index);
    return `<text class="frequency-axis-label" x="${margin.left - 8}" y="${y(value) + 4}" text-anchor="end">${value}</text>`;
  }).join("");
  const labelStep = Math.max(1, Math.ceil(bucketsInRange.length / 8));
  const bars = bucketsInRange.map((bucket, index) => {
    const x = margin.left + index * xStep + (xStep - barWidth) / 2;
    const barHeight = (bucket.count / maxCount) * plotHeight;
    const label = interval === "week"
      ? `W${String(getISOWeekNumber(bucket.date)).padStart(2, "0")}`
      : formatDate(bucket.date, { month: "short", year: "2-digit" });
    const bucketEnd = new Date(bucket.date);
    if (interval === "week") bucketEnd.setDate(bucketEnd.getDate() + 6);
    if (interval === "month") bucketEnd.setMonth(bucketEnd.getMonth() + 1, 0);
    const rangeStart = bucket.date < startDate ? startDate : bucket.date;
    const rangeEnd = bucketEnd > endDate ? endDate : bucketEnd;
    const dateOptions = { month: "short", day: "numeric", year: "numeric" };
    const dateRange = rangeStart.getTime() === rangeEnd.getTime()
      ? formatDate(rangeStart, dateOptions)
      : `${formatDate(rangeStart, dateOptions)}–${formatDate(rangeEnd, dateOptions)}`;
    const intervalLabel = interval === "day" ? "day" : `${interval}ly`;
    const accessibleSummary = `${dateRange}: ${bucket.count} ${bucket.count === 1 ? "activity" : "activities"}, grouped by ${intervalLabel}, all activity types`;
    const bar = `<rect class="frequency-bar" x="${x}" y="${y(bucket.count)}" width="${barWidth}" height="${barHeight}" rx="2" tabindex="0" data-date-range="${escapeHtml(dateRange)}" data-count="${bucket.count}" data-interval="${intervalLabel}" aria-label="${escapeHtml(accessibleSummary)}"></rect>`;
    const axisLabel = index % labelStep === 0 || index === bucketsInRange.length - 1
      ? `<text class="frequency-axis-label" x="${x + barWidth / 2}" y="${height - 10}" text-anchor="middle">${label}</text>`
      : "";
    return `${bar}${axisLabel}`;
  }).join("");

  activityFrequencyChart.innerHTML = `<svg class="frequency-y-axis" width="${margin.left}" height="${height}" viewBox="0 0 ${margin.left} ${height}" aria-hidden="true">
    ${yAxisLabels}
  </svg>
  <div class="frequency-chart-scroll">
    <svg class="frequency-chart-svg" width="${plotWidth + margin.right}" height="${height}" viewBox="0 0 ${plotWidth + margin.right} ${height}" role="group" aria-label="Total activities by ${intervalLabel} interval">
      <g transform="translate(${-margin.left} 0)">
        ${grid}
        ${bars}
      </g>
    </svg>
  </div>`;
  const chartScroll = activityFrequencyChart.querySelector(".frequency-chart-scroll");
  chartScroll.scrollLeft = chartScroll.scrollWidth;
  monitorChartScroll(activityFrequencyChart, activityTimelineLatest);
}

function renderRunList(runs) {
  visibleRuns = runs;
  runsSummary.textContent = `${runs.length} ${runs.length === 1 ? "run" : "runs"}`;
  runsList.innerHTML = runs.length
    ? runs.map((run, index) => {
      const [year, month, day] = run.date.split("-").map(Number);
      const date = formatDate(new Date(year, month - 1, day), {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const category = categoryForActivity(run.type || "Running");
      return `<tr data-run-index="${index}">
        <td data-label="Date"><button class="run-detail-trigger" type="button" data-run-index="${index}" aria-label="Show details for ${escapeHtml(run.type || "Running")} on ${escapeHtml(date)}">${escapeHtml(date)}</button></td>
        <td data-label="Activity"><span class="run-type activity-${category}">${escapeHtml(run.type || "Running")}</span></td>
        <td data-label="Distance">${formatDistance(run.distance / 1000, 2)} km</td>
        <td data-label="Pace">${formatPace(run.paceSecondsPerKm)}</td>
      </tr>`;
    }).join("")
    : '<tr><td class="runs-empty" colspan="4">No runs in this period.</td></tr>';
}

function showRunDetails(run) {
  const [year, month, day] = run.date.split("-").map(Number);
  const date = formatDate(new Date(year, month - 1, day), {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  runDetailTitle.textContent = run.type || "Running";
  runDetailDate.textContent = date;
  const details = [
    ["Distance", Number.isFinite(run.distance) ? `${formatDistance(run.distance / 1000, 2)} km` : "—"],
    ["Duration", formatDuration(run.durationSeconds)],
    ["Average pace", formatPace(run.paceSecondsPerKm)],
    ["Average heart rate", Number.isFinite(run.averageHeartRate) ? `${Math.round(run.averageHeartRate)} bpm` : "—"],
  ];
  runDetailList.innerHTML = details.map(([label, value]) =>
    `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`,
  ).join("");
  runDetailDialog.showModal();
}

runsList.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-run-index]");
  if (!row) return;
  const run = visibleRuns[Number(row.dataset.runIndex)];
  if (run) showRunDetails(run);
});
function closeRunDetails() {
  if (runDetailDialog.open && !runDetailDialog.dataset.closing) {
    runDetailDialog.dataset.closing = "true";
    runDetailDialog.classList.add("is-closing");
    runDetailDialog.addEventListener("animationend", () => {
      runDetailDialog.close();
      runDetailDialog.classList.remove("is-closing");
      delete runDetailDialog.dataset.closing;
    }, { once: true });
  }
}

runDetailClose.addEventListener("click", closeRunDetails);
runDetailDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeRunDetails();
});
runDetailDialog.addEventListener("click", (event) => {
  if (event.target === runDetailDialog) closeRunDetails();
});

function renderCalendar(activities, runs) {
  setCalendarCategoryHighlight(null);
  if (!calendarMonth) {
    const mostRecent = activities.map((activity) => activity.date).sort().at(-1);
    const [year, month] = mostRecent
      ? mostRecent.split("-").map(Number)
      : [new Date().getFullYear(), new Date().getMonth() + 1];
    calendarMonth = new Date(year, month - 1, 1);
  }

  const monthlyActivities = new Map();
  for (const activity of activities) {
    const [year, month, day] = activity.date.split("-").map(Number);
    if (year !== calendarMonth.getFullYear() || month !== calendarMonth.getMonth() + 1) continue;
    const key = String(day);
    const dayActivities = monthlyActivities.get(key) || { items: [], categories: new Set() };
    dayActivities.items.push(activity);
    dayActivities.categories.add(categoryForActivity(activity.type));
    monthlyActivities.set(key, dayActivities);
  }

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rows = Math.ceil((firstWeekday + daysInMonth) / 7);
  const dayCells = [];

  for (let index = 0; index < rows * 7; index += 1) {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) {
      dayCells.push("<td class=\"calendar-empty\" aria-hidden=\"true\"></td>");
      continue;
    }
    const activity = monthlyActivities.get(String(day));
    const categories = activity ? [...activity.categories] : [];
    const fullDate = formatDate(new Date(year, month, day), { month: "long", day: "numeric", year: "numeric" });
    const activityDetails = (activity?.items || []).map((item) => {
      const category = categoryForActivity(item.type);
      const lines = [`<strong>${escapeHtml(item.type)}</strong>`];
      if (["running", "trail", "cycling"].includes(category)) {
        lines.push(`<span>Distance: ${Number.isFinite(item.distance) ? `${formatDistance(item.distance / 1000, 2)} km` : "—"}</span>`);
        lines.push(`<span>Time: ${formatDuration(item.durationSeconds)}</span>`);
        lines.push(`<span>Pace: ${formatPace(item.paceSecondsPerKm)}</span>`);
      } else if (category === "yoga") {
        lines.push(`<span>Time: ${formatDuration(item.durationSeconds)}</span>`);
        lines.push(`<span>Average heart rate: ${Number.isFinite(item.averageHeartRate) ? `${Math.round(item.averageHeartRate)} bpm` : "—"}</span>`);
      } else {
        lines.push(`<span>Time: ${formatDuration(item.durationSeconds)}</span>`);
        lines.push(`<span>Average heart rate: ${Number.isFinite(item.averageHeartRate) ? `${Math.round(item.averageHeartRate)} bpm` : "—"}</span>`);
      }
      return `<span class="calendar-activity-detail">${lines.join("")}</span>`;
    }).join("");
    const runningCount = (activity?.items || []).filter((item) =>
      ["running", "trail"].includes(categoryForActivity(item.type)),
    ).length;
    const otherActivityCount = (activity?.items.length || 0) - runningCount;
    const daySummary = [
      runningCount ? `${runningCount} ${runningCount === 1 ? "run" : "runs"}` : "",
      otherActivityCount ? `${otherActivityCount} ${otherActivityCount === 1 ? "other activity" : "other activities"}` : "",
    ].filter(Boolean).join(", ");
    const description = `${fullDate}${activity ? `: ${daySummary} — ${categories.map((category) => activityCategories[category].label).join(", ")}` : ": no activity"}`;
    const markers = categories.map((category) => `<i class="calendar-marker marker-${category}" aria-hidden="true"></i>`).join("");
    const stripeStyle = categories.length > 1
      ? ` style="--activity-stripes: repeating-linear-gradient(135deg, ${categories.map((category, stripeIndex) => `${activityCategories[category].stripe} ${stripeIndex * 8}px ${(stripeIndex + 1) * 8}px`).join(", ")})"`
      : "";
    const runTooltip = `<span class="calendar-tooltip" aria-hidden="true"><strong>${escapeHtml(fullDate)}</strong>${activityDetails || "<span>No activity details</span>"}</span>`;
    const activityAccessibleDetails = (activity?.items || []).map((item) => {
      const category = categoryForActivity(item.type);
      return ["running", "trail", "cycling"].includes(category)
        ? `${item.type}: distance ${Number.isFinite(item.distance) ? `${formatDistance(item.distance / 1000, 2)} kilometers` : "unavailable"}, time ${formatDuration(item.durationSeconds)}, pace ${formatPace(item.paceSecondsPerKm)}.`
        : `${item.type}: time ${formatDuration(item.durationSeconds)}, average heart rate ${Number.isFinite(item.averageHeartRate) ? `${Math.round(item.averageHeartRate)} beats per minute` : "unavailable"}.`;
    }).join(" ");
    const accessibleDescription = `${description}. ${activityAccessibleDetails}`;
    dayCells.push(
      `<td class="${activity ? `calendar-active${categories.length === 1 ? ` activity-${categories[0]}` : " activity-mixed"}` : ""}"${activity ? ` data-activity-categories="${categories.join(" ")}"` : ""}${stripeStyle} title="${description}" aria-label="${escapeHtml(accessibleDescription)}"${activity ? ' tabindex="0"' : ""}><span>${day}</span>${markers ? `<span class="calendar-markers">${markers}</span>` : ""}${activity ? runTooltip : ""}</td>`,
    );
  }

  calendarDays.innerHTML = Array.from({ length: rows }, (_, row) =>
    `<tr>${dayCells.slice(row * 7, row * 7 + 7).join("")}</tr>`,
  ).join("");
  document.querySelector("#calendar-month").textContent = formatDate(calendarMonth, { month: "long", year: "numeric" });
  const monthlyItems = [...monthlyActivities.values()].flatMap((activity) => activity.items);
  const monthlyRunCount = monthlyItems.filter((activity) =>
    ["running", "trail"].includes(categoryForActivity(activity.type)),
  ).length;
  const monthlyOtherCount = monthlyItems.length - monthlyRunCount;
  const monthlyCountSummary = [
    monthlyRunCount ? `${monthlyRunCount} ${monthlyRunCount === 1 ? "run" : "runs"}` : "",
    monthlyOtherCount ? `${monthlyOtherCount} ${monthlyOtherCount === 1 ? "other activity" : "other activities"}` : "",
  ].filter(Boolean).join(" · ");
  document.querySelector("#calendar-summary").textContent =
    `${monthlyActivities.size} ${monthlyActivities.size === 1 ? "active day" : "active days"}${monthlyCountSummary ? ` · ${monthlyCountSummary}` : ""}`;
  const activeCategories = [...new Set([...monthlyActivities.values()].flatMap((activity) => [...activity.categories]))];
  calendarLegend.innerHTML = activeCategories.length
    ? activeCategories.map((category) => `<span class="calendar-legend-item" data-category="${category}" tabindex="0" aria-label="Highlight ${activityCategories[category].label} activities"><i class="calendar-legend-dot marker-${category}"></i>${activityCategories[category].label}</span>`).join("")
    : '<span class="calendar-legend-empty">No activities this month</span>';

  const monthIndexes = activities.map((activity) => {
    const [activityYear, activityMonth] = activity.date.split("-").map(Number);
    return activityYear * 12 + activityMonth - 1;
  });
  const currentIndex = year * 12 + month;
  calendarPrev.disabled = monthIndexes.length === 0 || currentIndex <= Math.min(...monthIndexes);
  calendarNext.disabled = monthIndexes.length === 0 || currentIndex >= Math.max(...monthIndexes);
}

function setCalendarCategoryHighlight(category) {
  for (const cell of calendarDays.querySelectorAll(".calendar-active")) {
    const matches = category && cell.dataset.activityCategories.split(" ").includes(category);
    cell.classList.toggle("calendar-highlighted", Boolean(matches));
    cell.classList.toggle("calendar-dimmed", Boolean(category && !matches));
  }
}

calendarLegend.addEventListener("pointerover", (event) => {
  const item = event.target.closest(".calendar-legend-item");
  if (item && !item.contains(event.relatedTarget)) {
    setCalendarCategoryHighlight(item.dataset.category);
  }
});
calendarLegend.addEventListener("pointerout", (event) => {
  const item = event.target.closest(".calendar-legend-item");
  if (item && !item.contains(event.relatedTarget)) {
    setCalendarCategoryHighlight(null);
  }
});
calendarLegend.addEventListener("focusin", (event) => {
  const item = event.target.closest(".calendar-legend-item");
  if (item) setCalendarCategoryHighlight(item.dataset.category);
});
calendarLegend.addEventListener("focusout", (event) => {
  if (!event.relatedTarget?.closest?.(".calendar-legend-item")) {
    setCalendarCategoryHighlight(null);
  }
});

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function refreshDashboard() {
  if (importedRuns.length === 0) return;
  renderRuns(importedRuns, dashboardPeriod.value);
}

calendarPrev.addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  refreshDashboard();
});
calendarNext.addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  refreshDashboard();
});

function setImportedState() {
  const hasRuns = importedRuns.length > 0;
  dashboard.hidden = !hasRuns;
  dashboardNav.hidden = !hasRuns;
  dashboardPeriodControl.hidden = !hasRuns;
  connectState.hidden = hasRuns;
  statusDot.classList.toggle("connected", hasRuns);
  connectionLabel.textContent = hasRuns
    ? `${importedActivities.length} ${importedActivities.length === 1 ? "activity" : "activities"} imported`
    : "No activities imported";
  if (hasRuns) {
    document.querySelector("#data-note").textContent =
      `${importedFileName || "Garmin Connect CSV"} · Stored only in this browser`;
  }
}

function setDashboardView(view, updateUrl = false) {
  const buttons = [...dashboardNav.querySelectorAll(".dashboard-nav-item")];
  const selectedButton = buttons
    .find((button) => button.dataset.view === view);
  const activeButton = selectedButton || buttons.find((button) => button.dataset.view === "calendar");
  const activeView = activeButton.dataset.view;
  const panels = buttons.map((button) => document.querySelector(`#${button.getAttribute("aria-controls")}`));

  for (const button of buttons) {
    const isSelected = button === activeButton;
    button.setAttribute("aria-selected", String(isSelected));
  }

  for (const panel of panels) {
    const isSelected = panel.id === `${activeView}-view`;
    panel.hidden = !isSelected;
    panel.inert = !isSelected;
    if (isSelected) panel.removeAttribute("aria-hidden");
    else panel.setAttribute("aria-hidden", "true");
  }

  if (activeView === "runs") refreshChartLatestButton(chart, runningLoadLatest);
  if (activeView === "weekday") refreshChartLatestButton(activityFrequencyChart, activityTimelineLatest);
  dashboard.dataset.activeView = activeView;
  if (updateUrl && window.location.hash !== `#${activeView}`) {
    window.history.pushState(null, "", `#${activeView}`);
  }
}

async function connectDevReload() {
  try {
    const response = await fetch("/__dev/status");
    if (!response.ok) throw new Error(`Development reload status failed: ${response.status}`);
    const { enabled } = await response.json();
    if (!enabled) return;

    const events = new EventSource("/__dev/events");
    let connected = false;
    let reconnecting = false;
    events.addEventListener("open", () => {
      if (reconnecting) window.location.reload();
      connected = true;
    });
    events.addEventListener("reload", () => window.location.reload());
    events.addEventListener("error", () => {
      if (connected) reconnecting = true;
    });
  } catch (error) {
    console.error("Unable to connect development auto-reload:", error);
  }
}

async function importFile(file) {
  if (!file) return;
  notice.hidden = true;
  try {
    const { runs, activities } = parseGarminCsv(await file.text(), "km");
    importedRuns = runs;
    importedActivities = activities;
    importedFileName = file.name;
    calendarMonth = null;
    try {
      localStorage.setItem("stride-garmin-runs", JSON.stringify({
        version: 4,
        fileName: importedFileName,
        runs,
        activities,
        distanceUnit: "m",
      }));
    } catch {
      showError("Your runs are loaded, but this browser could not save them. They will be lost when you close this page.");
    }
    setImportedState();
    refreshDashboard();
  } catch (error) {
    showError(error.message || "Could not read the selected CSV file.");
  }
}

for (const button of importButtons) {
  button.addEventListener("click", () => {
    csvInput.value = "";
    csvInput.click();
  });
}
dashboardNav.addEventListener("click", (event) => {
  const button = event.target.closest(".dashboard-nav-item");
  if (!button) return;
  setDashboardView(button.dataset.view, true);
});
window.addEventListener("popstate", () => setDashboardView(window.location.hash.slice(1)));
window.addEventListener("hashchange", () => setDashboardView(window.location.hash.slice(1)));
setDashboardView(window.location.hash.slice(1));
connectDevReload();
csvInput.addEventListener("change", () => importFile(csvInput.files[0]));
dashboardPeriod.addEventListener("change", refreshDashboard);
rollingPeriod.addEventListener("change", refreshDashboard);

try {
  const saved = JSON.parse(localStorage.getItem("stride-garmin-runs") || "null");
  if (saved && Array.isArray(saved.runs) && saved.runs.every((run) => typeof run.date === "string" && Number.isFinite(run.distance))) {
    importedRuns = normalizeStoredRuns(saved.runs, saved.distanceUnit);
    for (const run of importedRuns) {
      if (typeof run.type !== "string") run.type = "Running";
    }
    importedActivities = Array.isArray(saved.activities)
      ? saved.activities.filter((activity) => typeof activity.date === "string" && typeof activity.type === "string").map((activity) => ({
        ...activity,
        distance: Number.isFinite(activity.distance) ? activity.distance : null,
        durationSeconds: Number.isFinite(activity.durationSeconds) ? activity.durationSeconds : null,
        paceSecondsPerKm: Number.isFinite(activity.paceSecondsPerKm) ? activity.paceSecondsPerKm : null,
        averageHeartRate: Number.isFinite(activity.averageHeartRate) ? activity.averageHeartRate : null,
      }))
      : saved.runs.map((run) => ({ date: run.date, type: "Running" }));
    importedFileName = saved.fileName || "";
    const hasSavedActivityTypes = Array.isArray(saved.activities);
    if (saved.version !== 4 || saved.distanceUnit !== "m" || !hasSavedActivityTypes) {
      try {
        localStorage.setItem("stride-garmin-runs", JSON.stringify({
          version: saved.version === 4 ? 4 : saved.version === 3 ? 3 : saved.version === 2 ? 2 : 1,
          fileName: importedFileName,
          runs: importedRuns,
          activities: importedActivities,
          distanceUnit: "m",
        }));
      } catch {
        showError("Your saved runs were converted for this session, but the updated distances could not be saved.");
      }
    }
    setImportedState();
    refreshDashboard();
    if (saved.version !== 4 || !hasSavedActivityTypes) {
      showError("These saved activities are from an older import and may be missing activity details. Choose Import CSV and reselect your Garmin export to restore pace, time, and heart-rate data.");
    }
  }
} catch {
  showError("Saved activities could not be read. Please import the Garmin CSV again.");
}
