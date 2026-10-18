import { Transform, type TransformCallback } from "node:stream";
import { crc32 } from "node:zlib";

const MAX_METADATA_BYTES = 1024 * 1024;
export const GPS_IFD = 0x8825;
export const TYPE_SIZES: Readonly<Record<number, number>> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
};
const EXIF_HEADER = Buffer.from("Exif\0\0", "latin1");
const XMP_HEADER = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1");
const XMP_EXTENSION_HEADER = Buffer.from("http://ns.adobe.com/xmp/extension/\0", "latin1");
const PHOTOSHOP_HEADER = Buffer.from("Photoshop 3.0\0", "latin1");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IPTC_LOCATION_DATASETS = new Set([26, 27, 90, 92, 95, 100, 101]);
export const SPACE = 0x20;
const XMP_KEYWORD = "XML:com.adobe.xmp";
const RAW_PROFILE_KEYWORD = "Raw profile type ";
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_END = Buffer.from([0xff, 0xd9]);
const PNG_METADATA_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);
const REMOVED_PNG_CHUNK = "phRm";

export function stripTiffLocation(tiff: Buffer): void {
  if (tiff.length < 8) return;
  const order = tiff.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") return;
  const little = order === "II";
  const u16 = (offset: number) => (little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset));
  const u32 = (offset: number) => (little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset));
  const ifd0 = u32(4);
  if (ifd0 + 2 > tiff.length) return;
  for (let index = 0; index < u16(ifd0); index += 1) {
    const entry = ifd0 + 2 + index * 12;
    if (entry + 12 > tiff.length) return;
    if (u16(entry) !== GPS_IFD) continue;
    const gps = u32(entry + 8);
    if (gps + 2 > tiff.length) return;
    const count = u16(gps);
    for (let field = 0; field < count; field += 1) {
      const at = gps + 2 + field * 12;
      if (at + 12 > tiff.length) break;
      const size = (TYPE_SIZES[u16(at + 2)] ?? 1) * u32(at + 4);
      const value = u32(at + 8);
      if (size > 4 && value + size <= tiff.length) tiff.fill(0, value, value + size);
      tiff.fill(0, at, at + 12);
    }
    tiff.fill(0, gps, gps + 2);
  }
}

function startsWith(data: Buffer, prefix: Buffer, offset = 0): boolean {
  return (
    data.length >= offset + prefix.length && data.subarray(offset, offset + prefix.length).equals(prefix)
  );
}

export function blankIptc(data: Buffer, start: number, end: number): void {
  let at = start;
  while (at + 5 <= end && data[at] === 0x1c) {
    const record = data[at + 1];
    const dataset = data[at + 2] ?? 0;
    const length = data.readUInt16BE(at + 3);
    if (length & 0x8000) return;
    const value = at + 5;
    if (value + length > end) return;
    if (record === 2 && IPTC_LOCATION_DATASETS.has(dataset)) data.fill(SPACE, value, value + length);
    at = value + length;
  }
}

export function stripPhotoshop(data: Buffer, from = PHOTOSHOP_HEADER.length): void {
  let at = from;
  while (at + 12 <= data.length && data.toString("latin1", at, at + 4) === "8BIM") {
    const id = data.readUInt16BE(at + 4);
    const nameLength = data[at + 6] ?? 0;
    const name = 1 + nameLength + ((1 + nameLength) % 2);
    const sizeAt = at + 6 + name;
    if (sizeAt + 4 > data.length) return;
    const size = data.readUInt32BE(sizeAt);
    const start = sizeAt + 4;
    const end = Math.min(start + size, data.length);
    if (id === 0x0404) blankIptc(data, start, end);
    else if (id === 0x0422 || id === 0x0423) stripTiffLocation(data.subarray(start, end));
    else if (id === 0x0424) data.fill(SPACE, start, end);
    at = start + size + (size % 2);
  }
}

function stripJpegSegment(marker: number, segment: Buffer): void {
  const data = segment.subarray(4);
  if (marker === 0xe1) {
    if (startsWith(data, EXIF_HEADER)) stripTiffLocation(data.subarray(EXIF_HEADER.length));
    else if (startsWith(data, XMP_HEADER)) data.fill(SPACE, XMP_HEADER.length);
    else if (startsWith(data, XMP_EXTENSION_HEADER)) data.fill(SPACE, XMP_EXTENSION_HEADER.length + 40);
  } else if (marker === 0xed && startsWith(data, PHOTOSHOP_HEADER)) {
    stripPhotoshop(data);
  }
}

