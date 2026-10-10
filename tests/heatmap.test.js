import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunHeatmap, renderRunHeatmap } from '../public/heatmap.js';
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
  assert.match(renderRunHeatmap(model),/2 runs/);
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
