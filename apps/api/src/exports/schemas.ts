import { exportScopes, exportStates } from "@pagehall/server";
import { z } from "zod";
import { extensibleEnum, timestamp, uuid } from "../http/schemas.js";

export const exportSchema = z
  .object({
    id: uuid("ID of the export."),
    scope: z
      .enum(exportScopes)
      .describe("What is exported: `space` for a whole space, `pages` for a page with its subpages."),
    spaceId: uuid("The exported space, or null when it was deleted since.").nullable(),
    rootItemId: uuid("The exported page for `pages`, or null.").nullable(),
    name: z.string().describe("Name of the space or title of the page when the export was started."),
    state: z
      .enum(exportStates)
      .describe(
        "`queued` waits for a worker, `running` is being built, `ready` can be downloaded, `failed` stopped with an error.",
      ),
    progress: z
      .object({
        done: z.number().int().describe("Files written so far."),
        total: z.number().int().describe("Files in the export, 0 until known."),
      })
      .describe("Progress of a running export."),
    fileName: z.string().nullable().describe("File name of the ZIP archive once it is ready."),
    size: z.number().int().nullable().describe("Size of the ZIP archive in bytes once it is ready."),
    errorCode: extensibleEnum(
      ["exportDisabled", "noAccess", "tokenRevoked", "interrupted", "internalError"],
      "Why a failed export stopped: export was turned off for the space, access to the space or page was lost, the API token that started it was revoked, the worker was interrupted too often, or an unexpected error.",
    ).nullable(),
    createdAt: timestamp("When the export was started."),
    finishedAt: timestamp("When the export finished or failed.").nullable(),
    expiresAt: timestamp("When the download is deleted, 7 days after it is ready.").nullable(),
  })
  .describe("An export of a space or of a page with its subpages, built in the background.");

export const exampleExport = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a90",
  scope: "space",
  spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
  rootItemId: null,
  name: "IT Operations",
  state: "ready",
  progress: { done: 413, total: 413 },
  fileName: "IT Operations 2026-10-14.zip",
  size: 18_432_112,
  errorCode: null,
  createdAt: "2026-10-14T09:00:00.000Z",
  finishedAt: "2026-10-14T09:01:12.000Z",
  expiresAt: "2026-10-21T09:01:12.000Z",
};