function stripPngChunk(type: string, chunk: Buffer): void {
  const data = chunk.subarray(8, chunk.length - 4);
  if (type === "eXIf") {
    stripTiffLocation(startsWith(data, EXIF_HEADER) ? data.subarray(EXIF_HEADER.length) : data);
  } else {
    const keywordEnd = data.indexOf(0);
    const keyword = keywordEnd < 0 ? "" : data.toString("latin1", 0, keywordEnd);
    if (keyword !== XMP_KEYWORD && !keyword.startsWith(RAW_PROFILE_KEYWORD)) return;
    chunk.write(REMOVED_PNG_CHUNK, 4, "latin1");
    data.fill(0);
  }
  chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)) >>> 0, chunk.length - 4);
}

function stripWebpChunk(type: string, chunk: Buffer): void {
  const data = chunk.subarray(8);
  if (type === "EXIF") {
    stripTiffLocation(startsWith(data, EXIF_HEADER) ? data.subarray(EXIF_HEADER.length) : data);
  } else if (type === "XMP ") {
    data.fill(SPACE);
  }
}

type Format = "detect" | "jpeg" | "scan" | "next" | "png" | "webp" | "pass";

export interface ImageDimensions {
  width: number;
  height: number;
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

export class LocationStripper extends Transform {
  #format: Format = "detect";
  #pending: Buffer = Buffer.alloc(0);
  #through = 0;
  #started = false;
  #blank = 0;
  #blankByte = 0;
  #crc: number | undefined;
  #padding = 0;
  #dimensions: ImageDimensions | null = null;

  get dimensions(): ImageDimensions | null {
    return this.#dimensions;
  }

  #measure(width: number, height: number): void {
    this.#dimensions ??= { width, height };
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.#pending = this.#pending.length > 0 ? Buffer.concat([this.#pending, chunk]) : chunk;
    try {
      this.#drain(false);
      done();
    } catch (error) {
      done(error as Error);
    }
  }

  override _flush(done: TransformCallback): void {
    this.#drain(true);
    if (this.#pending.length > 0) this.push(this.#pending);
    this.#pending = Buffer.alloc(0);
    done();
  }

  #emit(length: number): void {
    this.push(this.#pending.subarray(0, length));
    this.#pending = this.#pending.subarray(length);
  }

  #replace(segment: Buffer): void {
    this.push(segment);
    this.#pending = this.#pending.subarray(segment.length);
  }

