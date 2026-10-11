import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGarminSleep, mergeSleep, sleepInPeriod, renderSleep } from '../public/sleep.js';
import { importGarminExport } from '../public/garmin-export.js';
import { zip } from './fixtures/zip.js';
const raw = overrides => ({ calendarDate: '2026-10-08', sleepStartTimestampGMT: '2026-10-07T22:00:00.0', sleepEndTimestampGMT: '2026-10-08T06:00:00.0', deepSleepSeconds: 3600, lightSleepSeconds: 14400, remSleepSeconds: 7200, awakeSleepSeconds: 3600, spo2SleepSummary: { averageSPO2: 97.5, lowestSPO2: 90, userProfilePk: 123, deviceId: 456 }, userNote: 'private', ...overrides });
test('preserves wake date, treats GMT as UTC, excludes awake time and private metadata', () => {
 const [night] = parseGarminSleep([raw({})]);
 assert.equal(night.date, '2026-10-08'); assert.equal(night.start, '2026-10-07T22:00:00.000Z');
 assert.equal(night.duration, 25200); assert.equal(night.averageSpo2, 97.5);
 assert.ok(!JSON.stringify(night).includes('private')); assert.ok(!('userProfilePk' in night));
});
test('ignores placeholder and invalid records, preserves missing sleep and oxygen values', () => {
 assert.equal(parseGarminSleep([{retro:false}, raw({calendarDate:'2026-02-30'}), raw({sleepEndTimestampGMT:'2026-10-07T21:00:00'})]).length, 0);
 const [night] = parseGarminSleep([raw({deepSleepSeconds:undefined, spo2SleepSummary:{averageSPO2:0,lowestSPO2:101}})]);
 assert.equal(night.duration,null); assert.equal(night.averageSpo2,null); assert.equal(night.lowestSpo2,null);
});
test('reimport deduplicates nights and retains existing oxygen when absent in a later file', () => {
 const initial = parseGarminSleep([raw({})]);
 const result = mergeSleep(initial,parseGarminSleep([raw({spo2SleepSummary:undefined})]));
 assert.equal(result.length,1); assert.equal(result[0].averageSpo2,97.5);
});
test('period filtering includes boundary nights and renders empty ranges without zero oxygen', () => {
 const nights = parseGarminSleep([raw({calendarDate:'2026-10-08'}), raw({calendarDate:'2026-10-07'})]);
 assert.equal(sleepInPeriod(nights,'2',new Date(2026,9,9,12)).length,1);
 const element = {}; renderSleep(element, nights, 'all'); assert.match(element.innerHTML,/97.5%/);
 renderSleep(element, [], 'all'); assert.match(element.innerHTML,/reimport/);
});
test('ZIP imports sleep alongside activities using anonymous fixtures', async () => {
 const result = await importGarminExport(zip([
 ['anonymous_summarizedActivities.json',JSON.stringify([{summarizedActivitiesExport:[{activityId:1,activityType:'running',startTimeLocal:Date.UTC(2026,9,8),distance:500000}]}])],
 ['anonymous_sleepData.json',JSON.stringify([raw({}),{retro:false}])]
 ]));
 assert.equal(result.sleep.length,1); assert.equal(result.runs.length,1);
});

test('chart inspection handles scaled/scrolled positions, touch taps, missing values, and dismissal', async () => {
 const { attachSleepChart } = await import('../public/sleep.js');
 const node = () => ({ listeners: {}, attributes: {}, addEventListener(type, handler) { this.listeners[type] = handler; }, setAttribute(key, value) { this.attributes[key] = String(value); }, getAttribute(key) { return this.attributes[key]; } });
 const chart = node(), svg = node(), marker = node(), documentStub = node();
 const points = [48, 358, 668].map((x, index) => Object.assign(node(), {dataset: {night: String(index)}, attributes: {cx: String(x)}}));
 const tooltip = {hidden: true, children: [{},{children:[{},{}]},{children:[{},{}]}], style: {}, getBoundingClientRect: () => ({width: 200, height: 80})};
 Object.assign(svg, {viewBox: {baseVal: {width:700}}, getBoundingClientRect: () => ({left:-100,width:350}), querySelector: () => marker, querySelectorAll: () => points});
 Object.assign(chart, {querySelector: () => svg, contains: target => target === svg});
 const element = {querySelector: selector => selector === '.sleep-chart' ? chart : tooltip};
 const previousDocument = globalThis.document, previousWindow = globalThis.window;
 globalThis.document = documentStub; globalThis.window = {innerWidth:320,innerHeight:640};
 try {
   attachSleepChart(element, [
     {date:'2026-10-01',averageSpo2:97.25,lowestSpo2:90},
     {date:'2026-10-02',averageSpo2:98,lowestSpo2:null},
     {date:'2026-10-04',averageSpo2:96,lowestSpo2:89},
   ]);
   chart.listeners.pointermove({pointerType:'mouse',clientX:-76,clientY:100});
   assert.equal(tooltip.hidden,false);
   assert.equal(tooltip.children[1].children[1].textContent,'97.25%');
   chart.listeners.pointermove({pointerType:'mouse',clientX:80,clientY:100});
   assert.equal(tooltip.children[0].textContent,'2026-10-02');
   assert.equal(tooltip.children[2].children[1].textContent,'Unavailable');
   assert.equal(marker.attributes.x1,'358');
   chart.listeners.pointerleave({pointerType:'mouse'}); assert.equal(tooltip.hidden,true);
   chart.listeners.pointermove({pointerType:'touch',clientX:234,clientY:100}); assert.equal(tooltip.hidden,true);
   chart.listeners.pointerup({pointerType:'touch',clientX:234,clientY:100});
   chart.listeners.pointerleave({pointerType:'touch'});
   assert.equal(tooltip.hidden,false); assert.equal(tooltip.children[0].textContent,'2026-10-04');
   assert.equal(tooltip.style.left,'112px');
   documentStub.listeners.pointerdown({target:{}}); assert.equal(tooltip.hidden,true);
   chart.listeners.pointerup({pointerType:'touch',clientX:234,clientY:100});
   chart.listeners.scroll(); assert.equal(tooltip.hidden,true); assert.equal(marker.attributes.visibility,'hidden');
 } finally {
   globalThis.document = previousDocument; globalThis.window = previousWindow;
 }
});
