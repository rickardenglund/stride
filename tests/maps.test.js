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

test('heatmap overlay updates preserve the map instance and its viewport', async () => {
  const { getMapViewport, updateMapOverlay } = await import('../public/maps.js');
  const previous={L:globalThis.L,ResizeObserver:globalThis.ResizeObserver,document:globalThis.document};
  let resize,initialized=0,fits=0,removed=0;
  const svg={};
  const bounds=[[59,18],[60,19]];
  const element={innerHTML:'',clientWidth:600,clientHeight:300,querySelector:()=>svg};
  const map={attributionControl:{setPrefix(){}},fitBounds(){fits++},invalidateSize(){},
    getBounds:()=>({getSouth:()=>59,getWest:()=>18,getNorth:()=>60,getEast:()=>19}),
    getSize:()=>({x:600,y:300}),remove(){assert.fail('Map must be retained');}};
  globalThis.ResizeObserver=class {constructor(callback){resize=callback}observe(){}disconnect(){}};
  globalThis.document={createElement:()=>({content:{querySelector:()=>svg}})};
  globalThis.L={map(){initialized++;return map},tileLayer:()=>({addTo(){}}),
    svgOverlay:(overlay,overlayBounds)=>({addTo(target){assert.equal(target,map);assert.deepEqual(overlayBounds,bounds);return this},remove(){removed++}})};
  try {
    assert.equal(getMapViewport(element),null);
    mountBackgroundMap(element,'<svg/>',bounds);
    resize();
    assert.deepEqual(getMapViewport(element),{bounds,width:600,height:300});
    assert.equal(updateMapOverlay(element,'<svg/>',bounds),true);
    assert.equal(initialized,1);
    assert.equal(fits,1);
    assert.equal(removed,1);
    assert.equal(updateMapOverlay({},'<svg/>',bounds),false);
  } finally { Object.assign(globalThis,previous); }
});

test('automatic recalculation coalesces map events and cancels pending work on replacement', () => {
  const previous = { L: globalThis.L, ResizeObserver: globalThis.ResizeObserver,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const pending = new Map(), events = {};
  let sequence = 0, resize, recalculations = 0;
  const element = { innerHTML: '', clientWidth: 600, clientHeight: 300, querySelector: () => ({}) };
  const map = { attributionControl: { setPrefix() {} }, fitBounds() {}, invalidateSize() {}, remove() {},
    on(names, callback) { for (const name of names.split(' ')) events[name] = callback; } };
  globalThis.setTimeout = callback => { pending.set(++sequence, callback); return sequence; };
  globalThis.clearTimeout = id => pending.delete(id);
  globalThis.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} disconnect() {} };
  globalThis.L = { map: () => map, tileLayer: () => ({ addTo() {} }), svgOverlay: () => ({ addTo() {} }) };
  const flush = () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback()); };
  try {
    mountBackgroundMap(element, '<svg/>', [[59, 18], [60, 19]], { onViewportChange: () => recalculations++ });
    resize(); flush();
    assert.equal(recalculations, 1); // Initial view is recalculated at actual map dimensions.
    events.zoomend(); events.moveend(); events.zoomend();
    assert.equal(pending.size, 1);
    flush(); assert.equal(recalculations, 2);
    events.moveend(); events.movestart();
    flush(); assert.equal(recalculations, 2); // Do not calculate while dragging resumes.
    resize(); flush(); assert.equal(recalculations, 3);
    events.moveend(); element.clientWidth = 0;
    flush(); assert.equal(recalculations, 3); // Hidden maps do not calculate.
    element.clientWidth = 600;
    events.moveend();
    mountBackgroundMap(element, '', null);
    assert.equal(pending.size, 0);
    flush(); assert.equal(recalculations, 3);
  } finally { Object.assign(globalThis, previous); }
});

test('embedded maps disable wheel zoom and retain reduced-motion preferences', () => {
  const previous = { L: globalThis.L, ResizeObserver: globalThis.ResizeObserver, matchMedia: globalThis.matchMedia };
  let resize, options, tileOptions, reducedMotion = false;
  const map = { attributionControl: { setPrefix() {} }, fitBounds() {}, remove() {} };
  globalThis.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} disconnect() {} };
  globalThis.matchMedia = () => ({ matches: reducedMotion });
  globalThis.L = {
    map(element, config) { options = config; return map; },
    tileLayer(url, config) { tileOptions = config; return { addTo() {} }; },
    svgOverlay: () => ({ addTo() {} }),
  };
  const element = { innerHTML: '', clientWidth: 600, clientHeight: 300, querySelector: () => ({}) };
  try {
    mountBackgroundMap(element, '<svg/>', [[59,18],[60,19]]); resize();
    assert.equal(options.scrollWheelZoom, false);
    assert.ok(options.zoomSnap < 1 && options.zoomDelta < 1);
    assert.ok(options.wheelPxPerZoomLevel > 60);
    assert.equal(options.zoomAnimation, true);
    assert.ok(tileOptions.keepBuffer > 0);
    reducedMotion = true;
    mountBackgroundMap(element, '<svg/>', [[59,18],[60,19]]); resize();
    assert.equal(options.zoomAnimation, false);
    assert.equal(options.fadeAnimation, false);
    assert.equal(options.inertia, false);
    assert.equal(options.scrollWheelZoom, false);
  } finally { Object.assign(globalThis, previous); }
});
