import test from "node:test";
import assert from "node:assert/strict";
import { mergeActivities, runningActivities } from "../public/activities.js";
import { parseGarminCsv } from "../public/csv.js";

const activity = (fields = {}) => ({
  date: "2026-10-08", type: "Running", distance: 5000,
  durationSeconds: 1500, paceSecondsPerKm: 300, averageHeartRate: 150,
  startTime: "2026-10-08T08:00:00", ...fields,
});

test("reimporting a CSV does not increase activity or run totals", () => {
  const csv = "Activity Type,Date,Distance,Time\nRunning,2026-10-08 08:00:00,5,00:25:00\nYoga,2026-10-08 18:00:00,--,00:30:00";
  const first = parseGarminCsv(csv);
  const merged = mergeActivities(first.activities, parseGarminCsv(csv).activities);
  assert.equal(merged.length, 2);
  assert.equal(runningActivities(merged).length, 1);
  assert.equal(runningActivities(merged)[0].distance, 5000);
});

test("newest details replace a matching activity without changing its count", () => {
  const old = activity();
  const latest = activity({ distance: 6000, durationSeconds: 1800, paceSecondsPerKm: 310, averageHeartRate: null });
  assert.deepEqual(mergeActivities([old], [latest]), [latest]);
  assert.equal(old.distance, 5000);
});

test("an activity ID matches even when its date, type, and start time change", () => {
  const old = activity({ activityId: "123" });
  const latest = activity({ activityId: "123", date: "2026-10-09", startTime: "2026-10-09T09:00:00", type: "Walking", distance: 3000 });
  const merged = mergeActivities([old], [latest]);
  assert.deepEqual(merged, [latest]);
  assert.equal(runningActivities(merged).length, 0);
});

test("two same-day runs with different start times remain separate", () => {
  const morning = activity();
  const evening = activity({ startTime: "2026-10-08T18:00:00" });
  const merged = mergeActivities([morning], [evening]);
  assert.equal(merged.length, 2);
  assert.deepEqual(mergeActivities(merged, [morning, evening]), merged);
});

test("different Garmin IDs remain separate even when all other data matches", () => {
  assert.equal(mergeActivities([activity({ activityId: "1" })], [activity({ activityId: "2" })]).length, 2);
});

test("duplicate rows in one CSV keep the latest content", () => {
  const csv = "Activity Type,Date,Distance,Avg HR\nRunning,2026-10-08 08:00:00,5,150\nRunning,2026-10-08T08:00:00,6,155";
  const result = parseGarminCsv(csv);
  assert.equal(result.activities.length, 1);
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].distance, 6000);
  assert.equal(result.runs[0].averageHeartRate, 155);
});

test("overlapping partial exports preserve previously imported activities", () => {
  const older = activity({ date: "2026-10-01", startTime: "2026-10-01T08:00:00" });
  const old = activity();
  const latest = activity({ distance: 6000 });
  const newActivity = activity({ date: "2026-10-09", startTime: "2026-10-09T08:00:00" });
  assert.deepEqual(mergeActivities([older, old], [latest, newActivity]), [older, latest, newActivity]);
});

test("legacy saved activities gain timestamps without being counted twice", () => {
  const old = activity({ startTime: undefined });
  const latest = activity({ distance: 6000 });
  assert.deepEqual(mergeActivities([old], [latest]), [latest]);
});

test("separate date-only runs in the same CSV are preserved", () => {
  const result = parseGarminCsv("Activity Type,Date,Distance\nRunning,2026-10-08,5\nRunning,2026-10-08,8");
  assert.equal(result.activities.length, 2);
  assert.equal(mergeActivities(result.activities, result.activities).length, 2);
});

test("an export missing activity IDs preserves the previous ID", () => {
  const old = activity({ activityId: "123" });
  const latest = activity({ distance: 6000 });
  assert.deepEqual(mergeActivities([old], [latest]), [{ ...latest, activityId: "123" }]);
});

test("CSV imports retain normalized full start times", () => {
  const result = parseGarminCsv("Activity Type;Date;Distance\nRunning;08.10.2026 8:00;5\nRunning;2026-10-08 18:00:00.000;8");
  assert.equal(result.runs[0].startTime, "2026-10-08T08:00:00");
  assert.equal(result.runs[1].startTime, "2026-10-08T18:00:00");
});

test("a non-running partial export can update an existing dashboard", () => {
  const first = parseGarminCsv("Activity Type,Date,Distance,Time\nRunning,2026-10-08 08:00:00,5,00:25:00\nYoga,2026-10-08 18:00:00,--,00:30:00");
  const update = parseGarminCsv("Activity Type,Date,Distance,Time\nYoga,2026-10-08 18:00:00,--,00:45:00", "km", { requireRuns: false });
  const merged = mergeActivities(first.activities, update.activities);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].durationSeconds, 2700);
});
