import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { gpsFields } from "./exif.testing.js";
import { LocationStripper } from "./location-metadata.js";

const XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="48,12.5N"/></rdf:RDF></x:xmpmeta>';

async function photo(format: "jpeg" | "png" | "webp"): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 32, channels: 3, background: "#3366cc" } })
    .withExif({ IFD0: { Copyright: "Test" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 12/1 30/1" } })
    .withMetadata({ orientation: 6 })
    .withXmp(XMP)
    [format]()
    .toBuffer();
}

async function stripped(data: Buffer, chunk = 7): Promise<Buffer> {
  const parts: Buffer[] = [];
  for (let at = 0; at < data.length; at += chunk) parts.push(Buffer.from(data.subarray(at, at + chunk)));
  return buffer(Readable.from(parts).pipe(new LocationStripper()));
}

describe("location metadata", () => {
  it.each(["jpeg", "png", "webp"] as const)(
    "removes GPS fields and XMP from a %s and keeps the orientation and the image",
    async (format) => {
      const original = await photo(format);
      const before = await sharp(original).metadata();
      expect(gpsFields(before.exif)).toBeGreaterThan(0);
      expect(before.xmp?.toString("utf8")).toContain("GPSLatitude");

      const result = await stripped(original);

      expect(result.length).toBe(original.length);
      const after = await sharp(result).metadata();
      expect(gpsFields(after.exif)).toBe(0);
      expect(after.xmp?.toString("utf8") ?? "").not.toContain("GPSLatitude");
      expect(after.orientation).toBe(6);
      expect(after.exif?.toString("latin1")).toContain("Test");
      const pixels = async (data: Buffer) => sharp(data).raw().toBuffer();
      expect((await pixels(result)).equals(await pixels(original))).toBe(true);
    },
  );

  it("works whatever size the chunks of the upload have", async () => {
    const original = await photo("jpeg");
    const whole = await stripped(original, original.length);
    for (const chunk of [1, 2, 3, 64]) expect((await stripped(original, chunk)).equals(whole)).toBe(true);
  });

  it("removes location fields from IPTC data of a JPEG", async () => {
    const city = Buffer.from("Graz", "latin1");
    const caption = Buffer.from("Server room", "latin1");
    const dataset = (number: number, value: Buffer) =>
      Buffer.concat([Buffer.from([0x1c, 2, number, 0, value.length]), value]);
    const iptc = Buffer.concat([dataset(90, city), dataset(120, caption)]);
    const resource = Buffer.concat([
      Buffer.from("8BIM", "latin1"),
      Buffer.from([0x04, 0x04, 0, 0]),
      Buffer.alloc(4),
      iptc,
    ]);
    resource.writeUInt32BE(iptc.length, 8);
    const body = Buffer.concat([Buffer.from("Photoshop 3.0\0", "latin1"), resource]);
    const segment = Buffer.concat([Buffer.from([0xff, 0xed, 0, 0]), body]);
    segment.writeUInt16BE(body.length + 2, 2);
    const original = await photo("jpeg");
    const withIptc = Buffer.concat([original.subarray(0, 2), segment, original.subarray(2)]);

    const result = await stripped(withIptc);

    expect(result.length).toBe(withIptc.length);
    expect(result.includes(city)).toBe(false);
    expect(result.includes(caption)).toBe(true);
    expect((await sharp(result).raw().toBuffer()).equals(await sharp(original).raw().toBuffer())).toBe(true);
  });

  it.each(["png", "webp"] as const)(
    "blanks metadata of a %s that is too large to read at once",
    async (format) => {
      const large = XMP.replace(
        "<rdf:Description",
        `<rdf:Description data="${randomBytes(1.5 * 1024 * 1024).toString("base64")}"`,
      );
      const original = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#ff0000" } })
        .withXmp(large)
        [format]()
        .toBuffer();
      expect((await sharp(original).metadata()).xmp?.toString("utf8")).toContain("GPSLatitude");

      const result = await stripped(original, 4096);

      expect(result.length).toBe(original.length);
      expect((await sharp(result).metadata()).xmp?.toString("utf8") ?? "").not.toContain("GPSLatitude");
      expect(result.includes(Buffer.from("GPSLatitude"))).toBe(false);
      expect((await sharp(result).raw().toBuffer()).equals(await sharp(original).raw().toBuffer())).toBe(
        true,
      );
    },
  );

  it("removes location fields from images embedded after the first one in a JPEG", async () => {
    const first = await photo("jpeg");
    const second = await photo("jpeg");
    const original = Buffer.concat([first, second]);

    const result = await stripped(original);

    expect(result.length).toBe(original.length);
    expect(gpsFields((await sharp(result.subarray(0, first.length)).metadata()).exif)).toBe(0);
    const embedded = await sharp(result.subarray(first.length)).metadata();
    expect(gpsFields(embedded.exif)).toBe(0);
    expect(embedded.orientation).toBe(6);
    expect(result.subarray(first.length).includes(Buffer.from("GPSLatitude"))).toBe(false);
  });

  it("removes location fields from EXIF and XMP resources of Photoshop data in a JPEG", async () => {
    const exif = (await sharp(await photo("jpeg")).metadata()).exif ?? Buffer.alloc(0);
    const tiff = exif.subarray(exif.indexOf("Exif\0\0", 0, "latin1") + 6);
    const xmp = Buffer.from(XMP, "utf8");
    const resource = (id: number, value: Buffer) => {
      const head = Buffer.concat([
        Buffer.from("8BIM", "latin1"),
        Buffer.from([id >> 8, id & 0xff, 0, 0]),
        Buffer.alloc(4),
      ]);
      head.writeUInt32BE(value.length, 8);
      return Buffer.concat([head, value, Buffer.alloc(value.length % 2)]);
    };
    const body = Buffer.concat([
      Buffer.from("Photoshop 3.0\0", "latin1"),
      resource(0x0422, Buffer.from(tiff)),
      resource(0x0424, xmp),
    ]);
    const segment = Buffer.concat([Buffer.from([0xff, 0xed, 0, 0]), body]);
    segment.writeUInt16BE(body.length + 2, 2);
    const original = await photo("jpeg");
    const withResources = Buffer.concat([original.subarray(0, 2), segment, original.subarray(2)]);

    const result = await stripped(withResources);

    expect(result.length).toBe(withResources.length);
    const resources = result.subarray(2, 2 + segment.length);
    expect(resources.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(
      gpsFields(
        Buffer.concat([
          Buffer.from("Exif\0\0", "latin1"),
          resources.subarray(resources.indexOf(tiff.subarray(0, 8))),
        ]),
      ),
    ).toBe(0);
  });

  it("removes raw EXIF profiles from PNG text chunks", async () => {
    const original = await photo("png");
    const keyword = Buffer.from("Raw profile type exif\0", "latin1");
    const data = Buffer.concat([keyword, Buffer.from("\nexif\n  10\n4750534c61746974756465\n", "latin1")]);
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write("tEXt", 4, "latin1");
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
    const withProfile = Buffer.concat([original.subarray(0, 33), chunk, original.subarray(33)]);

    const result = await stripped(withProfile);

    expect(result.length).toBe(withProfile.length);
    expect(result.includes(Buffer.from("4750534c61746974756465"))).toBe(false);
    expect((await sharp(result).raw().toBuffer()).equals(await sharp(original).raw().toBuffer())).toBe(true);
  });

  it("passes other files through unchanged", async () => {
    const pdf = Buffer.from("%PDF-1.7 GPSLatitude 48 12 30 and more bytes to read");
    expect((await stripped(pdf)).equals(pdf)).toBe(true);
    const tiny = Buffer.from([0xff, 0xd8]);
    expect((await stripped(tiny)).equals(tiny)).toBe(true);
  });
});
