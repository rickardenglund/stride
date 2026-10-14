import { chartDataRange, chartLabelIndices } from "./chart-range.js";
import { bindChartInspection } from "./chart-inspection.js";
import { mergeSleep, renderSleep } from "./sleep.js";
import { groupActivitiesByWeekday, renderWeekdayBars } from "./weekday.js";
import { normalizeHeatmapSelection, toggleHeatmapType, selectedHeatmapRoutes, HEATMAP_TYPE_GROUPS, heatmapGroupTypes, heatmapOptionState, defaultHeatmapSelection } from "./heatmap-filter.js";
import { loadImportedData, saveImportedData, clearImportedData } from "./storage.js";
import { routeMatchesActivity, mergeRoutes } from "./routes.js";
import { normalizeStoredRuns, parseGarminCsv } from "./csv.js";
import { mergeActivities, runningActivities } from "./activities.js";
import { dateKey, distanceScale, summarizeTraining } from "./training.js";
import { projectMapRoutes, mountBackgroundMap, getMapViewport, updateMapOverlay } from "./maps.js";
import { buildRunHeatmap, renderRunHeatmap, groupHeatmapRoutes } from "./heatmap.js";

const dashboard = document.querySelector("#dashboard");
const dashboardNav = document.querySelector("#dashboard-nav");
const connectState = document.querySelector("#connect-state");
const notice = document.querySelector("#notice");
const dashboardPeriod = document.querySelector("#dashboard-period");
const dashboardPeriodControl = document.querySelector("#dashboard-period-control");
const rollingPeriod = document.querySelector("#rolling-period");
const showRollingTotal = document.querySelector("#show-rolling-total");
const importMenu = document.querySelector("#import-menu");
const csvDropZone = document.querySelector("#csv-drop-zone");
const connectionLabel = document.querySelector("#connection-label");
const statusDot = document.querySelector(".status-dot");
const csvInput = document.querySelector("#csv-input");
const calendarDays = document.querySelector("#calendar-days");
const calendarLegend = document.querySelector("#calendar-legend");
const calendarPrev = document.querySelector("#calendar-prev");
const calendarNext = document.querySelector("#calendar-next");
const runsList = document.querySelector("#runs-list");
const runsSummary = document.querySelector("#runs-summary");
const runsPagination = document.querySelector("#runs-pagination");
const runsPageSize = document.querySelector("#runs-page-size");
const runsPagePrevious = document.querySelector("#runs-page-previous");
const runsPageNext = document.querySelector("#runs-page-next");
const runsPageStatus = document.querySelector("#runs-page-status");
let runsPage = 0;
const weekdayFrequency = document.querySelector("#weekday-frequency");
const weekdayBarView = document.querySelector("#weekday-bar-view");
document.querySelector(".weekday-view-toggle").addEventListener("click", event => {
  const button = event.target.closest("[data-weekday-view]");
  if (!button) return;
  const bars = button.dataset.weekdayView === "bars";
  document.querySelector("#weekday-table-view").hidden = bars;
  weekdayBarView.hidden = !bars;
  for (const option of document.querySelectorAll("[data-weekday-view]")) {
    option.setAttribute("aria-pressed", String(option === button));
  }
  hideChartTooltip();
});
const activityFrequencyChart = document.querySelector("#activity-frequency-chart");
const runningLoadLatest = document.querySelector("#running-load-latest");
const activityTimelineLatest = document.querySelector("#activity-timeline-latest");
const runDetailDialog = document.querySelector("#run-detail-dialog");
const runDetailTitle = document.querySelector("#run-detail-title");
const runDetailDate = document.querySelector("#run-detail-date");
const runDetailList = document.querySelector("#run-detail-list");
const runGarminLink = document.querySelector("#run-garmin-link");
const runDetailClose = document.querySelector("#run-detail-close");
const runDetailPrevious = document.querySelector("#run-detail-previous");
const runDetailNext = document.querySelector("#run-detail-next");
const runRouteSection = document.querySelector("#run-route-section");
const runRouteChart = document.querySelector("#run-route-chart");
const runRouteFilename = document.querySelector("#run-route-filename");
const runHeartRateSection = document.querySelector("#run-heart-rate-section");
const runHeartRateChart = document.querySelector("#run-heart-rate-chart");
const runElevationSection = document.querySelector("#run-elevation-section");
const runElevationChart = document.querySelector("#run-elevation-chart");
const gpxImportButton = document.querySelector("#gpx-import-button");
const gpxInput = document.querySelector("#gpx-input");
const unloadDataButton = document.querySelector("#unload-data-button");
const chart = document.querySelector("#chart");
const importButtons = [document.querySelector("#import-button"), document.querySelector("#import-cta")];
const zipImportButton = document.querySelector("#zip-import-button");
const importProgress = document.querySelector("#import-progress");
const importProgressText = document.querySelector("#import-progress-text");
const cancelImportButton = document.querySelector("#cancel-import");
let cancelZipImport = null;
let csvImportInProgress = false;

function readGarminZip(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./garmin-worker.js", import.meta.url), { type: "module" });
    const finish = (error, result) => {
      worker.terminate();
      cancelZipImport = null;
      if (error) reject(error); else resolve(result);
    };
    cancelZipImport = () => finish(new DOMException("Import cancelled", "AbortError"));
    worker.onmessage = ({ data }) => {
      if (data.progress) importProgressText.textContent = data.progress.message;
      else finish(data.error ? new Error(data.error) : null, data.result);
    };
    worker.onerror = () => finish(new Error("Could not start the Garmin importer. Reload the page and try again."));
    worker.postMessage({ file });
  });
}
cancelImportButton.addEventListener("click", () => cancelZipImport?.());
zipImportButton.addEventListener("click", () => {
  importMenu.open = false;
  csvInput.value = "";
  csvInput.accept = ".zip,application/zip";
  csvInput.click();
});
let importedSleep = [];
let sleepPage = 0;
const sleepView = document.querySelector("#sleep-view");
sleepView.addEventListener("click", event => {
  const button = event.target.closest("[data-sleep-page]");
  if (!button || button.disabled) return;
  sleepPage = Number(button.dataset.sleepPage);
  renderSleep(sleepView, importedSleep, dashboardPeriod.value, sleepPage);
});
let importedRuns = [];
let importedActivities = [];
let importedFileName = "";
let calendarMonth = null;
let visibleRuns = [];
let importedRoutes = [];
let selectedRunDetails = null;
let selectedRouteCoordinates = [];
let selectedHeartRatePoints = [];
let selectedElevationPoints = [];

const activityCategories = {
  running: { label: "Running", background: "#173c5a" },
  trail: { label: "Trail running", background: "#493626" },
  cycling: { label: "Cycling", background: "#16463f" },
  walking: { label: "Walking & hiking", background: "#3b315e" },
  swimming: { label: "Swimming", background: "#174454" },
  strength: { label: "Strength", background: "#503233" },
  climbing: { label: "Climbing", background: "#514522" },
  yoga: { label: "Yoga", background: "#50304a" },
  other: { label: "Other", background: "#344451" },
};

const activityIcons = {
  running: '<circle cx="15" cy="4" r="2"/><path d="m12 8 4 4h4M16 7l-5 6 4 3-1 5M11 13l-3 4H3M12 8H8l-3 4"/>',
  trail: '<path d="m2 20 7-12 4 6 3-5 6 11H2Z M7 11l2 2 2-2 M13 20l3-3-3-2"/>',
  cycling: '<circle cx="5" cy="16" r="4"/><circle cx="19" cy="16" r="4"/><path d="m5 16 5-8 5 8H5M10 8 8 5H6m4 3h8l1 8M16 5h2v3"/>',
  walking: '<circle cx="13" cy="4" r="2"/><path d="m11 8 3 1 3 4h3M14 9l-3 6 4 3 1 4M11 15l-4 7M11 8l-4 4v4"/>',
  swimming: '<circle cx="17" cy="7" r="2"/><path d="m4 13 5-4 5 4M9 9l-3-4 4-2M2 17q2-2 4 0t4 0 4 0 4 0 4 0M2 21q2-2 4 0t4 0 4 0 4 0 4 0"/>',
  strength: '<path d="M7 12h10M3 10v4m18-4v4"/><rect x="4" y="6" width="3" height="12" rx="1"/><rect x="17" y="6" width="3" height="12" rx="1"/>',
  climbing: '<circle cx="11" cy="5" r="2"/><path d="m9 9 4 1 3-5M10 10l-4 3-2-3M13 10l-2 5 4 2-1 5M11 15H7l-2 5M20 2l-2 6 3 5-3 9"/>',
  yoga: '<circle cx="12" cy="5" r="2"/><path d="M9 10h6l2 5h4M9 10l-2 5H3M9 14v3l-5 2 4 2h8l4-2-5-2v-3M8 21l4-3 4 3"/>',
  other: '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
};

function activityIcon(category) {
  const key = Object.hasOwn(activityIcons, category) ? category : "other";
  return `<svg class="activity-icon marker-${key}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${activityIcons[key]}</svg>`;
}

