export function gpsFields(exif: Buffer | undefined): number {
  if (!exif) return 0;
  const tiff = exif.subarray(exif.toString("latin1", 0, 6) === "Exif\0\0" ? 6 : 0);
  const little = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const ifd0 = u32(4);
  for (let index = 0; index < u16(ifd0); index += 1) {
    const entry = ifd0 + 2 + index * 12;
    if (u16(entry) === 0x8825) return u16(u32(entry + 8));
  }
  return 0;
}
