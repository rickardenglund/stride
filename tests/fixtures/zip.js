import { deflateRawSync } from 'node:zlib';

// Minimal anonymous ZIP fixtures exercise the real reader, including checksums.
export function zip(files, method = 8) {
  const localParts = [], directoryParts = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = Buffer.from(name), bytes = Buffer.from(text);
    let crc = -1;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ -1) >>> 0;
    const packed = method === 8 ? deflateRawSync(bytes) : bytes;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, packed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(packed.length, 20);
    directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(nameBytes.length, 28);
    directory.writeUInt32LE(offset, 42);
    directoryParts.push(directory, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(directoryParts), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return new Blob([...localParts, directory, end]);
}