function categoryForActivity(type) {
  const normalized = type.toLowerCase();
  if (/trail/.test(normalized)) return "trail";
  if (/run|running/.test(normalized)) return "running";
  if (/cycl|bike|biking/.test(normalized)) return "cycling";
  if (/walk|hik/.test(normalized)) return "walking";
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

function showNotice(message, kind = "error") {
  notice.textContent = message;
  notice.dataset.kind = kind;
  notice.setAttribute("role", kind === "error" ? "alert" : "status");
  notice.hidden = false;
}

function showError(message) {
  showNotice(message);
}

function makeChart(daily, dates, rollingAverage, rollingTotals, averageDays, totalDays, includeTotals = false, availableWidth = 800) {
  const width = Math.max(800, availableWidth, dates.length * 10);
  const height = 260;
  const left = 43;
  const right = 12;
  const top = 26;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const { tickStep, maxY } = distanceScale(daily, rollingAverage, rollingTotals, includeTotals);
  const x = (index) => left + (index / Math.max(1, dates.length - 1)) * plotWidth;
  const y = (value) => top + plotHeight - (value / maxY) * plotHeight;
  const barWidth = Math.max(2, Math.min(7, (plotWidth / dates.length) * 0.55));
  const grid = [];
  const yAxisLabels = [];

  for (let value = 0; value <= maxY; value += tickStep) {
    const position = y(value);
    grid.push(`<line class="grid-line" x1="${left}" y1="${position}" x2="${width - right}" y2="${position}"></line>`);
    yAxisLabels.push(`<text class="axis-label" x="${left - 10}" y="${position + 3}" text-anchor="end">${value}</text>`);
  }
  const bars = daily.map((value, index) => {
    const barHeight = (value / maxY) * plotHeight;
    const barX = x(index) - barWidth / 2;
    const date = formatDate(dates[index], { month: "short", day: "numeric", year: "numeric" });
    return `<rect class="daily-bar" x="${barX}" y="${y(value)}" width="${barWidth}" height="${barHeight}" rx="2" ${value > 0 ? 'tabindex="0"' : ""} data-kind="daily" data-date="${escapeHtml(date)}" data-distance="${formatDistance(value)}" aria-label="${escapeHtml(date)}: ${formatDistance(value)} km"></rect>`;
  }).join("");

  const linePoints = rollingAverage.map((value, index) => `${x(index)},${y(value)}`);
  const linePath = linePoints.map((point, index) => `${index === 0 ? "M" : "L"}${point}`).join(" ");
  const totalPoints = rollingTotals.map((value, index) => `${x(index)},${y(value)}`);
  const totalPath = totalPoints.map((point, index) => `${index === 0 ? "M" : "L"}${point}`).join(" ");
  const areaPath = `${linePath} L${x(dates.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const labels = chartLabelIndices(dates.length, plotWidth / Math.max(1, dates.length - 1)).map(index => {
    const label = formatDate(dates[index], { month: "short", day: "numeric", year: "2-digit" });
    const anchor = index === 0 ? "start" : index === dates.length - 1 ? "end" : "middle";
    return `<text class="axis-label" x="${x(index)}" y="${height - 9}" text-anchor="${anchor}">${label}</text>`;
  }).join("");
  const windowLabel = (index, windowDays) => {
    const start = new Date(dates[index]);
    start.setDate(start.getDate() - windowDays + 1);
    const options = { month: "short", day: "numeric" };
    return `${formatDate(start, options)}–${formatDate(dates[index], options)}`;
  };
  const points = rollingAverage.map((value, index) => {
    const window = windowLabel(index, averageDays);
    const tooltip = `${averageDays}-day rolling average: ${formatDistance(value)} km/day, window: ${window}`;
    return `<circle class="avg-point" cx="${x(index)}" cy="${y(value)}" r="5" tabindex="0" data-kind="average" data-window-days="${averageDays}" data-average="${formatDistance(value)}" data-window="${escapeHtml(window)}" aria-label="${escapeHtml(tooltip)}"></circle>`;
  }).join("");
  const totalMarkers = includeTotals ? rollingTotals.map((value, index) =>
    `<circle class="sum-point" cx="${x(index)}" cy="${y(value)}" r="4" tabindex="0" data-kind="total" data-window-days="${totalDays}" data-distance="${formatDistance(value)}" data-window="${escapeHtml(windowLabel(index, totalDays))}" aria-label="${totalDays}-day total: ${formatDistance(value)} km"></circle>`,
  ).join("") : "";

  return `<svg class="running-load-y-axis" width="${left}" height="${height}" viewBox="0 0 ${left} ${height}" aria-hidden="true">
    <text class="axis-label" x="${left - 10}" y="12" text-anchor="end">km</text>
    ${yAxisLabels.join("")}
  </svg>
  <div class="running-load-plot-scroll">
    <svg width="${width - left}" height="${height}" viewBox="0 0 ${width - left} ${height}" role="group" aria-label="Daily running distance in kilometers and ${averageDays}-day average in kilometers per day${includeTotals ? `, with ${totalDays}-day total in kilometers` : ""}">
      <g transform="translate(${-left} 0)">
        ${grid.join("")}
        <path class="avg-area" d="${areaPath}"></path>
        ${bars}
        <path class="avg-path" d="${linePath}"></path>
        ${includeTotals ? `<path class="sum-path" d="${totalPath}"></path>` : ""}
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
  if (point.dataset.kind === "daily") {
    chartTooltip.children[0].textContent = point.dataset.date;
    chartTooltip.children[1].textContent = `${point.dataset.distance} km`;
    chartTooltip.children[2].textContent = "Daily running distance";
    chartTooltip.children[3].textContent = "";
    positionChartTooltip(clientX, clientY);
    return;
  }
  const windowDays = Number(point.dataset.windowDays);
  chartTooltip.children[0].textContent = `${windowDays}-day rolling ${point.dataset.kind}`;
  chartTooltip.children[1].textContent = point.dataset.kind === "average"
    ? `${point.dataset.average} km/day`
    : `${point.dataset.distance} km`;
  chartTooltip.children[2].textContent = `Window: ${point.dataset.window}`;
  chartTooltip.children[3].textContent = `Window length: ${windowDays} days`;
  positionChartTooltip(clientX, clientY);
}

function positionChartTooltip(clientX, clientY) {
  // Tooltips for run profiles must live in the dialog's top layer.
  const parent = document.fullscreenElement || runRouteChart.closest(".map-fullscreen-dialog")
    || (runDetailDialog.open ? runDetailDialog : document.body);
  if (chartTooltip.parentElement !== parent) parent.append(chartTooltip);
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


bindChartInspection(chart, ".avg-point, .sum-point, .daily-bar", showChartTooltip, hideChartTooltip);
bindChartInspection(activityFrequencyChart, ".frequency-bar", showFrequencyTooltip, hideChartTooltip);
bindChartInspection(weekdayBarView, ".weekday-bar", (bar, x, y) => {
  chartTooltip.children[0].textContent = `${bar.dataset.label} · ${bar.dataset.weekday}`;
  chartTooltip.children[1].textContent = bar.dataset.count;
  chartTooltip.children[2].textContent = bar.dataset.count === "1" ? "Activity" : "Activities";
  chartTooltip.children[3].textContent = "Selected time period";
  positionChartTooltip(x, y);
}, hideChartTooltip);
document.addEventListener("pointerdown", event => {
  if (![chart, activityFrequencyChart, weekdayBarView, runHeartRateChart, runElevationChart, runRouteChart].some(container => container.contains(event.target))) hideChartTooltip();
});
document.addEventListener("scroll", hideChartTooltip, { capture: true, passive: true });
document.addEventListener("keydown", event => { if (event.key === "Escape") hideChartTooltip(); });

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
  const range = chartDataRange(daily.slice(lookback), distance => distance > 0);
  const visibleDaily = daily.slice(lookback + range.start, lookback + range.end);
  const visibleRolling = rollingAverage.slice(lookback + range.start, lookback + range.end);
  const visibleTotals = rollingTotals.slice(lookback + range.start, lookback + range.end);
  const visibleDates = dates.slice(lookback + range.start, lookback + range.end);
  const timePeriodDescription = dashboardPeriod.value === "all" ? "all imported dates" : `the last ${days} days`;
  const periodRuns = runs
    .filter((run) => run.date >= dateKey(dates[lookback]) && run.date <= dateKey(dates.at(-1)))
    .sort((left, right) => right.date.localeCompare(left.date));
  const runningLoadChart = document.querySelector("#chart");
  if (!visibleDates.length) {
    runningLoadChart.innerHTML = '<p class="weekday-empty">No running activities in this period.</p>';
    runningLoadChart.setAttribute("aria-label", "No running activities in this period");
    document.querySelector("#chart-range").textContent = "No data in this period";
    runningLoadLatest.hidden = true;
    renderRunList(periodRuns);
    return;
  }
  runningLoadChart.innerHTML = makeChart(visibleDaily, visibleDates, visibleRolling, visibleTotals, windowDays, windowDays, showRollingTotal.checked, runningLoadChart.clientWidth);
  const chartScroll = runningLoadChart.querySelector(".running-load-plot-scroll");
  chartScroll.scrollLeft = chartScroll.scrollWidth;
  monitorChartScroll(runningLoadChart, runningLoadLatest);
  document.querySelector("#chart").setAttribute("aria-label", `Running distance with ${windowDays}-day rolling average${showRollingTotal.checked ? ` and ${windowDays}-day rolling total` : ""} for ${timePeriodDescription}`);
  document.querySelector("#average-legend-label").textContent = `${windowDays}-day average`;
  document.querySelector("#total-legend-label").textContent = `${windowDays}-day total`;
  document.querySelector("#total-legend").hidden = !showRollingTotal.checked;
  document.querySelector("#chart-range").textContent = `${formatDate(visibleDates[0], { month: "short", day: "numeric" }).toUpperCase()} — ${formatDate(visibleDates.at(-1), { month: "short", day: "numeric" }).toUpperCase()}`;
  renderRunList(periodRuns);
}

function renderWeekdayFrequency(activities, period) {
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
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

  const grouped = groupActivitiesByWeekday(periodActivities);
  weekdayBarView.innerHTML = renderWeekdayBars(grouped);

  document.querySelector("#weekday-description").textContent = period === "all"
    ? `Activity counts across all ${periodActivities.length} imported activities, grouped by weekday`
    : `Activity counts for the last ${period} days, grouped by weekday (${periodActivities.length} activities)`;
  if (!periodActivities.length) {
    weekdayFrequency.innerHTML = '<tr><td class="weekday-empty" colspan="8">No activities in this period.</td></tr>';
    return;
  }

  const renderRow = (label, rowCounts, category = null, isGroup = false) => {
    const maximum = Math.max(...rowCounts);
    const cells = rowCounts.map((count, weekday) => {
      const level = count ? Math.max(1, Math.ceil((count / maximum) * 4)) : 0;
      const accessibleCount = escapeHtml(`${label} on ${weekdays[weekday]}: ${count} ${count === 1 ? "activity" : "activities"}`);
      return `<td class="weekday-frequency-cell level-${level}" aria-label="${accessibleCount}" title="${accessibleCount}">${count || "—"}</td>`;
    }).join("");
    const marker = category ? `<i class="calendar-legend-dot marker-${category}" aria-hidden="true"></i>` : "";
    return `<tr${isGroup ? ' class="weekday-group-row"' : ""}><th scope="row"><span class="weekday-activity-name">${marker}${escapeHtml(label)}</span></th>${cells}</tr>`;
  };

  const rows = [renderRow("All activities", grouped.all, null, true),
    ...grouped.groups.map(group => renderRow(group.label, group.counts, null, true)),
    '<tr class="weekday-section-row"><th colspan="8" scope="colgroup">Individual types</th></tr>',
    ...grouped.types.map(([type, counts]) => renderRow(
      type.replace(/\b[a-z]/g, character => character.toUpperCase()), counts, categoryForActivity(type))),
  ];
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
  const startDate = firstActivityDate;
  const endDate = lastActivityDate;
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
  const xStep = Math.max(28, (activityFrequencyChart.clientWidth - margin.left - margin.right) / bucketsInRange.length);
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
  const labelIndices = new Set(chartLabelIndices(bucketsInRange.length, xStep));
  const bars = bucketsInRange.map((bucket, index) => {
    const x = margin.left + index * xStep + (xStep - barWidth) / 2;
    const barHeight = (bucket.count / maxCount) * plotHeight;
    const label = interval === "week"
      ? `${formatDate(bucket.date, { month: "short", day: "numeric", year: "2-digit" })}`
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
    const labelAnchor = index === 0 ? "start" : index === bucketsInRange.length - 1 ? "end" : "middle";
    const axisLabel = labelIndices.has(index)
      ? `<text class="frequency-axis-label" x="${x + barWidth / 2}" y="${height - 10}" text-anchor="${labelAnchor}">${label}</text>`
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
  // Retain the page through chart refreshes, but reset when the filtered list changes.
  if (runs.length !== visibleRuns.length || runs.some((run, index) => run !== visibleRuns[index])) runsPage = 0;
  visibleRuns = runs;
  const pageSize = Number(runsPageSize.value);
  const pageCount = Math.max(1, Math.ceil(runs.length / pageSize));
  runsPage = Math.max(0, Math.min(runsPage, pageCount - 1));
  const start = runsPage * pageSize;
  const end = Math.min(start + pageSize, runs.length);
  runsSummary.textContent = runs.length
    ? `${start + 1}–${end} of ${runs.length} ${runs.length === 1 ? "run" : "runs"}`
    : "0 runs";
  runsPagination.hidden = runs.length === 0;
  runsPagePrevious.disabled = runsPage === 0;
  runsPageNext.disabled = runsPage >= pageCount - 1;
  runsPageStatus.textContent = `Page ${runsPage + 1} of ${pageCount}`;
  runsList.innerHTML = runs.length
    ? runs.slice(start, end).map((run, pageIndex) => {
      const index = start + pageIndex;
      const [year, month, day] = run.date.split("-").map(Number);
      const date = formatDate(new Date(year, month - 1, day), {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const category = categoryForActivity(run.type || "Running");
      const hasRoute = importedRoutes.some((route) =>
        routeMatchesActivity(route, run, importedRuns),
      );
      const routeIndicator = hasRoute
        ? '<svg class="run-route-indicator" viewBox="0 0 20 20" role="img" aria-label="GPS route available" title="GPS route available"><path d="M3 15c3-8 5-8 8-3s4 4 6-7"></path><circle cx="3" cy="15" r="1.5"></circle><circle cx="17" cy="5" r="1.5"></circle></svg>'
        : "";
      return `<tr data-run-index="${index}">
        <td data-label="Date"><button class="run-detail-trigger" type="button" data-run-index="${index}" aria-label="Show details for ${escapeHtml(run.type || "Running")} on ${escapeHtml(date)}">${escapeHtml(date)}</button></td>
        <td data-label="Activity"><span class="run-type activity-${category}">${escapeHtml(run.type || "Running")}</span>${routeIndicator}</td>
        <td data-label="Distance">${formatDistance(run.distance / 1000, 2)} km</td>
        <td data-label="Pace">${formatPace(run.paceSecondsPerKm)}</td>
      </tr>`;
    }).join("")
    : '<tr><td class="runs-empty" colspan="4">No runs in this period.</td></tr>';
}

function changeRunsPage(offset) {
  runsPage += offset;
  renderRunList(visibleRuns);
}
runsPagePrevious.addEventListener("click", () => changeRunsPage(-1));
runsPageNext.addEventListener("click", () => changeRunsPage(1));
runsPageSize.addEventListener("change", () => {
  runsPage = 0;
  renderRunList(visibleRuns);
});

let runDetailCloseTimer;

function showRunDetails(run, updateUrl = false) {
  clearTimeout(runDetailCloseTimer);
  runDetailCloseTimer = undefined;
  runDetailDialog.classList.remove("is-closing");
  if (updateUrl) {
    const runIndex = importedRuns.indexOf(run);
    if (runIndex !== -1) {
      const url = new URL(window.location.href);
      url.searchParams.set("run", String(runIndex));
      if (url.hash !== "#runs") url.hash = "runs";
      window.history.pushState(null, "", url);
    }
  }
  const [year, month, day] = run.date.split("-").map(Number);
  const date = formatDate(new Date(year, month - 1, day), {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  runDetailDate.textContent = date;
  runDetailDate.dataset.date = run.date;
  runDetailDate.dataset.category = categoryForActivity(run.type || "Running");
  selectedRunDetails = run;
  const runIndex = visibleRuns.indexOf(run);
  if (runIndex >= 0) {
    const page = Math.floor(runIndex / Number(runsPageSize.value));
    if (page !== runsPage) {
      runsPage = page;
      renderRunList(visibleRuns);
    }
  }
  runDetailPrevious.disabled = runIndex <= 0;
  runDetailNext.disabled = runIndex === -1 || runIndex >= visibleRuns.length - 1;
  const details = [
    ["Distance", Number.isFinite(run.distance) ? `${formatDistance(run.distance / 1000, 2)} km` : "—"],
    ["Duration", formatDuration(run.durationSeconds)],
    ["Average pace", formatPace(run.paceSecondsPerKm)],
    ["Average heart rate", Number.isFinite(run.averageHeartRate) ? `${Math.round(run.averageHeartRate)} bpm` : "—"],
  ];
  runDetailList.innerHTML = details.map(([label, value]) =>
    `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`,
  ).join("");
  const matchingRoutes = importedRoutes.filter((route) =>
    routeMatchesActivity(route, run, importedRuns),
  );
  const route = matchingRoutes.length === 1 ? matchingRoutes[0] : null;
  runDetailTitle.textContent = route?.name || run.type || "Running";
  runGarminLink.hidden = Boolean(route);
  const garminActivityLink = runGarminLink.querySelector("a");
  garminActivityLink.href = run.activityId
    ? `https://connect.garmin.com/modern/activity/${encodeURIComponent(run.activityId)}`
    : "https://connect.garmin.com/modern/activities";
  garminActivityLink.textContent = run.activityId
    ? "Open this activity in Garmin Connect ↗"
    : "Browse activities in Garmin Connect ↗";
  selectedRouteCoordinates = route ? getRouteSvgCoordinates(route.points) : [];
  runRouteSection.hidden = !route;
  mountBackgroundMap(runRouteChart, route ? renderRouteSvg(route.points) : "",
    route ? projectMapRoutes([route.points], 640, 250, 22).bounds : null);
  const routeElevations = route?.points.map((point) => point.elevation).filter(Number.isFinite) || [];
  runRouteFilename.textContent = route
    ? `${route.fileName}${routeElevations.length ? ` · Elevation ${Math.round(Math.min(...routeElevations))}–${Math.round(Math.max(...routeElevations))} m` : ""}`
    : "";
  hideChartTooltip();
  selectedHeartRatePoints = route?.points.filter((point) => Number.isFinite(point.heartRate)) || [];
  runHeartRateSection.hidden = selectedHeartRatePoints.length < 2;
  runHeartRateChart.innerHTML = selectedHeartRatePoints.length >= 2
    ? renderHeartRateSvg(selectedHeartRatePoints, (route.points.at(-1).index ?? route.points.length - 1) + 1)
    : "";
  selectedElevationPoints = route?.points.filter((point) => Number.isFinite(point.elevation)) || [];
  runElevationSection.hidden = selectedElevationPoints.length < 2;
  runElevationChart.innerHTML = selectedElevationPoints.length >= 2
    ? renderElevationSvg(selectedElevationPoints, (route.points.at(-1).index ?? route.points.length - 1) + 1)
    : "";
  if (!runDetailDialog.open) runDetailDialog.showModal();
}

function clearRunFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("run")) return;
  url.searchParams.delete("run");
  window.history.replaceState(null, "", url);
}

function syncRunDetailsFromUrl() {
  const runId = new URL(window.location.href).searchParams.get("run");
  if (runId === null) {
    if (runDetailDialog.open) closeRunDetails(false);
    return;
  }
  if (!/^\d+$/.test(runId)) {
    if (runDetailDialog.open) closeRunDetails(false);
    clearRunFromUrl();
    return;
  }
  const run = importedRuns[Number(runId)];
  if (!run) {
    if (runDetailDialog.open) closeRunDetails(false);
    clearRunFromUrl();
    return;
  }
  if (dashboard.dataset.activeView !== "runs") setDashboardView("runs");
  if (!visibleRuns.includes(run)) {
    dashboardPeriod.value = "all";
    refreshDashboard();
  }
  if (!runDetailDialog.open || selectedRunDetails !== run) showRunDetails(run);
}

function getRouteSvgCoordinates(points) {
  return projectMapRoutes([points], 640, 250, 22).coordinates[0];
}

function renderRouteSvg(points) {
  const coordinates = getRouteSvgCoordinates(points);
  const routePoints = coordinates.map(({ routeX, routeY }) => `${routeX.toFixed(2)},${routeY.toFixed(2)}`).join(" ");
  const start = coordinates[0];
  const end = coordinates.at(-1);
  const startAnchor = start.routeX < 320 ? "start" : "end";
  const endAnchor = end.routeX < 320 ? "start" : "end";
  const startLabelX = start.routeX + (startAnchor === "start" ? 8 : -8);
  const endLabelX = end.routeX + (endAnchor === "start" ? 8 : -8);
  return `<svg viewBox="0 0 640 250" role="img" aria-label="Imported GPS route shape, marked start and stop"><polyline points="${routePoints}"></polyline><circle class="run-route-start" cx="${start.routeX.toFixed(2)}" cy="${start.routeY.toFixed(2)}" r="5"></circle><text class="run-route-endpoint-label" x="${startLabelX.toFixed(2)}" y="${(start.routeY - 8).toFixed(2)}" text-anchor="${startAnchor}">START</text><circle class="run-route-end" cx="${end.routeX.toFixed(2)}" cy="${end.routeY.toFixed(2)}" r="5"></circle><text class="run-route-endpoint-label" x="${endLabelX.toFixed(2)}" y="${(end.routeY - 8).toFixed(2)}" text-anchor="${endAnchor}">STOP</text><circle class="run-route-hover-marker" cx="${start.routeX.toFixed(2)}" cy="${start.routeY.toFixed(2)}" r="7" visibility="hidden"></circle></svg>`;
}

function renderHeartRateSvg(points, totalPoints) {
  const values = points.map((point) => point.heartRate);
  const minimum = Math.floor(Math.min(...values) / 10) * 10;
  const maximum = Math.ceil(Math.max(...values) / 10) * 10;
  const range = Math.max(maximum - minimum, 10);
  const width = 640;
  const height = 180;
  const left = 42;
  const right = 12;
  const top = 12;
  const bottom = 24;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const coordinates = points.map((point) => {
    const x = left + (point.index / Math.max(totalPoints - 1, 1)) * plotWidth;
    const y = top + ((maximum - point.heartRate) / range) * plotHeight;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const firstPoint = points[0];
  const firstX = left + (firstPoint.index / Math.max(totalPoints - 1, 1)) * plotWidth;
  const firstY = top + ((maximum - firstPoint.heartRate) / range) * plotHeight;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Heart rate from ${Math.round(Math.min(...values))} to ${Math.round(Math.max(...values))} beats per minute">
    <line class="heart-rate-grid" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}"></line>
    <line class="heart-rate-grid" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line>
    <text class="heart-rate-label" x="${left - 7}" y="${top + 4}" text-anchor="end">${maximum}</text>
    <text class="heart-rate-label" x="${left - 7}" y="${height - bottom + 4}" text-anchor="end">${minimum}</text>
    <polyline points="${coordinates}"></polyline>
    <line class="heart-rate-hover-line" x1="${firstX.toFixed(2)}" y1="${top}" x2="${firstX.toFixed(2)}" y2="${height - bottom}" visibility="hidden"></line>
    <circle class="heart-rate-hover-marker" cx="${firstX.toFixed(2)}" cy="${firstY.toFixed(2)}" r="5" visibility="hidden"></circle>
    <text class="heart-rate-axis-label" x="${left}" y="${height - 4}">Activity progress</text>
    <text class="heart-rate-axis-label" x="${width - right}" y="${height - 4}" text-anchor="end">bpm</text>
  </svg>`;
}

function renderElevationSvg(points, totalPoints) {
  const values = points.map((point) => point.elevation);
  let minimum = Math.floor(Math.min(...values) / 10) * 10;
  let maximum = Math.ceil(Math.max(...values) / 10) * 10;
  if (minimum === maximum) {
    minimum -= 5;
    maximum += 5;
  }
  const width = 640;
  const height = 180;
  const left = 42;
  const right = 12;
  const top = 12;
  const bottom = 24;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const coordinates = points.map((point) => {
    const x = left + (point.index / Math.max(totalPoints - 1, 1)) * plotWidth;
    const y = top + ((maximum - point.elevation) / (maximum - minimum)) * plotHeight;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const firstPoint = points[0];
  const firstX = left + (firstPoint.index / Math.max(totalPoints - 1, 1)) * plotWidth;
  const firstY = top + ((maximum - firstPoint.elevation) / (maximum - minimum)) * plotHeight;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Elevation from ${Math.round(Math.min(...values))} to ${Math.round(Math.max(...values))} meters">
    <line class="run-profile-grid" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}"></line>
    <line class="run-profile-grid" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line>
    <text class="run-profile-label" x="${left - 7}" y="${top + 4}" text-anchor="end">${maximum}</text>
    <text class="run-profile-label" x="${left - 7}" y="${height - bottom + 4}" text-anchor="end">${minimum}</text>
    <polyline points="${coordinates}"></polyline>
    <line class="run-profile-hover-line" x1="${firstX.toFixed(2)}" y1="${top}" x2="${firstX.toFixed(2)}" y2="${height - bottom}" visibility="hidden"></line>
    <circle class="run-profile-hover-marker" cx="${firstX.toFixed(2)}" cy="${firstY.toFixed(2)}" r="5" visibility="hidden"></circle>
    <text class="run-profile-axis-label" x="${left}" y="${height - 4}">Activity progress</text>
    <text class="run-profile-axis-label" x="${width - right}" y="${height - 4}" text-anchor="end">m</text>
  </svg>`;
}

function updateRunHover(targetIndex) {
  if (selectedRouteCoordinates.length === 0) return;
  const routePoint = selectedRouteCoordinates.reduce((closest, point) =>
    Math.abs(point.index - targetIndex) < Math.abs(closest.index - targetIndex) ? point : closest,
  );
  const routeMarker = runRouteChart.querySelector(".run-route-hover-marker");
  routeMarker?.setAttribute("cx", routePoint.routeX.toFixed(2));
  routeMarker?.setAttribute("cy", routePoint.routeY.toFixed(2));
  routeMarker?.setAttribute("visibility", "visible");

  const plotLeft = 42;
  const plotWidth = 586;
  const totalPoints = (selectedRouteCoordinates.at(-1).index ?? selectedRouteCoordinates.length - 1) + 1;
  if (selectedHeartRatePoints.length >= 2) {
    const point = selectedHeartRatePoints.reduce((closest, candidate) =>
      Math.abs(candidate.index - targetIndex) < Math.abs(closest.index - targetIndex) ? candidate : closest,
    );
    const values = selectedHeartRatePoints.map((sample) => sample.heartRate);
    const minimum = Math.floor(Math.min(...values) / 10) * 10;
    const maximum = Math.ceil(Math.max(...values) / 10) * 10;
    const y = 12 + ((maximum - point.heartRate) / Math.max(maximum - minimum, 10)) * 144;
    updateProfileHover(runHeartRateChart, point.index, y, totalPoints, plotLeft, plotWidth);
  }
  if (selectedElevationPoints.length >= 2) {
    const point = selectedElevationPoints.reduce((closest, candidate) =>
      Math.abs(candidate.index - targetIndex) < Math.abs(closest.index - targetIndex) ? candidate : closest,
    );
    let minimum = Math.floor(Math.min(...selectedElevationPoints.map((sample) => sample.elevation)) / 10) * 10;
    let maximum = Math.ceil(Math.max(...selectedElevationPoints.map((sample) => sample.elevation)) / 10) * 10;
    if (minimum === maximum) {
      minimum -= 5;
      maximum += 5;
    }
    const y = 12 + ((maximum - point.elevation) / (maximum - minimum)) * 144;
    updateProfileHover(runElevationChart, point.index, y, totalPoints, plotLeft, plotWidth);
  }
}

function updateProfileHover(chartElement, index, y, totalPoints, plotLeft, plotWidth) {
  const svg = chartElement.querySelector("svg");
  if (!svg) return;
  const marker = svg.querySelector(".heart-rate-hover-marker, .run-profile-hover-marker");
  const line = svg.querySelector(".heart-rate-hover-line, .run-profile-hover-line");
  const x = plotLeft + (index / Math.max(totalPoints - 1, 1)) * plotWidth;
  marker?.setAttribute("cx", x.toFixed(2));
  marker?.setAttribute("cy", y.toFixed(2));
  marker?.setAttribute("visibility", "visible");
  line?.setAttribute("x1", x.toFixed(2));
  line?.setAttribute("x2", x.toFixed(2));
  line?.setAttribute("visibility", "visible");
}

function handleProfileHover(event, chartElement) {
  const svg = chartElement.querySelector("svg");
  if (!svg || selectedRouteCoordinates.length === 0) return;
  const bounds = svg.getBoundingClientRect();
  if (!bounds.width) return;
  const chartX = ((event.clientX - bounds.left) / bounds.width) * 640;
  const progress = Math.max(0, Math.min(1, (chartX - 42) / 586));
  const totalPoints = (selectedRouteCoordinates.at(-1).index ?? selectedRouteCoordinates.length - 1) + 1;
  const targetIndex = progress * Math.max(totalPoints - 1, 1);
  updateRunHover(targetIndex);
  showProfileTooltip(targetIndex, chartElement, event);
}

function handleRouteHover(event) {
  if (event.buttons || event.target.closest?.('.leaflet-control')) { hideRunHover(); return; }
  const svg = runRouteChart.querySelector("svg");
  if (!svg || (selectedHeartRatePoints.length < 2 && selectedElevationPoints.length < 2)) return;
  const bounds = svg.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const x = ((event.clientX - bounds.left) / bounds.width) * 640;
  const y = ((event.clientY - bounds.top) / bounds.height) * 250;
  const closestPoint = selectedRouteCoordinates.reduce((closest, point) => {
    const distance = (point.routeX - x) ** 2 + (point.routeY - y) ** 2;
    return distance < closest.distance ? { point, distance } : closest;
  }, { point: selectedRouteCoordinates[0], distance: Infinity }).point;
  updateRunHover(closestPoint.index);
  showProfileTooltip(closestPoint.index, runRouteChart, event);
}

function showProfileTooltip(targetIndex, chartElement, event) {
  const isElevation = chartElement === runElevationChart;
  const samples = isElevation || !selectedHeartRatePoints.length ? selectedElevationPoints : selectedHeartRatePoints;
  if (!samples.length) return;
  const point = samples.reduce((closest, candidate) =>
    Math.abs(candidate.index - targetIndex) < Math.abs(closest.index - targetIndex) ? candidate : closest);
  const key = isElevation || !selectedHeartRatePoints.length ? "elevation" : "heartRate";
  const total = selectedRouteCoordinates.at(-1)?.index || 1;
  chartTooltip.children[0].textContent = `${Math.round(point.index / total * 100)}% through activity`;
  chartTooltip.children[1].textContent = `${point[key]} ${key === "elevation" ? "m" : "bpm"}`;
  chartTooltip.children[2].textContent = key === "elevation" ? "Elevation" : "Heart rate";
  chartTooltip.children[3].textContent = "Recorded sample";
  positionChartTooltip(event.clientX, event.clientY);
}

for (const [chartElement, inspect] of [
  [runRouteChart, handleRouteHover],
  [runHeartRateChart, (event) => handleProfileHover(event, runHeartRateChart)],
  [runElevationChart, (event) => handleProfileHover(event, runElevationChart)],
]) {
  chartElement.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "touch") inspect(event);
  });
  // Touch scrolling cancels the pointer; a completed tap inspects the chart once.
  chartElement.addEventListener("pointerup", (event) => {
    if (event.pointerType === "touch") inspect(event);
  });
}

function hideRunHover() {
  hideChartTooltip();
  runRouteChart.querySelector(".run-route-hover-marker")?.setAttribute("visibility", "hidden");
  runHeartRateChart.querySelector(".heart-rate-hover-marker")?.setAttribute("visibility", "hidden");
  runHeartRateChart.querySelector(".heart-rate-hover-line")?.setAttribute("visibility", "hidden");
  runElevationChart.querySelector(".run-profile-hover-marker")?.setAttribute("visibility", "hidden");
  runElevationChart.querySelector(".run-profile-hover-line")?.setAttribute("visibility", "hidden");
}

runHeartRateChart.addEventListener("pointerleave", event => { if (event.pointerType !== "touch") hideRunHover(); });
runHeartRateChart.addEventListener("pointercancel", hideRunHover);
runElevationChart.addEventListener("pointerleave", event => { if (event.pointerType !== "touch") hideRunHover(); });
runElevationChart.addEventListener("pointercancel", hideRunHover);
runRouteChart.addEventListener("pointerleave", event => { if (event.pointerType !== "touch") hideRunHover(); });
runRouteChart.addEventListener("pointercancel", hideRunHover);
runRouteChart.addEventListener("pointerdown", hideRunHover);
runRouteChart.addEventListener("wheel", hideRunHover, { passive: true });

function inferGpxCategory(text) {
  const normalized = text.toLowerCase();
  for (const keyword of ["trail", "run", "running", "cycling", "bike", "biking", "walk", "hike", "swim", "strength", "climb", "yoga"]) {
    if (normalized.includes(keyword)) return categoryForActivity(keyword);
  }
  return null;
}

function parseGpx(text, fileName) {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "gpx") {
    throw new Error(`${fileName} is not a valid GPX file.`);
  }
  const trackPoints = [...document.getElementsByTagNameNS("*", "trkpt"), ...document.getElementsByTagNameNS("*", "rtept")];
  const points = trackPoints
    .map((point) => {
      const elevationText = point.getElementsByTagNameNS("*", "ele")[0]?.textContent.trim();
      return {
        lat: Number(point.getAttribute("lat")),
        lon: Number(point.getAttribute("lon")),
        elevation: elevationText ? Number(elevationText) : Number.NaN,
        time: point.getElementsByTagNameNS("*", "time")[0]?.textContent.trim() || "",
        heartRate: Number(point.getElementsByTagNameNS("*", "hr")[0]?.textContent.trim()),
      };
    })
    .filter((point) => Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90
      && Number.isFinite(point.lon) && point.lon >= -180 && point.lon <= 180);
  if (points.length < 2) throw new Error(`${fileName} needs at least two valid GPS points.`);
  const firstTimestamp = points.find((point) => point.time)?.time;
  const metadataTimestamp = document.getElementsByTagNameNS("*", "metadata")[0]
    ?.getElementsByTagNameNS("*", "time")[0]?.textContent.trim();
  const parsedTime = firstTimestamp || metadataTimestamp;
  if (!parsedTime || Number.isNaN(new Date(parsedTime).getTime())) {
    throw new Error(`${fileName} has no usable activity date in its GPS data.`);
  }
  const date = dateKey(new Date(parsedTime));
  const name = [...document.getElementsByTagNameNS("*", "name")][0]?.textContent.trim() || "";
  const step = Math.max(1, Math.ceil(points.length / 1000));
  return {
    fileName,
    name,
    date,
    category: inferGpxCategory(`${fileName} ${name}`),
    points: points
      .map((point, index) => ({ ...point, index }))
      .filter((point) => point.index % step === 0 || point.index === points.length - 1)
      .map(({ lat, lon, elevation, heartRate, index }) => ({
        lat,
        lon,
        ...(Number.isFinite(elevation) ? { elevation } : {}),
        ...(Number.isFinite(heartRate) && heartRate > 0 ? { heartRate } : {}),
        index,
      })),
  };
}

async function persistImportedData() {
  try {
    await saveImportedData({
      version: 4,
      fileName: importedFileName,
      runs: importedRuns,
      activities: importedActivities,
      routes: importedRoutes,
      sleep: importedSleep,
      distanceUnit: "m",
    });
    return true;
  } catch {
    showError("Your imported data is loaded, but this browser could not save it. They will be lost when you close this page.");
    return false;
  }
}

async function importGpxFiles(files) {
  if (!files.length || csvImportInProgress) return;
  csvImportInProgress = true;
  [...importButtons, zipImportButton, gpxImportButton, unloadDataButton].forEach(button => { button.disabled = true; });
  try {
    notice.hidden = true;
    let importedCount = 0;
    const errors = [];
    for (const file of files) {
      try {
        const route = parseGpx(await file.text(), file.name);
        const candidates = importedRuns.filter((run) => run.date === route.date
          && (!route.category || categoryForActivity(run.type || "Running") === route.category));
        if (candidates.length !== 1) {
          errors.push(candidates.length
            ? `${file.name}: multiple runs match its date${route.category ? " and activity type" : ""}.`
            : `${file.name}: no run matches its date${route.category ? " and activity type" : ""}.`);
          continue;
        }
        route.category = categoryForActivity(candidates[0].type || "Running");
        route.activityId = candidates[0].activityId;
        route.startTime = candidates[0].startTime;
        const existingIndex = importedRoutes.findIndex((existing) =>
          routeMatchesActivity(existing, candidates[0], importedRuns),
        );
        if (existingIndex === -1) importedRoutes.push(route);
        else importedRoutes[existingIndex] = route;
        importedCount += 1;
      } catch (error) {
        errors.push(error.message || `Could not read ${file.name}.`);
      }
    }
    if (importedCount) {
      if (!await persistImportedData()) {
        gpxInput.value = "";
        return;
      }
      renderRunList(visibleRuns);
      renderHeatmap();
      if (runDetailDialog.open && selectedRunDetails) showRunDetails(selectedRunDetails);
    }
    if (errors.length) {
      notice.textContent = `${importedCount ? `Imported ${importedCount} GPX route${importedCount === 1 ? "" : "s"}. ` : ""}${errors.join(" ")}`;
      notice.hidden = false;
    } else if (importedCount && !notice.textContent.startsWith("Your activities and routes are loaded")) {
      showNotice(`Imported ${importedCount} GPX route${importedCount === 1 ? "" : "s"}.`, "success");
    }
    gpxInput.value = "";
  } finally {
    csvImportInProgress = false;
    [...importButtons, zipImportButton, gpxImportButton, unloadDataButton].forEach(button => { button.disabled = false; });
  }
}

runsList.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-run-index]");
  if (!row) return;
  const run = visibleRuns[Number(row.dataset.runIndex)];
  if (run) showRunDetails(run, true);
});
function showAdjacentRun(offset) {
  const currentIndex = visibleRuns.indexOf(selectedRunDetails);
  const nextRun = visibleRuns[currentIndex + offset];
  if (runDetailDialog.open && nextRun) showRunDetails(nextRun, true);
}

