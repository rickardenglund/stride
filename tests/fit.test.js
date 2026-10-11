import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFit } from '../public/fit.js';
import { routesFromFit, importGarminRoutes } from '../public/garmin-routes.js';
import { mergeRoutes, routeMatchesActivity } from '../public/routes.js';
import { zip } from './fixtures/zip.js';
import { readZipDirectory } from '../public/zip.js';

function fit({ little = true, compressed = false, wellness = false } = {}) {
  const chunks = [];
  function definition(local, global, fields, developer = false) {
    const head = Buffer.alloc(6);
    head[0] = 64 | local | (developer ? 32 : 0); head[2] = little ? 0 : 1;
    if (little) head.writeUInt16LE(global, 3); else head.writeUInt16BE(global, 3);
    head[5] = fields.length;
    chunks.push(head, Buffer.from(fields.flat()));
    if (developer) chunks.push(Buffer.from([1, 0, 2, 0]));
  }
  function data(local, fields, developer = false) {
    chunks.push(Buffer.from([local]));
    for (const [size, value, signed = false] of fields) {
      const bytes = Buffer.alloc(size);
      if (signed) bytes[little ? 'writeIntLE' : 'writeIntBE'](value, 0, size);
      else bytes[little ? 'writeUIntLE' : 'writeUIntBE'](value, 0, size);
      chunks.push(bytes);
    }
    if (developer) chunks.push(Buffer.from([9, 9]));
  }
  const time = 1000000000;
  definition(0, 0, [[0,1,0]]); data(0, [[1, wellness ? 32 : 4]]);
  definition(1, 18, [[2,4,134],[7,4,134],[5,1,0]]);
  data(1, [[4,time],[4,30000],[1,1]]);
  definition(2, 20, [[253,4,134],[0,4,133],[1,4,133],[2,2,132],[3,1,2],[78,4,134]], true);
  const record = [[4,time],[4,680000000,true],[4,140000000,true],[2,2600],[1,150],[4,2700]];
  data(2, record, true);
  if (compressed) {
    chunks.push(Buffer.from([128 | (2 << 5) | ((time + 1) & 31)]));
    for (const [size,value,signed] of record.slice(1)) {
      const bytes=Buffer.alloc(size); bytes[signed ? (little ? 'writeIntLE':'writeIntBE') : (little ? 'writeUIntLE':'writeUIntBE')](value,0,size);chunks.push(bytes);
    }
    chunks.push(Buffer.from([9,9]));
  } else data(2, [[4,time+1],...record.slice(1)], true);
  const body=Buffer.concat(chunks), header=Buffer.alloc(12);
  header[0]=12;header[1]=16;header.writeUInt32LE(body.length,4);header.write('.FIT',8);
  const all=Buffer.concat([header,body]);
  let crc=0;
  for (const byte of all) {crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xa001:0);}
  const tail=Buffer.alloc(2);tail.writeUInt16LE(crc);
  return new Uint8Array(Buffer.concat([all,tail]));
}

const activity = { activityId:'123',type:'running',date:'2021-09-08',startTime:'2021-09-08T03:46:40',
  startTimeUtc:new Date(631065600000 + 1000000000 * 1000).toISOString() };

test('FIT reader handles both byte orders, compressed timestamps, and developer fields', () => {
  for (const options of [{}, {little:false}, {compressed:true}]) {
    const result=decodeFit(fit(options));
    assert.equal(result.records.length,2);
    assert.equal(result.records[0].elevation,40); // Enhanced altitude takes precedence.
    assert.equal(result.records[0].heartRate,150);
    assert.ok(Math.abs(result.records[0].lat-56.9969)<0.001);
    assert.equal(result.records[1].time-result.records[0].time,1000);
    assert.equal(result.sessions[0].end-result.sessions[0].start,30000);
  }
});

test('supports chained FIT streams used by older activity uploads', () => {
  const first = fit(), second = fit({ wellness: true });
  const chained = new Uint8Array(first.length + second.length);
  chained.set(first); chained.set(second, first.length);
  assert.equal(decodeFit(chained).records.length, 2);
});

test('ignores wellness recordings and rejects damaged activity FITs', () => {
  assert.equal(decodeFit(fit({wellness:true})).records.length,0);
  const bytes=fit(); bytes[bytes.length-1]^=1;
  assert.throws(()=>decodeFit(bytes),/checksum/);
  assert.throws(()=>decodeFit(bytes.subarray(0,bytes.length-3)),/length/);
});

test('matches UTC sessions, rejects ambiguity, and bounds route point counts', () => {
  const decoded=decodeFit(fit());
  const result=routesFromFit(decoded,[activity],'test.fit');
  assert.equal(result.routes.length,1);
  assert.equal(result.routes[0].activityId,'123');
  assert.equal(routesFromFit(decoded,[activity,{...activity,activityId:'456'}],'test.fit').unmatched,1);
  assert.equal(routesFromFit(decoded,[{...activity,startTimeUtc:'2000-01-01T00:00:00Z'}],'test.fit').unmatched,1);
  const records=Array.from({length:5000},(_,index)=>({...decoded.records[0],index}));
  const sampled=routesFromFit({...decoded,records},[activity],'test.fit').routes[0].points;
  assert.ok(sampled.length<=1000);
  assert.equal(sampled.at(-1).index,4999);
});

test('same-day runs keep distinct routes and reimports update rather than duplicate', () => {
  const morning={...activity},evening={...activity,activityId:'456',startTime:'2021-09-08T18:00:00'};
  const route={activityId:'123',startTime:morning.startTime,date:morning.date,category:'running',points:[1,2]};
  assert.equal(routeMatchesActivity(route,morning,[morning,evening]),true);
  assert.equal(routeMatchesActivity(route,evening,[morning,evening]),false);
  assert.equal(routeMatchesActivity({date:morning.date,category:'running'},morning,[morning,evening]),false);
  const merged=mergeRoutes([route],[{...route,points:[3,4]}]);
  assert.equal(merged.length,1);assert.deepEqual(merged[0].points,[3,4]);
  assert.equal(mergeRoutes(merged,[{...route,activityId:'456',startTime:evening.startTime}]).length,2);
});

test('reads nested route ZIPs and counts malformed recordings without losing valid routes', async () => {
  const nested=zip([['anonymous_1.fit',fit()],['wellness.fit',fit({wellness:true})],['damaged.fit','invalid']]);
  const outer=zip([['DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip',new Uint8Array(await nested.arrayBuffer())]]);
  const result=await importGarminRoutes(outer,await readZipDirectory(outer),[activity],()=>{});
  assert.equal(result.routes.length,1);
  assert.equal(result.routeStats.scanned,3);
  assert.equal(result.routeStats.activityFiles,1);
  assert.equal(result.routeStats.failed,1);
});
