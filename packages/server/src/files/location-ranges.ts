import { Transform, type TransformCallback } from "node:stream";
import {
  blankIptc,
  GPS_IFD,
  SPACE,
  stripPhotoshop,
  stripTiffLocation,
  TYPE_SIZES,
} from "./location-metadata.js";

export interface RandomAccess {
  size: number;
  read(offset: number, length: number): Promise<Buffer>;
}

export interface Patch {
  offset: number;
  length: number;
  data?: Buffer;
  byte?: number;
}

export const RANDOM_ACCESS_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/tiff",
  "image/heic",
  "image/heif",
  "image/avif",
]);

const MAX_IFDS = 64;
const MAX_ENTRIES = 4096;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_TOTAL_READ_BYTES = 16 * 1024 * 1024;
const READ_COST = 64 * 1024;
const MAX_PATCHES = 10_000;
const MAX_BOXES = 4096;
const MAX_ITEMS = 65_536;
const XMP_TAG = 700;
const IPTC_TAG = 33_723;
const PHOTOSHOP_TAG = 34_377;
const XMP_CONTENT_TYPE = "application/rdf+xml";

class Unsupported extends Error {
  override name = "Unsupported";
}

class Reader {
  readonly size: number;
  readonly #file: RandomAccess;
  #read = 0;
  #patches = 0;
  #patched = 0;

  constructor(file: RandomAccess) {
    this.#file = file;
    this.size = file.size;
  }

  async read(offset: number, length: number): Promise<Buffer> {
    if (offset < 0 || length < 0 || offset + length > this.size) throw new Unsupported("Outside the file");
    if (length > MAX_READ_BYTES) throw new Unsupported("Metadata too large to read");
    this.#read += Math.max(length, READ_COST);
    if (this.#read > MAX_TOTAL_READ_BYTES) throw new Unsupported("Too much metadata to read");
    return this.#file.read(offset, length);
  }

  count(patches: Patch[]): Patch[] {
    for (const patch of patches) {
      this.#patches += 1;
      this.#patched += patch.length;
    }
    if (this.#patches > MAX_PATCHES || this.#patched > this.size) throw new Unsupported("Too many changes");
    return patches;
  }
}

function changedRanges(before: Buffer, after: Buffer, position: (index: number) => number): Patch[] {
  const patches: Patch[] = [];
  let start = -1;
  const close = (end: number) => {
    if (start < 0) return;
    let from = start;
    for (let index = start + 1; index <= end; index += 1) {
      if (index === end || position(index) !== position(index - 1) + 1) {
        patches.push({
          offset: position(from),
          length: index - from,
          data: Buffer.from(after.subarray(from, index)),
        });
        from = index;
      }
    }
    start = -1;
  };
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] !== after[index]) {
      if (start < 0) start = index;
    } else {
      close(index);
    }
  }
  close(before.length);
  return patches;
}

function fill(file: Reader, offset: number, length: number, byte: number): Patch {
  if (offset < 0 || length < 0 || offset + length > file.size) throw new Unsupported("Outside the file");
  return file.count([{ offset, length, byte }])[0] as Patch;
}

async function rewritten(
  file: Reader,
  offset: number,
  length: number,
  change: (copy: Buffer) => void,
): Promise<Patch[]> {
  const original = await file.read(offset, length);
  const copy = Buffer.from(original);
  change(copy);
  return file.count(changedRanges(original, copy, (index) => offset + index));
}