runDetailPrevious.addEventListener("click", () => showAdjacentRun(-1));
runDetailNext.addEventListener("click", () => showAdjacentRun(1));
runDetailDialog.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" && !runDetailPrevious.disabled) {
    event.preventDefault();
    showAdjacentRun(-1);
  } else if (event.key === "ArrowRight" && !runDetailNext.disabled) {
    event.preventDefault();
    showAdjacentRun(1);
  }
});

function closeRunDetails(updateUrl = true) {
  hideChartTooltip();
  if (runDetailDialog.open && !runDetailDialog.classList.contains("is-closing")) {
    if (updateUrl) clearRunFromUrl();
    runDetailDialog.classList.add("is-closing");
    runDetailCloseTimer = setTimeout(finishRunDetailsClose, 200);
  }
}

function finishRunDetailsClose() {
  clearTimeout(runDetailCloseTimer);
  runDetailCloseTimer = undefined;
  if (!runDetailDialog.classList.contains("is-closing")) return;
  runDetailDialog.close();
  runDetailDialog.classList.remove("is-closing");
}

runDetailDialog.addEventListener("animationend", (event) => {
  if (event.target === runDetailDialog && event.animationName === "run-dialog-fade-out") {
    finishRunDetailsClose();
  }
});

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
    const markers = categories.map(activityIcon).join("");
    const background = categories.length === 1
      ? activityCategories[categories[0]].background
      : `linear-gradient(135deg, ${categories.map((category, index) =>
        `${activityCategories[category].background} ${index / categories.length * 100}% ${(index + 1) / categories.length * 100}%`,
      ).join(", ")})`;
    const backgroundStyle = activity ? ` style="--calendar-background: ${background}"` : "";
    const runTooltip = `<span class="calendar-tooltip" aria-hidden="true"><strong>${escapeHtml(fullDate)}</strong>${activityDetails || "<span>No activity details</span>"}</span>`;
    const activityAccessibleDetails = (activity?.items || []).map((item) => {
      const category = categoryForActivity(item.type);
      return ["running", "trail", "cycling"].includes(category)
        ? `${item.type}: distance ${Number.isFinite(item.distance) ? `${formatDistance(item.distance / 1000, 2)} kilometers` : "unavailable"}, time ${formatDuration(item.durationSeconds)}, pace ${formatPace(item.paceSecondsPerKm)}.`
        : `${item.type}: time ${formatDuration(item.durationSeconds)}, average heart rate ${Number.isFinite(item.averageHeartRate) ? `${Math.round(item.averageHeartRate)} beats per minute` : "unavailable"}.`;
    }).join(" ");
    const accessibleDescription = `${description}. ${activityAccessibleDetails}`;
    dayCells.push(
      `<td class="${activity ? `calendar-active${categories.length === 1 ? ` activity-${categories[0]}` : " activity-mixed"}` : ""}"${activity ? ` data-activity-categories="${categories.join(" ")}"` : ""}${backgroundStyle} title="${description}" aria-label="${escapeHtml(accessibleDescription)}"${activity ? ' tabindex="0"' : ""}><span>${day}</span>${markers ? `<span class="calendar-markers">${markers}</span>` : ""}${activity ? runTooltip : ""}</td>`,
    );
  }

  calendarDays.innerHTML = Array.from({ length: rows }, (_, row) =>
    `<tr>${dayCells.slice(row * 7, row * 7 + 7).join("")}</tr>`,
  ).join("");
  document.querySelector("#calendar-month").textContent = formatDate(calendarMonth, { month: "long" });
  document.querySelector("#calendar-year").textContent = String(calendarMonth.getFullYear());
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
    ? activeCategories.map((category) => `<span class="calendar-legend-item" data-category="${category}" tabindex="0" aria-label="Highlight ${activityCategories[category].label} activities">${activityIcon(category)}${activityCategories[category].label}</span>`).join("")
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

