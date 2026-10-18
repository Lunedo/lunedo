interface Entry {
  tag: number;
  type: number;
  count: number;
  value: number | Buffer;
}

const SHORT = 3;
const LONG = 4;
const ASCII = 2;
const RATIONAL = 5;
const BYTE = 1;

function directory(
  entries: Entry[],
  at: number,
  data: Buffer[],
  dataAt: number,
): { ifd: Buffer; data: number } {
  const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
  ifd.writeUInt16LE(entries.length, 0);
  let next = dataAt;
  entries
    .sort((first, second) => first.tag - second.tag)
    .forEach((entry, index) => {
      const offset = 2 + index * 12;
      ifd.writeUInt16LE(entry.tag, offset);
      ifd.writeUInt16LE(entry.type, offset + 2);
      ifd.writeUInt32LE(entry.count, offset + 4);
      if (typeof entry.value === "number") {
        if (entry.type === SHORT) ifd.writeUInt16LE(entry.value, offset + 8);
        else ifd.writeUInt32LE(entry.value, offset + 8);
      } else if (entry.value.length <= 4) {
        entry.value.copy(ifd, offset + 8);
      } else {
        ifd.writeUInt32LE(next, offset + 8);
        data.push(entry.value);
        next += entry.value.length + (entry.value.length % 2);
        if (entry.value.length % 2) data.push(Buffer.alloc(1));
      }
    });
  return { ifd, data: next - at };
}

export function tiffWithLocation(options: { xmp: string; directoryAtEnd: boolean }): Buffer {
  const width = 4;
  const height = 2;
  const pixels = Buffer.from(Array.from({ length: width * height }, (_, index) => index * 30));
  const latitude = Buffer.alloc(24);
  for (const [index, value] of [48, 1, 12, 1, 30, 1].entries()) latitude.writeUInt32LE(value, index * 4);
  const xmp = Buffer.from(options.xmp, "utf8");

  const header = Buffer.alloc(8);
  header.write("II", 0, "latin1");
  header.writeUInt16LE(42, 2);
  const pixelsAt = 8;
  const gpsAt = options.directoryAtEnd ? 0 : pixelsAt + pixels.length;
  const gpsEntries: Entry[] = [
    { tag: 1, type: ASCII, count: 2, value: Buffer.from("N\0", "latin1") },
    { tag: 2, type: RATIONAL, count: 3, value: latitude },
  ];
  const gpsSize = 2 + gpsEntries.length * 12 + 4;
  const build = (gpsOffset: number, ifdOffset: number) => {
    const gpsData: Buffer[] = [];
    const gps = directory(gpsEntries, gpsOffset, gpsData, gpsOffset + gpsSize);
    const ifdEntries: Entry[] = [
      { tag: 256, type: SHORT, count: 1, value: width },
      { tag: 257, type: SHORT, count: 1, value: height },
      { tag: 258, type: SHORT, count: 1, value: 8 },
      { tag: 259, type: SHORT, count: 1, value: 1 },
      { tag: 262, type: SHORT, count: 1, value: 1 },
      { tag: 273, type: LONG, count: 1, value: pixelsAt },
      { tag: 274, type: SHORT, count: 1, value: 6 },
      { tag: 277, type: SHORT, count: 1, value: 1 },
      { tag: 278, type: SHORT, count: 1, value: height },
      { tag: 279, type: LONG, count: 1, value: pixels.length },
      { tag: 700, type: BYTE, count: xmp.length, value: xmp },
      { tag: 0x8825, type: LONG, count: 1, value: gpsOffset },
    ];
    const ifdSize = 2 + ifdEntries.length * 12 + 4;
    const ifdData: Buffer[] = [];
    const ifd = directory(ifdEntries, ifdOffset, ifdData, ifdOffset + ifdSize);
    return { gps: Buffer.concat([gps.ifd, ...gpsData]), ifd: Buffer.concat([ifd.ifd, ...ifdData]) };
  };
  if (!options.directoryAtEnd) {
    const probe = build(gpsAt, 0);
    const ifdAt = gpsAt + probe.gps.length;
    const parts = build(gpsAt, ifdAt);
    header.writeUInt32LE(ifdAt, 4);
    return Buffer.concat([header, pixels, parts.gps, parts.ifd]);
  }
  const ifdAt = pixelsAt + pixels.length;
  const probe = build(0, ifdAt);
  const gpsOffset = ifdAt + probe.ifd.length;
  const parts = build(gpsOffset, ifdAt);
  header.writeUInt32LE(ifdAt, 4);
  return Buffer.concat([header, pixels, parts.ifd, parts.gps]);
}
