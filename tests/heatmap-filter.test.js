import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHeatmapSelection, toggleHeatmapType, selectedHeatmapRoutes, heatmapGroupTypes, heatmapOptionState, defaultHeatmapSelection } from '../public/heatmap-filter.js';
const types = ['running', 'cycling', 'hiking'];

test('All selects every type and clearing All leaves an explicit empty selection', () => {
  assert.deepEqual(toggleHeatmapType(new Set(['running']), types, 'all', true), new Set(['all']));
  assert.deepEqual(toggleHeatmapType(new Set(['all']), types, 'all', false), new Set());
  assert.deepEqual(normalizeHeatmapSelection(new Set(), types), new Set());
});

test('deselecting a type from All retains the others; restoring it returns to All', () => {
  const subset = toggleHeatmapType(new Set(['all']), types, 'cycling', false);
  assert.deepEqual(subset, new Set(['running', 'hiking']));
  assert.deepEqual(toggleHeatmapType(subset, types, 'cycling', true), new Set(['all']));
});

test('individual types can be combined or cleared without implicitly selecting All', () => {
  const first = toggleHeatmapType(new Set(), types, 'running', true);
  assert.deepEqual(first, new Set(['running']));
  const second = toggleHeatmapType(first, types, 'cycling', true);
  assert.deepEqual(second, new Set(['running', 'cycling']));
  assert.deepEqual(toggleHeatmapType(first, types, 'running', false), new Set());
  assert.deepEqual(first, new Set(['running']));
});

test('new activity types join All but not a custom selection, and removed types are discarded', () => {
  assert.deepEqual(normalizeHeatmapSelection(new Set(['all']), [...types, 'walking']), new Set(['all']));
  assert.deepEqual(normalizeHeatmapSelection(new Set(['running']), [...types, 'walking']), new Set(['running']));
  assert.deepEqual(normalizeHeatmapSelection(new Set(['running']), ['cycling']), new Set());
});

test('selected route counts include the union of selected types without counting All twice', () => {
  const groups = new Map([['running', ['run1', 'run2']], ['cycling', ['ride1']], ['hiking', ['hike1']]]);
  assert.deepEqual(selectedHeatmapRoutes(groups, new Set(['running', 'cycling'])), ['run1', 'run2', 'ride1']);
  assert.deepEqual(selectedHeatmapRoutes(groups, new Set(['all'])), ['run1', 'run2', 'ride1', 'hike1']);
  assert.deepEqual(selectedHeatmapRoutes(groups, new Set()), []);
});

const groupedTypes = ['running', 'trail running', 'treadmill running', 'cycling', 'road cycling', 'gravel/unpaved cycling', 'walking', 'hiking', 'kayaking'];

test('the default includes running and trail variants, including after routes arrive', () => {
  assert.deepEqual(defaultHeatmapSelection([]), new Set());
  assert.deepEqual(defaultHeatmapSelection(groupedTypes), new Set(['running', 'trail running', 'treadmill running']));
  assert.deepEqual(heatmapGroupTypes('group:cycling', groupedTypes), ['cycling', 'road cycling', 'gravel/unpaved cycling']);
  assert.deepEqual(heatmapGroupTypes('group:walking', groupedTypes), ['walking', 'hiking']);
  assert.deepEqual(heatmapGroupTypes('group:climbing', ['bouldering', 'indoor climbing', 'rock climbing', 'running']), ['bouldering', 'indoor climbing']);
});

test('groups combine with other selections and clearing a group only removes its members', () => {
  const initial = defaultHeatmapSelection(groupedTypes);
  const combined = toggleHeatmapType(initial, groupedTypes, 'group:cycling', true);
  assert.equal(combined.size, 6);
  assert.equal(combined.has('running'), true);
  assert.equal(combined.has('gravel/unpaved cycling'), true);
  assert.deepEqual(toggleHeatmapType(combined, groupedTypes, 'group:cycling', false), initial);
  const withoutWalking = toggleHeatmapType(new Set(['all']), groupedTypes, 'group:walking', false);
  assert.equal(withoutWalking.size, 7);
  assert.equal(withoutWalking.has('walking'), false);
  assert.equal(withoutWalking.has('hiking'), false);
});

test('group and All checkboxes reflect individual selections and partial states', () => {
  const partial = new Set(['running']);
  assert.deepEqual(heatmapOptionState(partial, groupedTypes, 'group:running'), { checked: false, indeterminate: true });
  assert.deepEqual(heatmapOptionState(partial, groupedTypes, 'all'), { checked: false, indeterminate: true });
  const full = toggleHeatmapType(partial, groupedTypes, 'group:running', true);
  assert.deepEqual(heatmapOptionState(full, groupedTypes, 'group:running'), { checked: true, indeterminate: false });
  assert.deepEqual(heatmapOptionState(new Set(['all']), groupedTypes, 'group:cycling'), { checked: true, indeterminate: false });
  assert.deepEqual(heatmapOptionState(new Set(['all']), ['running'], 'group:cycling'), { checked: false, indeterminate: false });
});

test('group selections plus individual members never duplicate route counts', () => {
  const groups = new Map([['running', ['run1', 'run2']], ['trail running', ['trail1']], ['cycling', ['ride1']]]);
  const available = [...groups.keys()];
  let selection = toggleHeatmapType(new Set(), available, 'group:running', true);
  selection = toggleHeatmapType(selection, available, 'running', true);
  assert.deepEqual(selectedHeatmapRoutes(groups, selection), ['run1', 'run2', 'trail1']);
  selection = toggleHeatmapType(selection, available, 'group:cycling', true);
  assert.deepEqual(selection, new Set(['all']));
  assert.equal(selectedHeatmapRoutes(groups, selection).length, 4);
});
