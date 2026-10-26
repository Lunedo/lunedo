export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const IMAGE_MAX_BYTES = 256 * 1024;

export function isUploadableImage(file: File): file is File & { type: ImageType } {
  return (IMAGE_TYPES as readonly string[]).includes(file.type) && file.size <= IMAGE_MAX_BYTES;
}

export async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
