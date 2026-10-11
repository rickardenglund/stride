import test from 'node:test';
import assert from 'node:assert/strict';
import { groupActivitiesByWeekday } from '../public/weekday.js';

test('weekday totals combine matching sports and retain individual types without double counting', () => {
  const activities = [
    ['2024-01-01', 'Running'], ['2024-01-01', 'trail_running'], ['2024-01-02', 'Treadmill Running'],
    ['2024-01-02', 'Cycling'], ['2024-01-03', 'Gravel Cycling'], ['2024-01-03', 'Road Biking'],
    ['2024-01-04', 'Walking'], ['2024-01-05', 'Hiking'], ['2024-01-07', 'Yoga'],
    ['2024-01-06', 'Bouldering'], ['2024-01-06', 'indoor_climbing'],
  ].map(([date, type]) => ({ date, type }));
  const result = groupActivitiesByWeekday(activities);
  assert.deepEqual(result.all, [2,2,2,1,1,2,1]);
  const groups = new Map(result.groups.map(group => [group.label, group.counts]));
  assert.deepEqual(groups.get('Running / Trail'), [2,1,0,0,0,0,0]);
  assert.deepEqual(groups.get('Cycling / Gravel'), [0,1,2,0,0,0,0]);
  assert.deepEqual(groups.get('Walking / Hiking'), [0,0,0,1,1,0,0]);
  assert.deepEqual(groups.get('Bouldering / Indoor Climbing'), [0,0,0,0,0,2,0]);
  assert.equal(result.types.length, 11);
  assert.equal(result.all.reduce((a,b) => a+b,0), activities.length);
  assert.deepEqual(new Map(result.types).get('trail running'), [1,0,0,0,0,0,0]);
});

test('empty inputs and ungrouped sports omit empty groups', () => {
  assert.deepEqual(groupActivitiesByWeekday([]).all, Array(7).fill(0));
  const result = groupActivitiesByWeekday([{ date:'2024-01-06', type:'Strength Training' }]);
  assert.equal(result.all[5],1);
  assert.deepEqual(result.groups, []);
  assert.deepEqual(groupActivitiesByWeekday([]).groups, []);
  assert.deepEqual(result.types, [['strength', [0,0,0,0,0,1,0]]]);
});

test('groups and individual types sort separately by descending totals with alphabetical ties', () => {
  const activities = ['Yoga', 'Yoga', 'Yoga', 'Yoga', 'Yoga', 'Cycling', 'Cycling', 'Gravel Cycling', 'Running', 'Hiking']
    .map(type => ({ date: '2024-01-01', type }));
  const result = groupActivitiesByWeekday(activities);
  assert.deepEqual(result.groups.map(group => group.label), [
    'Cycling / Gravel', 'Running / Trail', 'Walking / Hiking',
  ]);
  assert.deepEqual(result.types.map(([type]) => type), ['yoga', 'cycling', 'gravel/unpaved cycling', 'hiking', 'running']);
  assert.equal(result.all[0], 10);
});
