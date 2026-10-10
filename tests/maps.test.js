import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectMapRoutes, mercatorLatitude, inverseMercatorLatitude, mountBackgroundMap } from '../public/maps.js';
test('map overlay coordinates agree with Mercator geographic bounds', () => {
  const points = [{lat:59,lon:18},{lat:65,lon:21}];
  const model = projectMapRoutes([points],800,400);
  const [[south,west],[north,east]] = model.bounds;
  for (const [i,point] of points.entries()) {
    assert.ok(Math.abs(model.coordinates[0][i].routeX-(point.lon-west)/(east-west)*800)<1e-7);
    assert.ok(Math.abs(model.coordinates[0][i].routeY-(mercatorLatitude(north)-mercatorLatitude(point.lat))/(mercatorLatitude(north)-mercatorLatitude(south))*400)<1e-7);
  }
});
test('projection clamps poles and unwraps the date line', () => {
  assert.ok(Number.isFinite(mercatorLatitude(90)));
  assert.ok(Math.abs(inverseMercatorLatitude(mercatorLatitude(59))-59)<1e-9);
  const model = projectMapRoutes([[{lat:10,lon:179.99},{lat:10.01,lon:-179.99}]],800,400);
  assert.ok(model.bounds[1][1]-model.bounds[0][1]<1);
});
test('maps initialize only when visible and clean up on replacement', () => {
  const oldL=globalThis.L, oldObserver=globalThis.ResizeObserver;
  let callback, initialized=0, removed=0, disconnected=0, resized=0;
  const svg={};
  const element={innerHTML:'',clientWidth:0,clientHeight:0,querySelector:()=>svg};
  const map={attributionControl:{setPrefix(prefix){assert.equal(prefix,false)}},fitBounds(){},invalidateSize(){resized++},remove(){removed++}};
  globalThis.ResizeObserver=class { constructor(cb){callback=cb} observe(){} disconnect(){disconnected++} };
  globalThis.L={map(){initialized++;return map},tileLayer(){return {addTo(){}}},svgOverlay(){return {addTo(){}}}};
  try {
    mountBackgroundMap(element,'<svg/>',[[59,18],[60,19]]);
    callback(); assert.equal(initialized,0);
    element.clientWidth=800;element.clientHeight=400;
    callback();assert.equal(initialized,1);
    callback();assert.equal(initialized,1);assert.equal(resized,1);
    mountBackgroundMap(element,'',null);
    assert.equal(removed,1);assert.equal(disconnected,1);
  } finally { globalThis.L=oldL;globalThis.ResizeObserver=oldObserver; }
});
