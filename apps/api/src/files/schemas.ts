import { z } from "zod";
import { extensibleEnum, timestamp, uuid } from "../http/schemas.js";

const person = z
  .object({
    id: uuid("ID of the account."),
    name: z.string().nullable().describe("Name, or null when hidden."),
  })
  .describe("A person.");

export const previewKinds = [
  "image",
  "pdf",
  "video",
  "audio",
  "text",
  "code",
  "markdown",
  "csv",
  "svg",
  "word",
  "excel",
  "none",
] as const;

export const attachmentSchema = z
  .object({
    id: uuid("ID of the attachment."),
    itemId: uuid("Page or blog post the file is attached to."),
    name: z.string().describe("File name of the current version."),
    size: z.number().int().describe("Size of the current version in bytes."),
    contentType: z.string().describe("Media type, decided from the content of the file."),
    preview: extensibleEnum(previewKinds, "How the file can be previewed; `none` offers only the download."),
    inline: z.boolean().describe("Whether browsers may show the file directly: images, video and audio."),
    version: z.number().int().describe("Number of the current version."),
    versions: z.number().int().describe("Number of stored versions."),
    draft: extensibleEnum(
      ["added", "changed"],
      "Only for people who can edit the page: `added` when readers do not see the file until the next publication, `changed` when readers still see an earlier version. Null when readers see this version.",
    ).nullable(),
    uploadedBy: person.nullable().describe("Who uploaded the current version."),
    uploadedAt: timestamp("When the current version was uploaded."),
    createdAt: timestamp("When the file was first attached."),
  })
  .describe("A file attached to a page or blog post.");

export const attachmentListSchema = z.array(attachmentSchema).describe("Attachments, ordered by name.");

export const attachmentVersionSchema = z
  .object({
    id: uuid("ID of the version."),
    number: z.number().int().describe("Number of the version, starting at 1."),
    name: z.string().describe("File name when this version was uploaded."),
    size: z.number().int().describe("Size in bytes."),
    contentType: z.string().describe("Media type, decided from the content."),
    restoredFrom: z.number().int().nullable().describe("Version this one restored, or null for an upload."),
    kept: z
      .boolean()
      .describe(
        "Whether the version is marked to keep. Marked versions are never removed automatically and do not count towards the number of versions kept.",
      ),
    uploadedBy: person.nullable().describe("Who uploaded or restored it."),
    uploadedAt: timestamp("When it was stored."),
  })
  .describe("A version of an attachment.");

export const keepVersionSchema = z
  .object({ kept: z.boolean().describe("True to keep the version, false to let it be removed again.") })
  .strict()
  .describe("Whether to keep a version.");

export const fileLinkSchema = z
  .object({
    url: z.string().describe("Address of the file. It starts with the file origin when one is configured."),
    expiresAt: timestamp("When the address stops working."),
  })
  .describe("A short-lived address of a file.");

export const exampleAttachment = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a40",
  itemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
  name: "network-diagram.png",
  size: 48213,
  contentType: "image/png",
  preview: "image",
  inline: true,
  version: 2,
  versions: 2,
  draft: null,
  uploadedBy: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" },
  uploadedAt: "2026-10-01T09:30:00.000Z",
  createdAt: "2026-09-28T14:02:00.000Z",
};

export const exampleAttachmentVersion = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a41",
  number: 2,
  name: "network-diagram.png",
  size: 48213,
  contentType: "image/png",
  restoredFrom: null,
  kept: false,
  uploadedBy: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" },
  uploadedAt: "2026-10-01T09:30:00.000Z",
};
