const dashboard = document.querySelector("#dashboard");
const connectState = document.querySelector("#connect-state");
const loadingState = document.querySelector("#loading-state");
const notice = document.querySelector("#notice");
const rangeSelect = document.querySelector("#range-select");
const connectionLabel = document.querySelector("#connection-label");
const statusDot = document.querySelector(".status-dot");
const connectButton = document.querySelector("#connect-button");

function formatDistance(distance) {
  return distance.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

function formatDate(date, options) {
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function setLoading(loading) {
  loadingState.hidden = !loading;
  if (loading) {
    dashboard.hidden = true;
    connectState.hidden = true;
  }
}

function showError(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function makeChart(daily, dates, rollingAverage) {
  const width = Math.max(800, dates.length * 10);
  const height = 260;
  const left = 43;
  const right = 12;
  const top = 12;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(5, ...daily, ...rollingAverage);
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
  const areaPath = `${linePath} L${x(dates.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const labelStep = Math.max(1, Math.ceil(dates.length / 7));
  const labels = dates.map((date, index) => {
    if (index % labelStep !== 0 && index !== dates.length - 1) return "";
    const label = formatDate(date, { month: "short", day: "numeric" });
    return `<text class="axis-label" x="${x(index)}" y="${height - 9}" text-anchor="middle">${label}</text>`;
  }).join("");
  const points = rollingAverage.map((value, index) => {
    if (index % 7 !== 0 && index !== rollingAverage.length - 1) return "";
    return `<circle class="avg-point" cx="${x(index)}" cy="${y(value)}" r="2.6"><title>${formatDate(dates[index], { month: "short", day: "numeric" })}: ${formatDistance(value)} km/day 7-day average</title></circle>`;
  }).join("");

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Bar chart of daily running distance and line chart of 7-day average in kilometers">
    ${grid.join("")}
    <path class="avg-area" d="${areaPath}"></path>
    ${bars}
    <path class="avg-path" d="${linePath}"></path>
    ${points}
    ${labels}
  </svg>`;
}

function renderRuns(runs, days) {
  const totals = new Map();
  for (const run of runs) totals.set(run.date, (totals.get(run.date) || 0) + run.distance / 1000);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates = Array.from({ length: days + 6 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days + 5) + index);
    return date;
  });
  const daily = dates.map((date) => {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return totals.get(key) || 0;
  });
  const rollingAverage = daily.map((_, index) => {
    const start = Math.max(0, index - 6);
    const sample = daily.slice(start, index + 1);
    return sample.reduce((sum, distance) => sum + distance, 0) / 7;
  });
  const visibleDaily = daily.slice(6);
  const visibleRolling = rollingAverage.slice(6);
  const visibleDates = dates.slice(6);
  const totalDistance = visibleDaily.reduce((sum, distance) => sum + distance, 0);
  const latestAverage = visibleRolling.at(-1) || 0;
  const bestDistance = Math.max(0, ...visibleDaily);
  const bestIndex = visibleDaily.indexOf(bestDistance);

  document.querySelector("#total-distance").textContent = formatDistance(totalDistance);
  document.querySelector("#run-count").textContent = `Across ${runs.filter((run) => run.date >= dateKey(visibleDates[0])).length} runs`;
  document.querySelector("#current-average").textContent = formatDistance(latestAverage);
  document.querySelector("#best-day").textContent = formatDistance(bestDistance);
  document.querySelector("#best-day-date").textContent = bestDistance
    ? formatDate(visibleDates[bestIndex], { weekday: "short", month: "short", day: "numeric" })
    : "No runs in this period";
  document.querySelector("#chart").innerHTML = makeChart(visibleDaily, visibleDates, visibleRolling);
  document.querySelector("#chart").setAttribute("aria-label", `Running distance and 7-day rolling average for the last ${days} days`);
  document.querySelector("#chart-range").textContent = `${formatDate(visibleDates[0], { month: "short", day: "numeric" }).toUpperCase()} — ${formatDate(visibleDates.at(-1), { month: "short", day: "numeric" }).toUpperCase()}`;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function loadRuns() {
  notice.hidden = true;
  setLoading(true);
  try {
    const days = Number(rangeSelect.value);
    const response = await fetch(`/api/runs?days=${days}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load your runs.");
    renderRuns(result.runs, days);
    dashboard.hidden = false;
  } catch (error) {
    showError(error.message);
    connectState.hidden = false;
  } finally {
    setLoading(false);
  }
}

async function initialize() {
  try {
    const response = await fetch("/api/status");
    const status = await response.json();
    if (!status.connected) {
      connectState.hidden = false;
      return;
    }
    connectionLabel.textContent = status.athlete?.firstname
      ? `Connected · ${status.athlete.firstname}`
      : "Connected to Strava";
    statusDot.classList.add("connected");
    connectButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.1 13.4 12 9.2l-3.5 7h3.1l2.5-5 2.5 5h3.1l-3.5-7-2.1 4.2Z"/><path d="m8.5 16.2-1.3 2.6H4l4.5-9 1.6 3.2-1.6 3.2Z"/></svg> Refresh data`;
    connectButton.href = "#";
    connectButton.addEventListener("click", (event) => {
      event.preventDefault();
      loadRuns();
    });
    await loadRuns();
  } catch (error) {
    showError(error.message || "Could not connect to the dashboard.");
  }
}

rangeSelect.addEventListener("change", loadRuns);
initialize();