  #startBlank(
    header: Buffer,
    length: number,
    options: { byte: number; crc?: boolean; padding?: number },
  ): void {
    this.#replace(header);
    this.#blank = length;
    this.#blankByte = options.byte;
    this.#crc = options.crc ? crc32(header.subarray(4, 8)) : undefined;
    this.#padding = options.padding ?? 0;
  }

  #drainBlank(): boolean {
    if (this.#blank > 0) {
      const length = Math.min(this.#blank, this.#pending.length);
      if (length === 0) return false;
      const filler = Buffer.alloc(length, this.#blankByte);
      if (this.#crc !== undefined) this.#crc = crc32(filler, this.#crc);
      this.push(filler);
      this.#pending = this.#pending.subarray(length);
      this.#blank -= length;
      if (this.#blank === 0 && this.#crc === undefined) this.#through = this.#padding;
      return true;
    }
    if (this.#pending.length < 4) return false;
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE((this.#crc ?? 0) >>> 0);
    this.#replace(crc);
    this.#crc = undefined;
    return true;
  }

  #drain(ending: boolean): void {
    for (;;) {
      if (this.#blank > 0 || this.#crc !== undefined) {
        if (this.#drainBlank()) continue;
        return;
      }
      if (this.#through > 0) {
        const length = Math.min(this.#through, this.#pending.length);
        if (length === 0) return;
        this.#emit(length);
        this.#through -= length;
        continue;
      }
      if (this.#format === "pass") {
        if (this.#pending.length > 0) this.#emit(this.#pending.length);
        return;
      }
      if (this.#format === "detect") {
        if (this.#pending.length < 12 && !ending) return;
        this.#format = this.#detect();
        continue;
      }
      const next =
        this.#format === "jpeg"
          ? this.#jpeg()
          : this.#format === "scan"
            ? this.#scan()
            : this.#format === "next"
              ? this.#next()
              : this.#format === "png"
                ? this.#png()
                : this.#webp();
      if (!next) {
        if (ending) this.#format = "pass";
        else return;
      }
    }
  }

  #detect(): Format {
    const head = this.#pending;
    if (head[0] === 0xff && head[1] === 0xd8) return "jpeg";
    if (startsWith(head, PNG_SIGNATURE)) return "png";
    if (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") return "webp";
    if (head.length >= 10 && /^GIF8[79]a$/.test(head.toString("latin1", 0, 6))) {
      this.#measure(head.readUInt16LE(6), head.readUInt16LE(8));
    }
    return "pass";
  }

  #jpeg(): boolean {
    const data = this.#pending;
    if (!this.#started) {
      this.#started = true;
      this.#through = 2;
      return true;
    }
    if (data.length < 2) return false;
    if (data[0] !== 0xff) {
      this.#format = "pass";
      return true;
    }
    const marker = data[1] ?? 0;
    if (marker === 0xff) {
      this.#through = 1;
      return true;
    }
    if (marker === 0xda) {
      this.#format = "scan";
      return true;
    }
    if (marker === 0xd9) {
      this.#through = 2;
      this.#format = "next";
      return true;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      this.#format = "pass";
      return true;
    }
    if (data.length < 4) return false;
    const total = 2 + data.readUInt16BE(2);
    if (isStartOfFrame(marker) && this.#dimensions === null) {
      if (data.length < 9) return false;
      this.#measure(data.readUInt16BE(7), data.readUInt16BE(5));
    }
    if (marker !== 0xe1 && marker !== 0xed) {
      this.#through = total;
      return true;
    }
    if (data.length < total) return false;
    const segment = Buffer.from(data.subarray(0, total));
    stripJpegSegment(marker, segment);
    this.#replace(segment);
    return true;
  }

  #scan(): boolean {
    const end = this.#pending.indexOf(JPEG_END);
    if (end < 0) {
      const keep = this.#pending.at(-1) === 0xff ? 1 : 0;
      if (this.#pending.length > keep) this.#emit(this.#pending.length - keep);
      return false;
    }
    this.#through = end + JPEG_END.length;
    this.#format = "next";
    return true;
  }

  #next(): boolean {
    const start = this.#pending.indexOf(JPEG_START);
    if (start < 0) {
      const keep = Math.min(this.#pending.length, JPEG_START.length - 1);
      if (this.#pending.length > keep) this.#emit(this.#pending.length - keep);
      return false;
    }
    if (start > 0) this.#emit(start);
    this.#through = 2;
    this.#format = "jpeg";
    return true;
  }

  #png(): boolean {
    if (!this.#started) {
      this.#started = true;
      this.#through = PNG_SIGNATURE.length;
      return true;
    }
    const data = this.#pending;
    if (data.length < 8) return false;
    const total = 12 + data.readUInt32BE(0);
    const type = data.toString("latin1", 4, 8);
    if (type === "IHDR" && this.#dimensions === null) {
      if (data.length < 16) return false;
      this.#measure(data.readUInt32BE(8), data.readUInt32BE(12));
    }
    if (!PNG_METADATA_CHUNKS.has(type)) {
      this.#through = total;
      return true;
    }
    if (total > MAX_METADATA_BYTES) {
      const header = Buffer.from(data.subarray(0, 8));
      header.write(REMOVED_PNG_CHUNK, 4, "latin1");
      this.#startBlank(header, total - 12, { byte: 0, crc: true });
      return true;
    }
    if (data.length < total) return false;
    const segment = Buffer.from(data.subarray(0, total));
    stripPngChunk(type, segment);
    this.#replace(segment);
    return true;
  }

  #measureWebp(type: string, data: Buffer): boolean {
    if (type === "VP8X") {
      if (data.length < 18) return false;
      this.#measure(1 + data.readUIntLE(12, 3), 1 + data.readUIntLE(15, 3));
    } else if (type === "VP8 ") {
      if (data.length < 18) return false;
      if (data[11] === 0x9d && data[12] === 0x01 && data[13] === 0x2a) {
        this.#measure(data.readUInt16LE(14) & 0x3fff, data.readUInt16LE(16) & 0x3fff);
      }
    } else if (type === "VP8L") {
      if (data.length < 13) return false;
      if (data[8] === 0x2f) {
        const bits = data.readUInt32LE(9);
        this.#measure((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
    }
    return true;
  }

  #webp(): boolean {
    if (!this.#started) {
      this.#started = true;
      this.#through = 12;
      return true;
    }
    const data = this.#pending;
    if (data.length < 8) return false;
    const size = data.readUInt32LE(4);
    const total = 8 + size + (size % 2);
    const type = data.toString("latin1", 0, 4);
    if (this.#dimensions === null && !this.#measureWebp(type, data)) return false;
    if (type !== "EXIF" && type !== "XMP ") {
      this.#through = total;
      return true;
    }
    if (total > MAX_METADATA_BYTES) {
      this.#startBlank(Buffer.from(data.subarray(0, 8)), size, {
        byte: type === "XMP " ? SPACE : 0,
        padding: size % 2,
      });
      return true;
    }
    if (data.length < total) return false;
    const segment = Buffer.from(data.subarray(0, total));
    stripWebpChunk(type, segment);
    this.#replace(segment);
    return true;
  }
}