function renderSummary() {
  if (!importedRuns.length) return;
  const isCalendar = dashboard.dataset.activeView === "calendar";
  const summary = summarizeTraining(importedRuns, importedActivities, {
    month: isCalendar ? calendarMonth : null,
    period: dashboardPeriod.value,
  });
  document.querySelector("#summary-distance").textContent = formatDistance(summary.distanceKm);
  document.querySelector("#summary-runs").textContent = summary.runCount.toLocaleString();
  document.querySelector("#summary-active-days").textContent = summary.activeDays.toLocaleString();
  document.querySelector("#summary-period").textContent = isCalendar && calendarMonth
    ? `${formatDate(calendarMonth, { month: "long", year: "numeric" })} · All activity types`
    : `${dashboardPeriod.selectedOptions[0].textContent} · All activity types`;
}

const heatmapCard = document.querySelector(".heatmap-card");
const heatmapExpandedKey = "stride-heatmap-expanded";
try {
  heatmapCard.open = localStorage.getItem(heatmapExpandedKey) === "true";
} catch {
  // Keep the default when browser storage is unavailable.
}
heatmapCard.addEventListener("toggle", () => {
  try {
    localStorage.setItem(heatmapExpandedKey, String(heatmapCard.open));
  } catch {
    // Expansion still works when preferences cannot be saved.
  }
});

