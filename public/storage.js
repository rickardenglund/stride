const LEGACY_KEY = 'stride-garmin-runs';
let database;

function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('stride', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('dashboard');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Stride tabs to update browser storage.'));
  }).catch(error => { database = null; throw error; });
  return database;
}

async function transaction(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('dashboard', mode);
    const request = action(tx.objectStore('dashboard'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction cancelled.'));
  });
}

export async function loadImportedData() {
  const saved = await transaction('readonly', store => store.get('import'));
  if (saved) return saved;
  const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
  if (legacy) {
    await transaction('readwrite', store => store.put(legacy, 'import'));
    // Remove legacy data only after the complete IndexedDB transaction succeeds.
    localStorage.removeItem(LEGACY_KEY);
  }
  return legacy;
}

export async function saveImportedData(data) {
  await transaction('readwrite', store => store.put(data, 'import'));
  localStorage.removeItem(LEGACY_KEY);
}

export async function clearImportedData() {
  // Remove legacy first, so a failed legacy deletion cannot resurrect old data.
  localStorage.removeItem(LEGACY_KEY);
  await transaction('readwrite', store => store.delete('import'));
}
