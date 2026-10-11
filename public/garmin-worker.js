import { importGarminExport } from './garmin-export.js';
self.onmessage = async ({ data }) => {
  try {
    const result = await importGarminExport(data.file, progress => self.postMessage({ progress }));
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: error.message || 'Could not read the Garmin export.' }); }
};
