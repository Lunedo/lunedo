import { z } from "zod";
import { defaultExportOptions, type ExportOptions } from "./export-queries.js";

export const printRouteSearch = z.object({
  page: z.uuid().optional(),
  export: z.uuid().optional(),
  attachments: z.boolean().optional(),
  comments: z.boolean().optional(),
  contents: z.boolean().optional(),
  paper: z.enum(["a4", "letter"]).optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(),
});

export type PrintRouteSearch = z.output<typeof printRouteSearch>;

export function printSearch(
  source: { page: string } | { export: string },
  options: ExportOptions,
): PrintRouteSearch {
  return { ...source, ...options };
}

export function printOptions(search: PrintRouteSearch): ExportOptions {
  return {
    attachments: search.attachments ?? defaultExportOptions.attachments,
    comments: search.comments ?? defaultExportOptions.comments,
    contents: search.contents ?? defaultExportOptions.contents,
    paper: search.paper ?? defaultExportOptions.paper,
    orientation: search.orientation ?? defaultExportOptions.orientation,
  };
}