const heatmapTypeMenu = document.querySelector("#heatmap-type-menu");
const heatmapTypeChoices = document.querySelector("#heatmap-type-choices");
const heatmapTypeLabel = document.querySelector("#heatmap-type-label");
let heatmapTypeSelection = new Set();
let heatmapSelectionTouched = false;
let heatmapGroups = new Map();

function updateHeatmapTypeChoices(rebuild) {
  const types = [...heatmapGroups.keys()].sort();
  heatmapTypeSelection = heatmapSelectionTouched
    ? normalizeHeatmapSelection(heatmapTypeSelection, types) : defaultHeatmapSelection(types);
  if (rebuild) {
    const countTypes = members => members.reduce((sum, type) => sum + heatmapGroups.get(type).length, 0);
    const byCount = (left, right) => right[2] - left[2] || left[1].localeCompare(right[1]);
    const shortcuts = [['all', 'All', countTypes(types)],
      ...HEATMAP_TYPE_GROUPS.map(group => [group.id, group.label, countTypes(heatmapGroupTypes(group.id, types))]).filter(([, , count]) => count >= 1).sort(byCount)];
    const individual = types.map(type => [type, type.replace(/\b[a-z]/g, character => character.toUpperCase()), heatmapGroups.get(type).length]).sort(byCount);
    const renderOptions = options => options.map(([type, label, count]) =>
      `<label class="heatmap-type-option"><input type="checkbox" value="${escapeHtml(type)}" aria-controls="run-heatmap"${count ? '' : ' disabled'}><span>${escapeHtml(label)} (${count})</span></label>`).join('');
    heatmapTypeChoices.innerHTML = `<div class="heatmap-type-shortcuts" role="group" aria-label="Activity groups">${renderOptions(shortcuts)}</div>
      <div class="heatmap-type-individual" role="group" aria-labelledby="heatmap-individual-label"><p id="heatmap-individual-label">Individual types</p>${renderOptions(individual)}</div>`;
  }
  for (const input of heatmapTypeChoices.querySelectorAll('input')) {
    const state = heatmapOptionState(heatmapTypeSelection, types, input.value);
    input.checked = state.checked;
    input.indeterminate = state.indeterminate;
  }
  const count = selectedHeatmapRoutes(heatmapGroups, heatmapTypeSelection).length;
  const exactGroup = HEATMAP_TYPE_GROUPS.find(group => {
    const members = heatmapGroupTypes(group.id, types);
    return members.length > 0 && members.length === heatmapTypeSelection.size && members.every(type => heatmapTypeSelection.has(type));
  });
  heatmapTypeLabel.textContent = !heatmapSelectionTouched ? `Running / Trail (${count})`
    : heatmapTypeSelection.has('all') ? `All (${count})`
    : exactGroup ? `${exactGroup.label} (${count})`
    : heatmapTypeSelection.size ? `${heatmapTypeSelection.size} selected (${count})` : 'None (0)';
}
let heatmapRoutes = [];
let heatmapRoutesSnapshot;
let heatmapActivitiesSnapshot;
let heatmapTypeSnapshot;