async function tiffPatches(file: Reader): Promise<Patch[]> {
  const header = await file.read(0, 8);
  const order = header.toString("latin1", 0, 2);
  const little = order === "II";
  const u16 = (data: Buffer, at: number) => (little ? data.readUInt16LE(at) : data.readUInt16BE(at));
  const u32 = (data: Buffer, at: number) => (little ? data.readUInt32LE(at) : data.readUInt32BE(at));
  if ((order !== "II" && order !== "MM") || u16(header, 2) !== 42)
    throw new Unsupported("Not a classic TIFF");
  const patches: Patch[] = [];
  const seen = new Set<number>();
  const gpsSeen = new Set<number>();
  let ifd = u32(header, 4);
  while (ifd !== 0 && !seen.has(ifd) && seen.size < MAX_IFDS) {
    seen.add(ifd);
    const count = u16(await file.read(ifd, 2), 0);
    if (count > MAX_ENTRIES) throw new Unsupported("Too many TIFF entries");
    const entries = await file.read(ifd + 2, count * 12 + 4);
    for (let index = 0; index < count; index += 1) {
      const at = index * 12;
      const tag = u16(entries, at);
      const size = (TYPE_SIZES[u16(entries, at + 2)] ?? 1) * u32(entries, at + 4);
      const value = size > 4 ? u32(entries, at + 8) : ifd + 2 + at + 8;
      if (tag === GPS_IFD) {
        const gps = u32(entries, at + 8);
        if (!gpsSeen.has(gps)) patches.push(...(await gpsPatches(file, gps, u16, u32)));
        gpsSeen.add(gps);
      } else if (tag === XMP_TAG) patches.push(fill(file, value, size, SPACE));
      else if (tag === IPTC_TAG)
        patches.push(...(await rewritten(file, value, size, (copy) => blankIptc(copy, 0, copy.length))));
      else if (tag === PHOTOSHOP_TAG)
        patches.push(...(await rewritten(file, value, size, (copy) => stripPhotoshop(copy, 0))));
    }
    ifd = u32(entries, count * 12);
  }
  if (ifd !== 0 && !seen.has(ifd)) throw new Unsupported("Too many TIFF directories");
  return patches;
}

async function gpsPatches(
  file: Reader,
  gps: number,
  u16: (data: Buffer, at: number) => number,
  u32: (data: Buffer, at: number) => number,
): Promise<Patch[]> {
  const count = u16(await file.read(gps, 2), 0);
  if (count > MAX_ENTRIES) throw new Unsupported("Too many GPS entries");
  const entries = await file.read(gps + 2, count * 12);
  const patches: Patch[] = [fill(file, gps, 2 + count * 12, 0)];
  for (let index = 0; index < count; index += 1) {
    const at = index * 12;
    const size = (TYPE_SIZES[u16(entries, at + 2)] ?? 1) * u32(entries, at + 4);
    if (size > 4) {
      const value = u32(entries, at + 8);
      patches.push(fill(file, value, size, 0));
    }
  }
  return patches;
}

interface Box {
  type: string;
  start: number;
  body: number;
  end: number;
}

async function boxes(file: Reader, start: number, end: number): Promise<Box[]> {
  const found: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    if (found.length >= MAX_BOXES) throw new Unsupported("Too many boxes");
    const header = await file.read(at, Math.min(16, end - at));
    let size = header.readUInt32BE(0);
    let body = at + 8;
    if (size === 1) {
      if (header.length < 16) throw new Unsupported("Truncated box");
      size = Number(header.readBigUInt64BE(8));
      body = at + 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < body - at || at + size > end) throw new Unsupported("Box outside its parent");
    found.push({ type: header.toString("latin1", 4, 8), start: at, body, end: at + size });
    at += size;
  }
  return found;
}

function boxesIn(data: Buffer, start: number): { type: string; body: number; end: number }[] {
  const found: { type: string; body: number; end: number }[] = [];
  let at = start;
  while (at + 8 <= data.length) {
    if (found.length >= MAX_BOXES) throw new Unsupported("Too many boxes");
    let size = data.readUInt32BE(at);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > data.length) throw new Unsupported("Truncated box");
      size = Number(data.readBigUInt64BE(at + 8));
      body = at + 16;
    } else if (size === 0) {
      size = data.length - at;
    }
    if (size < body - at || at + size > data.length) throw new Unsupported("Box outside its parent");
    found.push({ type: data.toString("latin1", at + 4, at + 8), body, end: at + size });
    at += size;
  }
  return found;
}

