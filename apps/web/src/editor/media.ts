export const MEDIA = ".ld-image[data-attachment-id], .ld-file[data-attachment-id]";

export function mediaOf(root: ParentNode): string[] {
  const ids = Array.from(root.querySelectorAll<HTMLElement>(MEDIA))
    .map((element) => element.dataset.attachmentId ?? "")
    .filter(Boolean);
  return [...new Set(ids)];
}
