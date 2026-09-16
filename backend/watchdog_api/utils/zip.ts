/**
 * Minimal store-only ZIP writer.
 *
 * `01_ARCHITECTURE.md`: "Do not introduce a dependency that is not needed by
 * the current epic. Every dependency is a thing that can break at 2am with no
 * maintainer awake." A diagnostic bundle is one archive of a handful of small
 * text files, produced on demand; that does not justify a compression library,
 * and the store-only ZIP format is small enough to implement completely here.
 *
 * Store-only (method 0) means no compression — the bundle is a little larger
 * and every byte of it is inspectable with any unzip tool.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, forward slashes. */
  name: string;
  content: Buffer;
}

/**
 * All timestamps are fixed rather than read from the clock, so two bundles
 * built from the same inputs are byte-identical — the determinism rule in
 * `CLAUDE.md` applies to diagnostic artifacts too.
 */
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 0x0021; // 1980-01-01, the DOS epoch

export function createZip(entries: readonly ZipEntry[]): Buffer {
  // Deterministic ordering: two bundles with the same files zip identically.
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of sorted) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const crc = crc32(entry.content);
    const size = entry.content.length;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(0, 8);            // method 0 = stored
    local.writeUInt16LE(FIXED_DOS_TIME, 10);
    local.writeUInt16LE(FIXED_DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);        // compressed size
    local.writeUInt32LE(size, 22);        // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra length
    nameBuf.copy(local, 30);

    locals.push(local, entry.content);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(FIXED_DOS_TIME, 12);
    central.writeUInt16LE(FIXED_DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra
    central.writeUInt16LE(0, 32);         // comment
    central.writeUInt16LE(0, 34);         // disk number
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0, 38);         // external attrs
    central.writeUInt32LE(offset, 42);    // local header offset
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + size;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

/** Reads a store-only archive back, for tests and for inspection tooling. */
export function readZip(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let pos = 0;
  while (pos + 4 <= buf.length && buf.readUInt32LE(pos) === 0x04034b50) {
    const size = buf.readUInt32LE(pos + 18);
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const name = buf.subarray(pos + 30, pos + 30 + nameLen).toString('utf-8');
    const start = pos + 30 + nameLen + extraLen;
    entries.push({ name, content: buf.subarray(start, start + size) });
    pos = start + size;
  }
  return entries;
}