function unsigned(data: Buffer, at: number, size: number): number {
  if (size === 0) return 0;
  if (size === 2) return data.readUInt16BE(at);
  if (size === 4) return data.readUInt32BE(at);
  if (size === 8) return Number(data.readBigUInt64BE(at));
  throw new Unsupported("Unknown field size");
}

function cString(data: Buffer, at: number): { value: string; next: number } {
  const end = data.indexOf(0, at);
  const stop = end < 0 ? data.length : end;
  return { value: data.toString("utf8", at, stop), next: stop + 1 };
}

async function itemTypes(file: Reader, box: Box): Promise<Map<number, string>> {
  const data = await file.read(box.body, box.end - box.body);
  const version = data[0] ?? 0;
  const first = version === 0 ? 6 : 8;
  const types = new Map<number, string>();
  for (const entry of boxesIn(data, first)) {
    if (entry.type !== "infe") continue;
    const infe = data.subarray(entry.body, entry.end);
    const infeVersion = infe[0] ?? 0;
    if (infeVersion < 2) throw new Unsupported("Item information without a type");
    const id = infeVersion === 2 ? infe.readUInt16BE(4) : infe.readUInt32BE(4);
    const typeAt = infeVersion === 2 ? 8 : 10;
    const type = infe.toString("latin1", typeAt, typeAt + 4);
    if (type === "Exif") types.set(id, "Exif");
    if (type === "mime") {
      const name = cString(infe, typeAt + 4);
      const contentType = cString(infe, name.next).value.split(";")[0]?.trim().toLowerCase();
      if (contentType === XMP_CONTENT_TYPE) types.set(id, "XMP");
    }
  }
  return types;
}

interface Extent {
  offset: number;
  length: number;
}

async function itemExtents(
  file: Reader,
  box: Box,
  wanted: ReadonlySet<number>,
  idat: Box | undefined,
): Promise<Map<number, Extent[]>> {
  const data = await file.read(box.body, box.end - box.body);
  const version = data[0] ?? 0;
  const offsetSize = (data[4] ?? 0) >> 4;
  const lengthSize = (data[4] ?? 0) & 0x0f;
  const baseOffsetSize = (data[5] ?? 0) >> 4;
  const indexSize = version === 1 || version === 2 ? (data[5] ?? 0) & 0x0f : 0;
  for (const size of [offsetSize, lengthSize, baseOffsetSize, indexSize]) {
    if (size !== 0 && size !== 4 && size !== 8) throw new Unsupported("Unknown field size");
  }
  const extentBytes = indexSize + offsetSize + lengthSize;
  let totalExtents = 0;
  let at = 6;
  const count = version < 2 ? data.readUInt16BE(at) : data.readUInt32BE(at);
  at += version < 2 ? 2 : 4;
  if (count > MAX_ITEMS) throw new Unsupported("Too many items");
  const found = new Map<number, Extent[]>();
  for (let item = 0; item < count; item += 1) {
    const id = version < 2 ? data.readUInt16BE(at) : data.readUInt32BE(at);
    at += version < 2 ? 2 : 4;
    let method = 0;
    if (version === 1 || version === 2) {
      method = data.readUInt16BE(at) & 0x0f;
      at += 2;
    }
    at += 2;
    const base = unsigned(data, at, baseOffsetSize);
    at += baseOffsetSize;
    const extentCount = data.readUInt16BE(at);
    at += 2;
    totalExtents += extentCount;
    if (totalExtents > MAX_ITEMS) throw new Unsupported("Too many extents");
    if (at + extentCount * extentBytes > data.length) throw new Unsupported("Extents outside the box");
    if (!wanted.has(id)) {
      at += extentCount * extentBytes;
      continue;
    }
    const extents: Extent[] = [];
    for (let index = 0; index < extentCount; index += 1) {
      at += indexSize;
      const offset = unsigned(data, at, offsetSize);
      at += offsetSize;
      const length = unsigned(data, at, lengthSize);
      at += lengthSize;
      extents.push({ offset, length });
    }
    if (method === 1 && !idat) throw new Unsupported("Item in a missing idat box");
    if (method > 1) throw new Unsupported("Item stored in another item");
    const origin = method === 1 && idat ? idat.body : 0;
    found.set(
      id,
      extents.map((extent) => {
        if (extent.length === 0) throw new Unsupported("Item without a length");
        return { offset: origin + base + extent.offset, length: extent.length };
      }),
    );
  }
  return found;
}

