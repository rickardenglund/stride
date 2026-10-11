import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunHeatmap, renderRunHeatmap, groupHeatmapRoutes } from '../public/heatmap.js';
const route = points => ({ points });
const a = {lat:59,lon:18}, b = {lat:59.01,lon:18.01};
test('empty or invalid routes produce an empty heatmap', () => {
  assert.equal(buildRunHeatmap([]).routeCount,0);
  assert.equal(buildRunHeatmap([route([a,{lat:NaN,lon:18}])]).routeCount,0);
});
test('shared routes count runs rather than GPS points or repeat visits', () => {
  const model = buildRunHeatmap([route([a,b,a,b]), route([a,{lat:59.005,lon:18.005},b])]);
  assert.equal(model.routeCount,2);
  assert.equal(model.maxCount,2);
  assert.ok(model.cells.some(cell=>cell.count===2));
  assert.ok(model.cells.every(cell=>cell.count<=2));
  assert.match(renderRunHeatmap(model),/2 activities/);
});
test('routes share geographic bounds rather than being individually centered', () => {
  const model = buildRunHeatmap([route([a,b]), route([{lat:60,lon:19},{lat:60.01,lon:19.01}])]);
  assert.equal(model.maxCount,1);
  assert.ok(model.cells.every(cell=>cell.x>=0 && cell.x<model.width && cell.y>=0 && cell.y<model.height));
});
test('stationary and date-line crossing routes have finite bounded cells', () => {
  for (const points of [[a,a],[{lat:10,lon:179.99},{lat:10.01,lon:-179.99}]]) {
    const model=buildRunHeatmap([route(points)]);
    assert.ok(model.cells.length>0);
    assert.ok(model.cells.every(cell=>Number.isFinite(cell.x)&&Number.isFinite(cell.y)));
  }
});

test('recalculation uses viewport scale and excludes routes outside the view', () => {
  const routes = [route([a,b]), route([{lat:60,lon:19},{lat:60.01,lon:19.01}])];
  const overview = buildRunHeatmap(routes);
  const zoomed = buildRunHeatmap(routes, { bounds:[[58.999,17.999],[59.011,18.011]],width:800,height:400 });
  assert.equal(zoomed.routeCount,1);
  assert.ok(zoomed.cells.length>overview.cells.length);
  assert.equal(zoomed.cellSize,5);
  assert.equal(zoomed.maxCount,1);
  const empty = buildRunHeatmap(routes,{bounds:[[0,0],[1,1]],width:800,height:400});
  assert.equal(empty.routeCount,0);
  assert.equal(empty.maxCount,0);
  assert.deepEqual(empty.cells,[]);
});

test('clips crossing segments before sampling at high zoom', () => {
  const model=buildRunHeatmap([route([{lat:0,lon:-1},{lat:0,lon:1}])],{
    bounds:[[-.00001,-.00001],[.00001,.00001]],width:500,height:300,
  });
  assert.equal(model.routeCount,1);
  assert.ok(model.cells.length<=101);
  assert.ok(model.cells.length>=99);
  assert.ok(model.cells.every(cell=>cell.x>=0&&cell.x<500&&cell.y>=0&&cell.y<300));
});

test('recalculation counts repeat visits once and supports views across the date line', () => {
  const points=[{lat:10,lon:179.99},{lat:10.001,lon:-179.99}];
  const model=buildRunHeatmap([route([...points,...points]),route(points)],{
    bounds:[[9.99,179.98],[10.01,180.02]],width:800,height:400,
  });
  assert.equal(model.routeCount,2);
  assert.equal(model.maxCount,2);
  assert.ok(model.cells.every(cell=>cell.count===2));
});

test('activity filters include every linked sport and distinguish types sharing a route category', () => {
  const activities = [
    { activityId: '1', date: '2024-01-01', type: 'Running' },
    { activityId: '2', date: '2024-01-01', type: 'Trail Running' },
    { activityId: '3', date: '2024-01-01', type: 'Cycling' },
    { activityId: '4', date: '2024-01-01', type: 'road_biking' },
    { activityId: '5', date: '2024-01-01', type: 'Walking' },
    { activityId: '6', date: '2024-01-01', type: 'Hiking' },
  ];
  const routes = activities.map(activity => ({ ...route([a,b]), activityId: activity.activityId }));
  const groups = groupHeatmapRoutes([...routes, { ...route([a,b]), activityId: 'missing' }], activities);
  assert.deepEqual([...groups.keys()], ['running', 'trail running', 'cycling', 'road cycling', 'walking', 'hiking']);
  assert.equal(buildRunHeatmap([...groups.values()].flat()).routeCount, 6);
  assert.deepEqual(groups.get('cycling'), [routes[2]]);
  assert.equal(buildRunHeatmap(groups.get('hiking')).routeCount, 1);
});

test('ambiguous legacy routes are not assigned to an arbitrary activity type', () => {
  const activities = [
    { date: '2024-01-01', type: 'Walking' },
    { date: '2024-01-01', type: 'Hiking' },
  ];
  const legacy = { ...route([a,b]), date: '2024-01-01', category: 'walking' };
  assert.equal(groupHeatmapRoutes([legacy], activities).size, 0);
  assert.equal(groupHeatmapRoutes([legacy], activities.slice(0,1)).get('walking').length, 1);
});

test('type counts count each activity once even when multiple routes refer to it', () => {
  const activity = { activityId: '1', date: '2024-01-01', type: 'Running' };
  const original = { ...route([a,b]), activityId: '1', fileName: 'original.gpx' };
  const replacement = { ...route([a,b]), activityId: '1', fileName: 'replacement.fit' };
  const groups = groupHeatmapRoutes([original, replacement], [activity]);
  assert.deepEqual(groups.get('running'), [replacement]);
});
