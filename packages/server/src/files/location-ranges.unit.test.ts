import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { gpsFields } from "./exif.testing.js";
import {
  locationPatches,
  PatchStream,
  type RandomAccess,
  UnsupportedLocationMetadata,
} from "./location-ranges.js";
import { tiffWithLocation } from "./tiff.testing.js";

const XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="48,12.5N"/></rdf:RDF></x:xmpmeta>';

function access(data: Buffer): RandomAccess {
  return { size: data.length, read: async (offset, length) => data.subarray(offset, offset + length) };
}

async function patched(contentType: string, data: Buffer, chunk = 7): Promise<Buffer> {
  const patches = await locationPatches(contentType, access(data));
  const parts: Buffer[] = [];
  for (let at = 0; at < data.length; at += chunk) parts.push(Buffer.from(data.subarray(at, at + chunk)));
  return buffer(Readable.from(parts).pipe(new PatchStream(patches)));
}

const pixels = (data: Buffer) => sharp(data).raw().toBuffer();

describe("location metadata at offsets", () => {
  it.each(["avif", "heif"] as const)("removes GPS fields and XMP from a %s image", async (format) => {
    const image = sharp({ create: { width: 64, height: 32, channels: 3, background: "#336699" } })
      .withExif({ IFD0: { Copyright: "Test" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 12/1 30/1" } })
      .withXmp(XMP);
    const original = await (format === "avif" ? image.avif() : image.heif({ compression: "av1" })).toBuffer();
    expect(gpsFields((await sharp(original).metadata()).exif)).toBeGreaterThan(0);

    const result = await patched("image/avif", original);

    expect(result.length).toBe(original.length);
    const after = await sharp(result).metadata();
    expect(gpsFields(after.exif)).toBe(0);
    expect(after.exif?.toString("latin1")).toContain("Test");
    expect(result.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect((await pixels(result)).equals(await pixels(original))).toBe(true);
  });

  it.each([false, true])(
    "removes GPS fields and XMP from a TIFF (directory at the end: %s)",
    async (atEnd) => {
      const original = tiffWithLocation({ xmp: XMP, directoryAtEnd: atEnd });
      const before = await sharp(original).metadata();
      expect(before.orientation).toBe(6);
      expect(original.includes(Buffer.from("GPSLatitude"))).toBe(true);
      expect(original.includes(Buffer.from("N\0", "latin1"))).toBe(true);

      const result = await patched("image/tiff", original);

      expect(result.length).toBe(original.length);
      expect(result.includes(Buffer.from("GPSLatitude"))).toBe(false);
      const after = await sharp(result).metadata();
      expect(after.orientation).toBe(6);
      expect(result.subarray(0, 4).equals(original.subarray(0, 4))).toBe(true);
      expect((await pixels(result)).equals(await pixels(original))).toBe(true);
      expect(tiffGpsCount(result)).toBe(0);
      expect(tiffGpsCount(original)).toBe(2);
    },
  );

  it("refuses structures it cannot follow instead of guessing", async () => {
    const bigTiff = Buffer.from([0x49, 0x49, 0x2b, 0x00, 0x08, 0x00, 0x00, 0x00]);
    await expect(locationPatches("image/tiff", access(bigTiff))).rejects.toBeInstanceOf(
      UnsupportedLocationMetadata,
    );
    const outside = tiffWithLocation({ xmp: XMP, directoryAtEnd: false });
    outside.writeUInt32LE(outside.length + 100, 4);
    await expect(locationPatches("image/tiff", access(outside))).rejects.toBeInstanceOf(
      UnsupportedLocationMetadata,
    );
    const chain = tiffWithLocation({ xmp: XMP, directoryAtEnd: false });
    const first = chain.readUInt32LE(4);
    const entries = chain.readUInt16LE(first);
    const nextAt = first + 2 + entries * 12;
    const directories = Buffer.alloc(70 * 6);
    for (let index = 0; index < 70; index += 1) {
      directories.writeUInt16LE(0, index * 6);
      directories.writeUInt32LE(index === 69 ? 0 : chain.length + (index + 1) * 6, index * 6 + 2);
    }
    const long = Buffer.concat([chain, directories]);
    long.writeUInt32LE(chain.length, nextAt);
    await expect(locationPatches("image/tiff", access(long))).rejects.toBeInstanceOf(
      UnsupportedLocationMetadata,
    );
    const twoMeta = Buffer.concat([
      Buffer.from([0, 0, 0, 16]),
      Buffer.from("ftypavif", "latin1"),
      Buffer.alloc(4),
      Buffer.from([0, 0, 0, 12]),
      Buffer.from("meta", "latin1"),
      Buffer.alloc(4),
      Buffer.from([0, 0, 0, 12]),
      Buffer.from("meta", "latin1"),
      Buffer.alloc(4),
    ]);
    await expect(locationPatches("image/avif", access(twoMeta))).rejects.toBeInstanceOf(
      UnsupportedLocationMetadata,
    );
  });

  it("refuses files whose entries would change more bytes than the file has", async () => {
    const entries = 200;
    const size = 8 + 2 + entries * 12 + 4 + 1000;
    const tiff = Buffer.alloc(size);
    tiff.write("II", 0, "latin1");
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(entries, 8);
    for (let index = 0; index < entries; index += 1) {
      const at = 10 + index * 12;
      tiff.writeUInt16LE(700, at);
      tiff.writeUInt16LE(1, at + 2);
      tiff.writeUInt32LE(size - 16, at + 4);
      tiff.writeUInt32LE(16, at + 8);
    }
    await expect(locationPatches("image/tiff", access(tiff))).rejects.toBeInstanceOf(
      UnsupportedLocationMetadata,
    );
  });

  it("refuses files that would need more small reads than the budget allows", async () => {
    const entries = 1000;
    const size = 8 + 2 + entries * 12 + 4 + 64;
    const tiff = Buffer.alloc(size);
    tiff.write("II", 0, "latin1");
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(entries, 8);
    for (let index = 0; index < entries; index += 1) {
      const at = 10 + index * 12;
      tiff.writeUInt16LE(33_723, at);
      tiff.writeUInt16LE(7, at + 2);
      tiff.writeUInt32LE(8, at + 4);
      tiff.writeUInt32LE(size - 64, at + 8);
    }
    let reads = 0;
    const counted: RandomAccess = {
      size,
      read: async (offset, length) => {
        reads += 1;
        return tiff.subarray(offset, offset + length);
      },
    };
    await expect(locationPatches("image/tiff", counted)).rejects.toBeInstanceOf(UnsupportedLocationMetadata);
    expect(reads).toBeLessThanOrEqual(256);
  });

  it("refuses item locations with empty fields and huge extent counts without walking them", async () => {
    const box = (type: string, body: Buffer) => {
      const header = Buffer.alloc(8);
      header.writeUInt32BE(8 + body.length, 0);
      header.write(type, 4, "latin1");
      return Buffer.concat([header, body]);
    };
    const infe = box(
      "infe",
      Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 1, 0, 0]), Buffer.from("Exif\0", "latin1")]),
    );
    const iinf = box("iinf", Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 1]), infe]));
    const items = 1000;
    const iloc = Buffer.alloc(8 + items * 6);
    iloc.writeUInt16BE(items, 6);
    for (let index = 0; index < items; index += 1) {
      iloc.writeUInt16BE(index + 2, 8 + index * 6);
      iloc.writeUInt16BE(0xffff, 8 + index * 6 + 4);
    }
    const meta = box("meta", Buffer.concat([Buffer.alloc(4), iinf, box("iloc", iloc)]));
    const file = Buffer.concat([box("ftyp", Buffer.from("avif\0\0\0\0", "latin1")), meta]);
    const started = performance.now();
    await expect(locationPatches("image/avif", access(file))).rejects.toBeInstanceOf(
      UnsupportedLocationMetadata,
    );
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("leaves images without location metadata alone", async () => {
    const plain = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000000" } })
      .avif()
      .toBuffer();
    expect(await locationPatches("image/avif", access(plain))).toEqual([]);
  });
});

function tiffGpsCount(data: Buffer): number {
  const ifd = data.readUInt32LE(4);
  const count = data.readUInt16LE(ifd);
  for (let index = 0; index < count; index += 1) {
    const at = ifd + 2 + index * 12;
    if (data.readUInt16LE(at) === 0x8825) return data.readUInt16LE(data.readUInt32LE(at + 8));
  }
  return -1;
}