async function exifItemPatches(file: Reader, extents: Extent[]): Promise<Patch[]> {
  const length = extents.reduce((sum, extent) => sum + extent.length, 0);
  if (length > MAX_READ_BYTES) throw new Unsupported("Exif item too large");
  const positions: number[] = [];
  const parts: Buffer[] = [];
  for (const extent of extents) {
    parts.push(await file.read(extent.offset, extent.length));
    for (let index = 0; index < extent.length; index += 1) positions.push(extent.offset + index);
  }
  const original = Buffer.concat(parts);
  if (original.length < 4) throw new Unsupported("Exif item too short");
  const tiffAt = 4 + original.readUInt32BE(0);
  if (tiffAt + 8 > original.length) throw new Unsupported("Exif item without its TIFF header");
  const copy = Buffer.from(original);
  stripTiffLocation(copy.subarray(tiffAt));
  return file.count(changedRanges(original, copy, (index) => positions[index] ?? 0));
}

async function heifPatches(file: Reader): Promise<Patch[]> {
  const top = await boxes(file, 0, file.size);
  const metas = top.filter((box) => box.type === "meta");
  if (metas.length > 1 || top.some((box) => box.type === "moov")) {
    throw new Unsupported("Image sequence or several metadata boxes");
  }
  const meta = metas[0];
  if (!meta) return [];
  const children = await boxes(file, meta.body + 4, meta.end);
  const iinf = children.find((box) => box.type === "iinf");
  const iloc = children.find((box) => box.type === "iloc");
  if (!iinf || !iloc) return [];
  const types = await itemTypes(file, iinf);
  if (types.size === 0) return [];
  const extents = await itemExtents(
    file,
    iloc,
    new Set(types.keys()),
    children.find((box) => box.type === "idat"),
  );
  const patches: Patch[] = [];
  for (const [id, type] of types) {
    const item = extents.get(id);
    if (!item) throw new Unsupported("Metadata item without a location");
    if (type === "Exif") patches.push(...(await exifItemPatches(file, item)));
    else for (const extent of item) patches.push(fill(file, extent.offset, extent.length, SPACE));
  }
  return patches;
}

export class UnsupportedLocationMetadata extends Error {
  override name = "UnsupportedLocationMetadata";
}

export async function locationPatches(contentType: string, source: RandomAccess): Promise<Patch[]> {
  try {
    const file = new Reader(source);
    const patches = contentType === "image/tiff" ? await tiffPatches(file) : await heifPatches(file);
    return patches.sort((first, second) => first.offset - second.offset);
  } catch (error) {
    if (error instanceof Unsupported || error instanceof RangeError) {
      throw new UnsupportedLocationMetadata(error.message);
    }
    throw error;
  }
}

export class PatchStream extends Transform {
  readonly #patches: Patch[];
  #position = 0;
  #next = 0;

  constructor(patches: Patch[]) {
    super();
    this.#patches = [...patches].sort((first, second) => first.offset - second.offset);
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    const start = this.#position;
    const end = start + chunk.length;
    while (this.#next < this.#patches.length) {
      const patch = this.#patches[this.#next] as Patch;
      if (patch.offset + patch.length > start) break;
      this.#next += 1;
    }
    let output = chunk;
    for (let index = this.#next; index < this.#patches.length; index += 1) {
      const patch = this.#patches[index] as Patch;
      if (patch.offset >= end) break;
      const from = Math.max(patch.offset, start);
      const to = Math.min(patch.offset + patch.length, end);
      if (from >= to) continue;
      if (output === chunk) output = Buffer.from(chunk);
      if (patch.data) patch.data.copy(output, from - start, from - patch.offset, to - patch.offset);
      else output.fill(patch.byte ?? 0, from - start, to - start);
    }
    this.#position = end;
    done(null, output);
  }
}