function updateHeatmapSummary(model, visibleArea = false) {
  document.querySelector("#run-heatmap-legend").hidden = model.maxCount <= 1;
  document.querySelector("#run-heatmap-summary").textContent = model.routeCount
    ? `${model.routeCount} ${model.routeCount === 1 ? "activity" : "activities"} ${visibleArea ? "in this area" : "with GPS routes"} · Most visited area: ${model.maxCount} ${model.maxCount === 1 ? "activity" : "activities"}`
    : heatmapTypeSelection.size === 0 ? "Select activity types to show their routes."
      : visibleArea ? "No matching activity routes in this area" : "No GPS routes imported";
}

function renderHeatmap() {
  const routesSnapshot = importedRoutes.slice();
  const sameData = heatmapActivitiesSnapshot === importedActivities && heatmapRoutesSnapshot
    && routesSnapshot.length === heatmapRoutesSnapshot.length
    && routesSnapshot.every((route, index) => route === heatmapRoutesSnapshot[index]);
  const selectionKey = JSON.stringify([...heatmapTypeSelection].sort());
  if (sameData && heatmapTypeSnapshot === selectionKey) return;
  if (!sameData) heatmapGroups = groupHeatmapRoutes(importedRoutes, importedActivities);
  updateHeatmapTypeChoices(!sameData);
  heatmapActivitiesSnapshot = importedActivities;
  heatmapRoutesSnapshot = routesSnapshot;
  heatmapTypeSnapshot = JSON.stringify([...heatmapTypeSelection].sort());
  heatmapRoutes = selectedHeatmapRoutes(heatmapGroups, heatmapTypeSelection);
  const element = document.querySelector("#run-heatmap");
  // A new selection gets an overview of all its routes. Subsequent map moves
  // recalculate the overlay in place through recalculateHeatmap.
  const model = buildRunHeatmap(heatmapRoutes);
  mountBackgroundMap(element, model.routeCount ? renderRunHeatmap(model) : "", model.bounds, {
    onViewportChange: recalculateHeatmap,
    fullscreenControls: document.querySelector(".heatmap-controls"),
  });
  const empty = document.querySelector("#run-heatmap-empty");
  empty.hidden = heatmapRoutes.length > 0;
  empty.textContent = heatmapGroups.size ? "Select activity types to show their routes."
    : "Import a Garmin ZIP or GPX routes from the Import menu to see your activity routes.";
  updateHeatmapSummary(model);
}

