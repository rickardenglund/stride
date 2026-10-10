import test from "node:test";
import assert from "node:assert/strict";
import { distanceScale, summarizeTraining } from "../public/training.js";

const runs = [
  { date: "2026-09-30", distance: 8000 },
  { date: "2026-10-01", distance: 5000 },
  { date: "2026-10-01", distance: 2500 },
  { date: "2026-10-10", distance: 10000 },
  { date: "2026-11-01", distance: 6000 },
];
const activities = [...runs, { date: "2026-10-05", type: "Yoga" }, { date: "2026-10-05", type: "Walking" }];

test("calendar summary follows the visible month and counts each active day once", () => {
  assert.deepEqual(summarizeTraining(runs, activities, {
    month: new Date(2026, 9, 1), period: "3", today: new Date(2026, 9, 10),
  }), { distanceKm: 17.5, runCount: 3, activeDays: 3 });
  assert.deepEqual(summarizeTraining(runs, activities, {
    month: new Date(2026, 8, 1), today: new Date(2026, 9, 10),
  }), { distanceKm: 8, runCount: 1, activeDays: 1 });
});

test("period summary includes its start and end dates and excludes future activities", () => {
  assert.deepEqual(summarizeTraining(runs, activities, {
    period: "10", today: new Date(2026, 9, 10),
  }), { distanceKm: 17.5, runCount: 3, activeDays: 3 });
  assert.deepEqual(summarizeTraining(runs, activities, {
    period: "3", today: new Date(2026, 9, 10),
  }), { distanceKm: 10, runCount: 1, activeDays: 1 });
});

test("all-imported summary includes the full dataset", () => {
  assert.deepEqual(summarizeTraining(runs, activities, { period: "all" }), {
    distanceKm: 31.5, runCount: 5, activeDays: 5,
  });
});

test("empty periods have zero metrics", () => {
  assert.deepEqual(summarizeTraining(runs, activities, { month: new Date(2026, 7, 1) }), {
    distanceKm: 0, runCount: 0, activeDays: 0,
  });
});

test("hidden rolling totals do not compress the daily-distance chart", () => {
  const daily = [5, 10, 0];
  const averages = [3, 4, 5];
  const totals = [21, 28, 35];
  assert.equal(distanceScale(daily, averages, totals).maxY, 10);
  const visibleTotalScale = distanceScale(daily, averages, totals, true);
  assert.equal(visibleTotalScale.maxY, 35);
  assert.ok(visibleTotalScale.maxY / visibleTotalScale.tickStep <= 5);
});

test("empty charts retain a nonzero axis scale", () => {
  assert.deepEqual(distanceScale([0], [0], [0]), { maxY: 5, tickStep: 1 });
});
