// Focused FIT protocol reader: native file_id, session and record fields only.
// Unknown native and developer fields are skipped using message definitions.
// Protocol: https://developer.garmin.com/fit/protocol/
const FIT_EPOCH = 631065600000;
const SEMICIRCLES = 180 / 2147483648;

function crc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xa001 : 0);
  }
  return crc;
}

function decodeFitSegment(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 14 || String.fromCharCode(...bytes.subarray(8, 12)) !== '.FIT') throw new Error('Invalid FIT header.');
  const headerSize = bytes[0];
  if (headerSize < 12 || headerSize > bytes.length - 2) throw new Error('Invalid FIT header size.');
  const end = headerSize + view.getUint32(4, true);
  if (end + 2 !== bytes.length) throw new Error('FIT data length does not match its header.');
  const definitions = new Map();
  const records = [], sessions = [];
  let offset = headerSize, timestamp = null, fileType = null;
  function requireBytes(length) {
    if (offset + length > end) throw new Error('Truncated FIT message.');
  }
  function scalar(field, little) {
    const type = field.type & 31;
    let value;
    if (field.size === 1 && [0, 2, 10, 13].includes(type)) value = view.getUint8(offset);
    else if (field.size === 1 && type === 1) value = view.getInt8(offset);
    else if (field.size === 2 && [4, 11].includes(type)) value = view.getUint16(offset, little);
    else if (field.size === 2 && type === 3) value = view.getInt16(offset, little);
    else if (field.size === 4 && [6, 12].includes(type)) value = view.getUint32(offset, little);
    else if (field.size === 4 && type === 5) value = view.getInt32(offset, little);
    else return null;
    const invalid = { 0:255, 1:127, 2:255, 3:32767, 4:65535, 5:2147483647, 6:4294967295, 10:0, 11:0, 12:0, 13:255 };
    return value === invalid[type] ? null : value;
  }
  while (offset < end) {
    const header = bytes[offset++];
    const compressed = Boolean(header & 128);
    const local = compressed ? (header >> 5) & 3 : header & 15;
    if (!compressed && (header & 64)) {
      requireBytes(5);
      const little = bytes[offset + 1] === 0;
      const global = view.getUint16(offset + 2, little);
      const count = bytes[offset + 4];
      offset += 5;
      requireBytes(count * 3);
      const fields = [];
      for (let index = 0; index < count; index++) {
        fields.push({ number: bytes[offset], size: bytes[offset + 1], type: bytes[offset + 2] });
        offset += 3;
      }
      let developerSize = 0;
      if (header & 32) {
        requireBytes(1);
        const count = bytes[offset++];
        requireBytes(count * 3);
        for (let index = 0; index < count; index++) { developerSize += bytes[offset + 1]; offset += 3; }
      }
      definitions.set(local, { global, little, fields, developerSize });
      continue;
    }
    const definition = definitions.get(local);
    if (!definition) throw new Error('FIT data message has no definition.');
    const values = {};
    if (compressed) {
      if (timestamp === null) throw new Error('FIT compressed timestamp has no reference.');
      let next = (timestamp & ~31) + (header & 31);
      if ((header & 31) < (timestamp & 31)) next += 32;
      timestamp = next;
      values[253] = next;
    }
    for (const field of definition.fields) {
      if (compressed && field.number === 253) continue;
      requireBytes(field.size);
      if ([0, 18, 20].includes(definition.global) || field.number === 253) values[field.number] = scalar(field, definition.little);
      offset += field.size;
    }
    requireBytes(definition.developerSize);
    offset += definition.developerSize;
    if (values[253] != null) timestamp = values[253];
    if (definition.global === 0) {
      fileType = values[0];
      // Wellness and settings recordings dominate full account exports.
      if (fileType !== 4) return { fileType, records: [], sessions: [] };
    }
    if (definition.global === 18 && values[2] != null) {
      sessions.push({ start: FIT_EPOCH + values[2] * 1000,
        end: values[7] != null ? FIT_EPOCH + values[2] * 1000 + values[7] : null,
        sport: values[5] });
    }
    if (definition.global === 20 && values[0] != null && values[1] != null) {
      const lat = values[0] * SEMICIRCLES, lon = values[1] * SEMICIRCLES;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      const altitude = values[78] ?? values[2];
      records.push({ lat, lon, ...(values[253] != null ? { time: FIT_EPOCH + values[253] * 1000 } : {}),
        ...(altitude != null ? { elevation: altitude / 5 - 500 } : {}),
        ...(values[3] > 0 ? { heartRate: values[3] } : {}), index: records.length });
    }
  }
  if (fileType !== 4) return { fileType, records: [], sessions: [] };
  if (crc16(bytes.subarray(0, end)) !== view.getUint16(end, true)) throw new Error('FIT checksum failed.');
  if (headerSize >= 14 && view.getUint16(headerSize - 2, true) !== 0 && crc16(bytes.subarray(0, headerSize)) !== 0) throw new Error('FIT header checksum failed.');
  return { fileType, records, sessions };
}

// FIT permits several complete FIT streams to be concatenated in one upload.
export function decodeFit(bytes) {
  let offset = 0;
  const result = { fileType: null, records: [], sessions: [] };
  let segments = 0;
  while (offset < bytes.length) {
    if (++segments > 128 || offset + 12 > bytes.length) throw new Error('Invalid chained FIT stream.');
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset);
    const length = bytes[offset] + view.getUint32(4, true) + 2;
    if (length < 14 || offset + length > bytes.length) throw new Error('FIT data length does not match its header.');
    const decoded = decodeFitSegment(bytes.subarray(offset, offset + length));
    if (offset === 0) {
      result.fileType = decoded.fileType;
      if (result.fileType !== 4) return result;
    }
    result.sessions.push(...decoded.sessions);
    for (const point of decoded.records) result.records.push({ ...point, index: result.records.length });
    offset += length;
  }
  return result;
}