heatmapTypeChoices.addEventListener("change", event => {
  const input = event.target.closest('input[type="checkbox"]');
  if (!input) return;
  heatmapSelectionTouched = true;
  heatmapTypeSelection = toggleHeatmapType(heatmapTypeSelection, [...heatmapGroups.keys()], input.value, input.checked);
  renderHeatmap();
});
heatmapTypeMenu.addEventListener("keydown", event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    heatmapTypeMenu.open = false;
    heatmapTypeMenu.querySelector('summary').focus();
  }
});
document.addEventListener('click', event => {
  if (!heatmapTypeMenu.contains(event.target)) heatmapTypeMenu.open = false;
});

function recalculateHeatmap() {
  const element = document.querySelector("#run-heatmap");
  const viewport = getMapViewport(element);
  if (!viewport) return;
  const model = buildRunHeatmap(heatmapRoutes, viewport);
  if (!updateMapOverlay(element, renderRunHeatmap(model), viewport.bounds)) return;
  updateHeatmapSummary(model, true);
}

function refreshDashboard() {
  if (dashboard.dataset.activeView === "sleep") {
    renderSleep(sleepView, importedSleep, dashboardPeriod.value, sleepPage);
    document.querySelector("#summary-period").textContent = "Sleep history · " + dashboardPeriod.selectedOptions[0].textContent;
    return;
  }
  if (importedRuns.length === 0) return;
  hideChartTooltip();
  renderRuns(importedRuns, dashboardPeriod.value);
  renderSummary();
  renderHeatmap();
}

calendarPrev.addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  refreshDashboard();
});
calendarNext.addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  refreshDashboard();
});

for (const [id, years] of [["calendar-prev-year", -1], ["calendar-next-year", 1]]) {
  document.querySelector(`#${id}`).addEventListener("click", () => {
    calendarMonth = new Date(calendarMonth.getFullYear() + years, calendarMonth.getMonth(), 1);
    refreshDashboard();
  });
}

