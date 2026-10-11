import test from 'node:test';
import assert from 'node:assert/strict';

// Transaction harness lets us force commit failure, which real browsers cannot
// reliably reproduce on demand, and verify that migration never loses old data.
async function storageHarness(t, { legacy = null, fail = false } = {}) {
  const original = { indexedDB: Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'), localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage') };
  const rows = new Map();
  const events = [];
  const state = { fail, legacy: legacy ? JSON.stringify(legacy) : null };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
    getItem: () => state.legacy,
    removeItem: () => { events.push('remove-legacy'); state.legacy = null; },
  } });
  const db = {
    createObjectStore() {},
    transaction(name, mode) {
      const tx = {};
      let pending;
      let request;
      tx.objectStore = () => ({
        get(key) { request = {}; pending = () => { request.result = rows.get(key); }; return request; },
        put(value, key) { request = {}; pending = () => rows.set(key, structuredClone(value)); return request; },
        delete(key) { request = {}; pending = () => rows.delete(key); return request; },
      });
      queueMicrotask(() => {
        if (state.fail && mode === 'readwrite') { tx.error = new Error('Quota exceeded'); tx.onabort(); }
        else { pending(); events.push('commit'); tx.oncomplete(); }
      });
      return tx;
    },
  };
  globalThis.indexedDB = { open() {
    const request = { result: db };
    queueMicrotask(() => { request.onupgradeneeded(); request.onsuccess(); });
    return request;
  } };
  t.after(() => { for (const key of ['indexedDB', 'localStorage']) { if (original[key]) Object.defineProperty(globalThis, key, original[key]); else delete globalThis[key]; } });
  const storage = await import(`../public/storage.js?case=${Math.random()}`);
  return { storage, rows, events, state };
}

test('migrates saved activities and routes only after the IndexedDB commit', async t => {
  const legacy = { version: 4, activities: [{ activityId: '1' }], routes: [{ points: [1, 2] }] };
  const { storage, rows, events, state } = await storageHarness(t, { legacy });
  assert.deepEqual(await storage.loadImportedData(), legacy);
  assert.deepEqual(rows.get('import'), legacy);
  assert.equal(state.legacy, null);
  assert.deepEqual(events, ['commit', 'commit', 'remove-legacy']);
  assert.deepEqual(await storage.loadImportedData(), legacy);
});

test('failed migration preserves legacy data and can be retried', async t => {
  const legacy = { activities: [{ activityId: '1' }] };
  const { storage, rows, state } = await storageHarness(t, { legacy, fail: true });
  await assert.rejects(storage.loadImportedData(), /Quota/);
  assert.equal(rows.has('import'), false);
  assert.deepEqual(JSON.parse(state.legacy), legacy);
  state.fail = false;
  assert.deepEqual(await storage.loadImportedData(), legacy);
});

test('saves route data, retains previous data on failed commit, and clears both storage formats', async t => {
  const { storage, rows, state } = await storageHarness(t);
  const first = { routes: [{ activityId: '1', points: Array.from({ length: 1000 }, (_, index) => ({ lat: 57, lon: 12, index })) }] };
  await storage.saveImportedData(first);
  state.fail = true;
  await assert.rejects(storage.saveImportedData({ routes: [] }), /Quota/);
  assert.deepEqual(rows.get('import'), first);
  state.fail = false;
  state.legacy = '{}';
  await storage.clearImportedData();
  assert.equal(state.legacy, null);
  assert.equal(await storage.loadImportedData(), null);
});
