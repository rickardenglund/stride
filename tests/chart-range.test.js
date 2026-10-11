import test from 'node:test';
import assert from 'node:assert/strict';
import { chartDataRange, chartLabelIndices } from '../public/chart-range.js';
import { renderSleep } from '../public/sleep.js';

test('trims empty edges while preserving interior rest days and rolling-window alignment', () => {
  const daily = [0, 0, 5, 0, 0, 8, 0];
  const range = chartDataRange(daily, value => value > 0);
  assert.deepEqual(daily.slice(range.start, range.end), [5, 0, 0, 8]);
  const rolling = [1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(rolling.slice(range.start, range.end), [3, 4, 5, 6]);
  assert.deepEqual(chartDataRange([0,0], value => value > 0), {start:0,end:0});
  assert.deepEqual(chartDataRange([], value => value > 0), {start:0,end:0});
  assert.deepEqual(chartDataRange([0,5,0], value => value > 0), {start:1,end:2});
});

test('sleep chart trims nights without oxygen at edges, retains gaps and the complete nightly table', () => {
  const nights = [null, 97, null, 96, null].map((averageSpo2, index) => ({
    date: `2026-01-0${index + 1}`, averageSpo2, lowestSpo2:null,
    duration:null,deep:null,light:null,rem:null,awake:null,score:null,respiration:null,
  }));
  const element = {};
  renderSleep(element, nights, 'all');
  const svg = element.innerHTML.match(/<svg class="sleep-plot"[\s\S]*?<\/svg>/)[0];
  assert.ok(svg.includes('2026-01-02'));
  assert.ok(svg.includes('2026-01-04'));
  assert.ok(!svg.includes('2026-01-01'));
  assert.ok(!svg.includes('2026-01-05'));
  assert.ok(!svg.includes('stroke="#358a80"')); // No line bridges the missing night.
  assert.ok(element.innerHTML.includes('<th scope="row">2026-01-01</th>'));
  const range = chartDataRange([{averageSpo2:null,lowestSpo2:90}], n => n.averageSpo2 !== null || n.lowestSpo2 !== null);
  assert.deepEqual(range,{start:0,end:1});
});


test('axis labels stay frequent as history grows and avoid crowding the final label', () => {
  for (const count of [30, 300, 3000]) {
    const labels = chartLabelIndices(count, 10);
    assert.equal(labels[0], 0);
    assert.equal(labels.at(-1), count - 1);
    for (let index = 1; index < labels.length; index++) {
      const gap = (labels[index] - labels[index - 1]) * 10;
      assert.ok(gap >= 100 && gap < 200);
    }
  }
  assert.deepEqual(chartLabelIndices(0, 10), []);
  assert.deepEqual(chartLabelIndices(1, 10), [0]);
});
