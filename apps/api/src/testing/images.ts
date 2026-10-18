import { crc32, deflateSync } from "node:zlib";

export function grayPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const framed = Buffer.alloc(body.length + 8);
    framed.writeUInt32BE(data.length, 0);
    body.copy(framed, 4);
    framed.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
    return framed;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) rows.fill(y % 256, y * (width + 1) + 1, (y + 1) * (width + 1));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function oversizedPng(width: number, height: number): Buffer {
  const image = Buffer.from(grayPng(4, 4));
  image.writeUInt32BE(width, 16);
  image.writeUInt32BE(height, 20);
  image.writeUInt32BE(crc32(image.subarray(12, 29)) >>> 0, 29);
  return image;
}
