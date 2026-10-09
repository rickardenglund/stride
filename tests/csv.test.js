import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStoredRuns, parseGarminCsv } from "../public/csv.js";

test("imports only running activities and handles quoted CSV fields", () => {
  const csv = [
    "Activity Type,Date,Title,Distance",
    'Running,2026-10-01,"Morning, easy run",5.2',
    "Trail Running,2026-10-02,Woodland loop,8",
    "Walking,2026-10-03,Recovery walk,3",
    "Yoga,2026-10-04,Yoga,",
    "Indoor Climbing,2026-10-05,Climbing,",
  ].join("\r\n");

  assert.deepEqual(parseGarminCsv(csv), {
    unit: "km",
    runs: [
      { date: "2026-10-01", distance: 5200, type: "Running", durationSeconds: null, paceSecondsPerKm: null, averageHeartRate: null },
      { date: "2026-10-02", distance: 8000, type: "Trail Running", durationSeconds: null, paceSecondsPerKm: null, averageHeartRate: null },
    ],
    activities: [
      { date: "2026-10-01", type: "Running", distance: 5200, durationSeconds: null, paceSecondsPerKm: null, averageHeartRate: null },
      { date: "2026-10-02", type: "Trail Running", distance: 8000, durationSeconds: null, paceSecondsPerKm: null, averageHeartRate: null },
      { date: "2026-10-03", type: "Walking", distance: 3000, durationSeconds: null, paceSecondsPerKm: null, averageHeartRate: null },
      { date: "2026-10-04", type: "Yoga", distance: null, durationSeconds: null, paceSecondsPerKm: null, averageHeartRate: null },
      { date: "2026-10-05", type: "Indoor Climbing", distance: null, durationSeconds: null, paceSecondsPerKm: null, averageHeartRate: null },
    ],
  });
});

test("detects miles from the distance header and converts to kilometers", () => {
  const result = parseGarminCsv(
    "Activity Type,Date,Distance (mi)\nRunning,2026-10-01,3.1",
    "km",
  );
  assert.equal(result.unit, "mi");
  assert.ok(Math.abs(result.runs[0].distance - 4988.9664) < 1e-9);
});

test("detects meter-based distance headers and converts to kilometers", () => {
  const result = parseGarminCsv(
    "Activity Type,Date,Distance (m)\nRunning,2026-10-01,5000",
  );
  assert.equal(result.unit, "m");
  assert.equal(result.runs[0].distance, 5000);
});

test("accepts semicolon-delimited CSV and European dates", () => {
  const result = parseGarminCsv(
    "Activity Type;Date;Distance\nRunning;08.10.2026;5,5",
    "km",
  );
  assert.deepEqual(result.runs, [{
    date: "2026-10-08",
    distance: 5500,
    type: "Running",
    durationSeconds: null,
    paceSecondsPerKm: null,
    averageHeartRate: null,
  }]);
});

test("uses the selected unit when the distance header has no unit", () => {
  const result = parseGarminCsv(
    "Activity Type,Date,Distance\nRunning,2026-10-01,2",
    "mi",
  );
  assert.ok(Math.abs(result.runs[0].distance - 3218.688) < 1e-9);
});

test("calculates min/km pace from run duration and distance", () => {
  const result = parseGarminCsv(
    "Activity Type,Date,Distance (km),Time\nRunning,2026-10-01,5,00:25:00",
  );
  assert.equal(result.runs[0].paceSecondsPerKm, 300);
});

test("uses Garmin average pace when duration is not available", () => {
  const result = parseGarminCsv(
    "Activity Type,Date,Distance (mi),Avg Pace (min/mi)\nRunning,2026-10-01,3,9:00",
  );
  assert.ok(Math.abs(result.runs[0].paceSecondsPerKm - 540 / 1.609344) < 1e-9);
});

test("reads Garmin average pace exported as hh:mm:ss", () => {
  const result = parseGarminCsv(
    "Activity Type,Date,Distance (km),Avg Pace\nRunning,2026-10-01,5,00:06:12",
  );
  assert.equal(result.runs[0].paceSecondsPerKm, 372);
});

test("recognizes Garmin average pace header punctuation and kilometer units", () => {
  const result = parseGarminCsv(
    "Activity Type,Date,Distance (km),Avg. Pace (min/km)\nRunning,2026-10-01,5,00:05:30",
  );
  assert.equal(result.runs[0].paceSecondsPerKm, 330);
});

test("prefers Garmin average pace over elapsed duration", () => {
  const result = parseGarminCsv(
    [
      "Activity Type,Date,Distance,Time,Avg Pace",
      "Running,2026-10-08,3.45,00:22:37,6:33",
    ].join("\n"),
  );
  assert.equal(result.runs[0].paceSecondsPerKm, 393);
});

test("parses the Garmin CSV row format from the user's export", () => {
  const result = parseGarminCsv([
    "Activity Type,Date,Favorite,Title,Distance,Calories,Time,Avg HR,Max HR,Aerobic TE,Avg Run Cadence,Max Run Cadence,Avg Pace,Best Pace",
    'Running,2026-10-08 18:04:42,false,"Gothenburg Running","3.45","302","00:22:37","155","172","2.5","166","185","6:33","4:44"',
  ].join("\n"));
  assert.equal(result.runs[0].distance, 3450);
  assert.equal(result.runs[0].paceSecondsPerKm, 393);
});

test("imports non-running duration and average heart rate for activity calendar", () => {
  const result = parseGarminCsv([
    "Activity Type,Date,Distance,Time,Avg HR",
    "Running,2026-10-04,5,00:25:00,150",
    "Yoga,2026-10-05,--,00:59:17,112",
    "Cycling,2026-10-06,12.5,00:40:00,138",
  ].join("\n"));
  assert.deepEqual(result.activities, [
    { date: "2026-10-04", type: "Running", distance: 5000, durationSeconds: 1500, paceSecondsPerKm: 300, averageHeartRate: 150 },
    { date: "2026-10-05", type: "Yoga", distance: null, durationSeconds: 3557, paceSecondsPerKm: null, averageHeartRate: 112 },
    { date: "2026-10-06", type: "Cycling", distance: 12500, durationSeconds: 2400, paceSecondsPerKm: 192, averageHeartRate: 138 },
  ]);
});

test("migrates legacy stored kilometer distances to meters", () => {
  const runs = normalizeStoredRuns([
    { date: "2026-10-08", distance: 3.47, paceSecondsPerKm: 300 },
  ]);
  assert.equal(runs[0].distance, 3470);
  assert.equal(runs[0].paceSecondsPerKm, 300);
});

test("preserves stored meter distances and uses two-decimal run values", () => {
  const runs = normalizeStoredRuns([
    { date: "2026-10-08", distance: 3470, paceSecondsPerKm: null },
  ], "m");
  assert.equal(runs[0].distance, 3470);
});

test("reports when the selected file is not an activities CSV", () => {
  assert.throws(
    () => parseGarminCsv("Name,Value\nExample,1"),
    /Could not find Activity Type, Date, and Distance columns/,
  );
});
