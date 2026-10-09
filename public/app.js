import { normalizeStoredRuns, parseGarminCsv } from "./csv.js";

const dashboard = document.querySelector("#dashboard");
const dashboardNav = document.querySelector("#dashboard-nav");
const connectState = document.querySelector("#connect-state");
const notice = document.querySelector("#notice");
const rangeSelect = document.querySelector("#range-select");
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
const weekdayPeriod = document.querySelector("#weekday-period");
const chart = document.querySelector("#chart");
const importButtons = [document.querySelector("#import-button"), document.querySelector("#import-cta")];
let importedRuns = [];
let importedActivities = [];
let importedFileName = "";
let calendarMonth = null;

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

  for (let value = 0; value <= maxY; value += maxY <= 10 ? 2 : 5) {
    const position = y(value);
    grid.push(`<line class="grid-line" x1="${left}" y1="${position}" x2="${width - right}" y2="${position}"></line>`);
    grid.push(`<text class="axis-label" x="${left - 10}" y="${position + 3}" text-anchor="end">${value}</text>`);
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
  const labelStep = Math.max(1, Math.ceil(dates.length / 7));
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

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily running distance bars, ${averageDays}-day rolling average line, and ${totalDays}-day rolling total line. All use the same vertical scale in kilometers">
    ${grid.join("")}
    <path class="avg-area" d="${areaPath}"></path>
    ${bars}
    <path class="avg-path" d="${linePath}"></path>
    <path class="sum-path" d="${totalPath}"></path>
    ${points}
    ${totalMarkers}
    ${labels}
  </svg>`;
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

function hideChartTooltip() {
  chartTooltip.classList.remove("visible");
  chartTooltip.setAttribute("aria-hidden", "true");
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

function renderRuns(runs, days) {
  const totals = new Map();
  for (const run of runs) totals.set(run.date, (totals.get(run.date) || 0) + run.distance / 1000);
  renderCalendar(importedActivities, runs);
  renderWeekdayFrequency(importedActivities, weekdayPeriod.value);

  const windowDays = Number(rollingPeriod.value);
  const lookback = windowDays - 1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
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
  const periodRuns = runs
    .filter((run) => run.date >= dateKey(visibleDates[0]) && run.date <= dateKey(visibleDates.at(-1)))
    .sort((left, right) => right.date.localeCompare(left.date));
  document.querySelector("#chart").innerHTML = makeChart(visibleDaily, visibleDates, visibleRolling, visibleTotals, windowDays, windowDays);
  document.querySelector("#chart").setAttribute("aria-label", `Running distance with ${windowDays}-day rolling average and ${windowDays}-day rolling total for the last ${days} days`);
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
  weekdayFrequency.innerHTML = counts.size ? [...counts.entries()].map(([category, weekdayCounts]) => {
    const maximum = Math.max(...weekdayCounts);
    const cells = weekdayCounts.map((count, weekday) => {
      const level = count ? Math.max(1, Math.ceil((count / maximum) * 4)) : 0;
      const accessibleCount = `${activityCategories[category].label} on ${weekdays[weekday]}: ${count} ${count === 1 ? "activity" : "activities"}`;
      return `<td class="weekday-frequency-cell level-${level}" aria-label="${accessibleCount}" title="${accessibleCount}">${count || "—"}</td>`;
    }).join("");
    return `<tr><th scope="row"><span class="weekday-activity-name"><i class="calendar-legend-dot marker-${category}" aria-hidden="true"></i>${activityCategories[category].label}</span></th>${cells}</tr>`;
  }).join("") : '<tr><td class="weekday-empty" colspan="8">No activities in this period.</td></tr>';
}

function renderRunList(runs) {
  runsSummary.textContent = `${runs.length} ${runs.length === 1 ? "run" : "runs"}`;
  runsList.innerHTML = runs.length
    ? runs.map((run) => {
      const [year, month, day] = run.date.split("-").map(Number);
      const date = formatDate(new Date(year, month - 1, day), {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const category = categoryForActivity(run.type || "Running");
      return `<tr>
        <td data-label="Date">${escapeHtml(date)}</td>
        <td data-label="Activity"><span class="run-type activity-${category}">${escapeHtml(run.type || "Running")}</span></td>
        <td data-label="Distance">${formatDistance(run.distance / 1000, 2)} km</td>
        <td data-label="Pace">${formatPace(run.paceSecondsPerKm)}</td>
      </tr>`;
    }).join("")
    : '<tr><td class="runs-empty" colspan="4">No runs in this period.</td></tr>';
}

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
  renderRuns(importedRuns, Number(rangeSelect.value));
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
  const selectedView = button.dataset.view;
  for (const item of dashboardNav.querySelectorAll(".dashboard-nav-item")) {
    const isSelected = item === button;
    item.setAttribute("aria-selected", String(isSelected));
    document.querySelector(`#${item.getAttribute("aria-controls")}`).hidden = !isSelected;
  }
  dashboard.dataset.activeView = selectedView;
});
csvInput.addEventListener("change", () => importFile(csvInput.files[0]));
rangeSelect.addEventListener("change", refreshDashboard);
rollingPeriod.addEventListener("change", refreshDashboard);
weekdayPeriod.addEventListener("change", () => renderWeekdayFrequency(importedActivities, weekdayPeriod.value));

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