function setImportedState() {
  const hasRuns = importedRuns.length > 0;
  dashboard.hidden = !hasRuns;
  dashboardNav.hidden = !hasRuns;
  dashboardPeriodControl.hidden = !hasRuns || dashboard.dataset.activeView === "calendar";
  gpxImportButton.hidden = !hasRuns;
  gpxImportButton.closest(".import-menu-row").hidden = !hasRuns;
  if (!hasRuns) document.querySelector("#import-gpx-help").hidden = true;
  unloadDataButton.hidden = !hasRuns;
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

async function unloadImportedData() {
  if (csvImportInProgress) return;
  if (!window.confirm("Unload all imported activities, routes and sleep history from this browser? The original files on your device will not be deleted.")) return;
  try {
    await clearImportedData();
  } catch {
    showError("Could not remove the saved activities from this browser.");
    return;
  }
  if (runDetailDialog.open) closeRunDetails(false);
  clearRunFromUrl();
  importedRuns = [];
  importedActivities = [];
  importedSleep = [];
  importedFileName = "";
  importedRoutes = [];
  visibleRuns = [];
  runsPage = 0;
  selectedRunDetails = null;
  selectedRouteCoordinates = [];
  selectedHeartRatePoints = [];
  selectedElevationPoints = [];
  calendarMonth = null;
  notice.hidden = true;
  setImportedState();
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
    if (isSelected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }

  for (const panel of panels) {
    const isSelected = panel.id === `${activeView}-view`;
    panel.hidden = !isSelected;
    panel.inert = !isSelected;
    if (isSelected) panel.removeAttribute("aria-hidden");
    else panel.setAttribute("aria-hidden", "true");
  }

  hideChartTooltip();
  if (dashboard.dataset.activeView !== activeView) {
    const container = activeView === "runs" ? chart : activeView === "weekday" ? activityFrequencyChart : activeView === "sleep" ? sleepView : null;
    const scroll = container?.querySelector(".running-load-plot-scroll, .frequency-chart-scroll, .sleep-plot-scroll");
    if (scroll) scroll.scrollLeft = scroll.scrollWidth;
  }
  if (activeView === "runs") refreshChartLatestButton(chart, runningLoadLatest);
  if (activeView === "weekday") refreshChartLatestButton(activityFrequencyChart, activityTimelineLatest);
  dashboard.dataset.activeView = activeView;
  document.querySelector(".summary-grid").hidden = activeView === "sleep";
  document.querySelector(".page-heading .eyebrow").textContent = activeView === "sleep" ? "Your wellbeing" : "Your training";
  document.querySelector("#view-title").textContent = {
    calendar: "Training calendar", runs: "Your running", weekday: "Activity patterns", sleep: "Your sleep",
  }[activeView];
  dashboardPeriodControl.hidden = !importedRuns.length || activeView === "calendar";
  refreshDashboard();
  if (activeView !== "runs" && runDetailDialog.open) closeRunDetails(false);
  if (updateUrl) {
    const url = new URL(window.location.href);
    if (activeView !== "runs") url.searchParams.delete("run");
    if (url.hash !== `#${activeView}` || url.href !== window.location.href) {
      url.hash = activeView;
      window.history.pushState(null, "", url);
    }
  }
}

async function connectDevReload() {
  try {
    const response = await fetch(new URL("__dev/status", window.location.href));
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Development reload status failed: ${response.status}`);
    const { enabled } = await response.json();
    if (!enabled) return;

    const events = new EventSource(new URL("__dev/events", window.location.href));
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
  if (!file || csvImportInProgress) return;
  if (!/\.(csv|zip)$/i.test(file.name)) {
    showError("Choose a Garmin activities CSV or data export ZIP file.");
    return;
  }
  const isZip = /\.zip$/i.test(file.name);
  csvImportInProgress = true;
  zipImportButton.disabled = true;
  gpxImportButton.disabled = true;
  unloadDataButton.disabled = true;
  importProgress.hidden = !isZip;
  cancelImportButton.disabled = false;
  importProgressText.textContent = "Reading Garmin ZIP…";
  importButtons.forEach((button) => { button.disabled = true; });
  csvDropZone.setAttribute("aria-busy", "true");
  notice.hidden = true;
  try {
    const result = isZip ? await readGarminZip(file)
      : parseGarminCsv(await file.text(), "km", { requireRuns: importedRuns.length === 0 });
    if (isZip) {
      importProgressText.textContent = "Saving activities, routes and sleep…";
      cancelImportButton.disabled = true;
    }
    const { activities } = result;
    const mergedActivities = mergeActivities(importedActivities, activities, { preserveMissing: true });
    const added = mergedActivities.length - importedActivities.length;
    const mergedRuns = runningActivities(mergedActivities);
    if (!mergedRuns.length) throw new Error("No running activities with valid dates and distances were found in this export.");
    if (runDetailDialog.open) closeRunDetails();
    clearRunFromUrl();
    selectedRunDetails = null;
    importedRuns = mergedRuns;
    importedActivities = mergedActivities;
    importedFileName = file.name;
    importedRoutes = mergeRoutes(importedRoutes, result.routes || []);
    importedSleep = mergeSleep(importedSleep, result.sleep || []);
    sleepPage = 0;
    calendarMonth = null;
    const savedSuccessfully = await persistImportedData();
    setImportedState();
    refreshDashboard();
    if (isZip && savedSuccessfully) {
      showNotice(`Imported Garmin history: ${added} added, ${activities.length - added} matched existing activities. ${result.routes.length} GPS routes and ${result.sleep.length} sleep nights imported. ${result.routeStats.failed} recordings could not be read; ${result.routeStats.unmatched} route recordings had no unique activity match. ${result.skipped} invalid records and ${result.parents} multisport parent records skipped.`, "success");
    }
  } catch (error) {
    if (error.name === "AbortError") showNotice("Import cancelled. Your saved activities are unchanged.", "success");
    else showError(error.message || "Could not read the selected activity file.");
  } finally {
    csvImportInProgress = false;
    importProgress.hidden = true;
    zipImportButton.disabled = false;
    gpxImportButton.disabled = false;
    unloadDataButton.disabled = false;
    csvInput.value = "";
    importButtons.forEach((button) => { button.disabled = false; });
    csvDropZone.removeAttribute("aria-busy");
  }
}

for (const button of importButtons) {
  button.addEventListener("click", () => {
    importMenu.open = false;
    csvInput.value = "";
    csvInput.accept = button.id === "import-cta" ? ".csv,.zip,text/csv,application/zip" : ".csv,text/csv";
    csvInput.click();
  });
}
dashboardNav.addEventListener("click", (event) => {
  const button = event.target.closest(".dashboard-nav-item");
  if (!button) return;
  setDashboardView(button.dataset.view, true);
});
document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  setDashboardView("calendar", true);
});
function handleLocationChange() {
  setDashboardView(window.location.hash.slice(1));
  syncRunDetailsFromUrl();
}
window.addEventListener("popstate", handleLocationChange);
window.addEventListener("hashchange", handleLocationChange);
setDashboardView(window.location.hash.slice(1));
connectDevReload();
csvInput.addEventListener("change", () => importFile(csvInput.files[0]));
gpxImportButton.addEventListener("click", () => {
  importMenu.open = false;
  gpxInput.value = "";
  gpxInput.click();
});
gpxInput.addEventListener("change", () => importGpxFiles([...gpxInput.files]));
unloadDataButton.addEventListener("click", () => {
  importMenu.open = false;
  unloadImportedData();
});
dashboardPeriod.addEventListener("change", () => {
  sleepPage = 0;
  runsPage = 0;
  refreshDashboard();
});
rollingPeriod.addEventListener("change", refreshDashboard);
showRollingTotal.addEventListener("change", refreshDashboard);

const importHelpButtons = [...document.querySelectorAll('.import-help-button')];
function closeImportHelp() {
  for (const button of importHelpButtons) {
    button.setAttribute('aria-expanded', 'false');
    document.getElementById(button.getAttribute('aria-controls')).hidden = true;
  }
}
for (const button of importHelpButtons) {
  button.addEventListener('click', () => {
    const wasExpanded = button.getAttribute('aria-expanded') === 'true';
    closeImportHelp();
    if (!wasExpanded) {
      button.setAttribute('aria-expanded', 'true');
      document.getElementById(button.getAttribute('aria-controls')).hidden = false;
    }
  });
}
importMenu.addEventListener('toggle', () => { if (!importMenu.open) closeImportHelp(); });

// Native details keeps the import actions keyboard accessible without a custom menu widget.
document.addEventListener("click", (event) => {
  if (!importMenu.contains(event.target)) importMenu.open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && importMenu.open) {
    importMenu.open = false;
    importMenu.querySelector("summary").focus();
  }
});
document.addEventListener("focusin", (event) => {
  if (!importMenu.contains(event.target)) importMenu.open = false;
});

let dragDepth = 0;
csvDropZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  csvDropZone.classList.add("is-dragging");
});
csvDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
csvDropZone.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) csvDropZone.classList.remove("is-dragging");
});
csvDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  csvDropZone.classList.remove("is-dragging");
  const files = [...event.dataTransfer.files];
  if (files.length !== 1 || !/\.(csv|zip)$/i.test(files[0].name)) {
    showError("Choose one Garmin activities CSV or data export ZIP file.");
    return;
  }
  importFile(files[0]);
});
// Prevent the browser from navigating away if a file misses the drop target.
for (const eventName of ["dragover", "drop"]) {
  window.addEventListener(eventName, (event) => {
    if ([...event.dataTransfer.types].includes("Files")) event.preventDefault();
  });
}
let resizeTimer;
let dashboardViewportWidth = window.innerWidth;
window.addEventListener("resize", () => {
  if (window.innerWidth === dashboardViewportWidth) return;
  dashboardViewportWidth = window.innerWidth;
  hideChartTooltip();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(refreshDashboard, 150);
});

csvImportInProgress = true;
[...importButtons, zipImportButton, gpxImportButton, unloadDataButton].forEach(button => { button.disabled = true; });
try {
  const saved = await loadImportedData();
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
      : importedRuns.map((run) => ({ ...run, type: run.type || "Running" }));
    importedSleep = Array.isArray(saved.sleep) ? saved.sleep.filter(night => typeof night.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(night.date)) : [];
    importedFileName = saved.fileName || "";
    importedRoutes = Array.isArray(saved.routes) ? saved.routes.filter((route) =>
      typeof route.date === "string"
      && typeof route.category === "string"
      && typeof route.fileName === "string"
      && Array.isArray(route.points)
      && route.points.length > 1
      && route.points.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)),
    ) : [];
    const hasSavedActivityTypes = Array.isArray(saved.activities);
    if (saved.version !== 4 || saved.distanceUnit !== "m" || !hasSavedActivityTypes) {
      try {
        await saveImportedData({
          version: saved.version === 4 ? 4 : saved.version === 3 ? 3 : saved.version === 2 ? 2 : 1,
          fileName: importedFileName,
          runs: importedRuns,
          activities: importedActivities,
          routes: importedRoutes,
          distanceUnit: "m",
        });
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
  showError("Saved activities could not be read. Please import your Garmin export again.");
} finally {
  csvImportInProgress = false;
  [...importButtons, zipImportButton, gpxImportButton, unloadDataButton].forEach(button => { button.disabled = false; });
}
setImportedState();
syncRunDetailsFromUrl();
