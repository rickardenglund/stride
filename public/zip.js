// Read selected ZIP entries from Blob slices; unrelated files are never inflated.
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_DIRECTORY_BYTES = 16 * 1024 * 1024;
const decoder = new TextDecoder();

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

export async function readZipDirectory(blob) {
  if (blob.size < 22) throw new Error('This file is not a valid ZIP archive.');
  const tail = new DataView(await blob.slice(Math.max(0, blob.size - 65557)).arrayBuffer());
  let end = -1;
  for (let offset = tail.byteLength - 22; offset >= 0; offset--) {
    if (tail.getUint32(offset, true) === 0x06054b50 && offset + 22 + tail.getUint16(offset + 20, true) === tail.byteLength) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error('This ZIP archive is incomplete or invalid.');
  const count = tail.getUint16(end + 10, true);
  const size = tail.getUint32(end + 12, true);
  const start = tail.getUint32(end + 16, true);
  if (tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true)
    || tail.getUint16(end + 8, true) !== count || count === 65535 || start === 0xffffffff || size === 0xffffffff) {
    throw new Error('Split and ZIP64 archives are not supported. Choose the original Garmin export ZIP.');
  }
  if (size > MAX_DIRECTORY_BYTES || start + size > blob.size - 22) throw new Error('This ZIP directory is too large or invalid.');
  const bytes = new Uint8Array(await blob.slice(start, start + size).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const entries = [];
  let offset = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > size || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP directory entry.');
    const nameLength = view.getUint16(offset + 28, true);
    const length = 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (offset + length > size) throw new Error('Truncated ZIP directory.');
    entries.push({ name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      flags: view.getUint16(offset + 8, true), method: view.getUint16(offset + 10, true),
      crc: view.getUint32(offset + 16, true), compressedSize: view.getUint32(offset + 20, true),
      size: view.getUint32(offset + 24, true), offset: view.getUint32(offset + 42, true) });
    offset += length;
  }
  return entries;
}

export async function readZipEntry(blob, entry, maxBytes = MAX_ENTRY_BYTES) {
  if (entry.flags & 1) throw new Error('Encrypted ZIP entries are not supported.');
  if (entry.size > maxBytes || entry.compressedSize > maxBytes) throw new Error(`A ZIP entry exceeds the ${maxBytes / 1024 / 1024} MB import limit.`);
  if (![0, 8].includes(entry.method)) throw new Error('Unsupported ZIP compression.');
  const header = new DataView(await blob.slice(entry.offset, entry.offset + 30).arrayBuffer());
  if (header.byteLength !== 30 || header.getUint32(0, true) !== 0x04034b50) throw new Error('Invalid ZIP file entry.');
  const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  if (start + entry.compressedSize > blob.size) throw new Error('Truncated ZIP file entry.');
  let stream = blob.slice(start, start + entry.compressedSize).stream();
  if (entry.method === 8) {
    try { stream = stream.pipeThrough(new DecompressionStream('deflate-raw')); }
    catch { throw new Error('ZIP import requires a browser with deflate-raw support. Update your browser and try again.'); }
  }
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > entry.size || length > maxBytes) throw new Error('ZIP entry exceeds its declared size.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  if (length !== entry.size) throw new Error('ZIP entry size does not match its directory.');
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  if (crc32(output) !== entry.crc) throw new Error('ZIP entry checksum failed. The archive may be damaged.');
  return output;
}
