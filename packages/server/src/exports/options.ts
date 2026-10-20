import { z } from "zod";

export const exportFormats = ["archive", "html", "markdown", "print", "pdf", "docx", "site"] as const;
export type ExportFormat = (typeof exportFormats)[number];

export const paperSizes = ["a4", "letter"] as const;
export type PaperSize = (typeof paperSizes)[number];

export const orientations = ["portrait", "landscape"] as const;
export type Orientation = (typeof orientations)[number];

export const exportOptionsSchema = z
  .object({
    attachments: z.boolean().default(true),
    comments: z.boolean().default(false),
    contents: z.boolean().default(true),
    paper: z.enum(paperSizes).default("a4"),
    orientation: z.enum(orientations).default("portrait"),
  })
  .strict();

export type ExportOptions = z.output<typeof exportOptionsSchema>;

export const defaultExportOptions: ExportOptions = exportOptionsSchema.parse({});

export const PAGED_FORMATS: ReadonlySet<ExportFormat> = new Set(["print", "pdf", "docx"]);

export const MAX_BROWSER_PRINT_PAGES = 300;
export const MAX_FILE_EXPORT_PAGES = 1000;

export function readExportOptions(value: unknown): ExportOptions {
  const parsed = exportOptionsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : defaultExportOptions;
}
