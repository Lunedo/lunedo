import { statusItemIds } from "@lunedo/server";
import { idSchema } from "@lunedo/shared";
import { z } from "zod";

const level = z.enum(["ok", "warning", "error"]);

export const operationsStatusSchema = z
  .object({
    checkedAt: z.iso.datetime().describe("When the checks ran."),
    status: level.describe("The worst status of all items."),
    items: z
      .array(
        z.object({
          id: z
            .enum(statusItemIds)
            .describe(
              "What the item checks. New items can be added in later versions; clients show unknown items with their status and documentation link.",
            ),
          status: level.describe("`ok`, `warning` or `error`."),
          reason: z
            .string()
            .nullable()
            .describe(
              "A stable code for the reason of a warning or error, or a note on an item that is ok, for example `noLimit`. Null when there is nothing to say.",
            ),
          facts: z
            .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
            .describe(
              "Values the item measured, such as sizes in bytes, counts and times. They never contain content or personal data.",
            ),
          page: z
            .string()
            .nullable()
            .describe("Path of the settings page where the cause is fixed, or null."),
          docs: z.string().describe("Documentation page and section that explains the item."),
        }),
      )
      .describe("The checked items in a fixed order."),
    queues: z
      .array(
        z.object({
          queue: z.string().describe("Name of the job queue."),
          queued: z.number().int().describe("Jobs waiting to run."),
          active: z.number().int().describe("Jobs running now."),
          deferred: z.number().int().describe("Jobs scheduled for later."),
          failed: z.number().int().describe("Jobs that failed after all attempts and are still kept."),
          oldestQueuedAt: z.iso
            .datetime()
            .nullable()
            .optional()
            .describe("When the oldest waiting job was queued, or null when none waits."),
        }),
      )
      .describe("Job queues that have jobs in any state."),
    recentErrors: z
      .array(
        z.object({
          type: z
            .string()
            .describe(
              "The fixed text of the error-level log event. Texts that could contain data are counted as `Other error`.",
            ),
          code: z.string().nullable().describe("Error code or class name, if the event carried one."),
          services: z.array(z.string()).describe("Processes that logged it: `api`, `worker` or `collab`."),
          count: z.number().int().describe("How often it was logged."),
          lastAt: z.iso.datetime().describe("When it was logged last."),
        }),
      )
      .describe("Error-level log events of the last 24 hours by type, newest first, at most 50 types."),
  })
  .describe("The status of the instance.");

export const exampleOperationsStatus: z.input<typeof operationsStatusSchema> = {
  checkedAt: "2026-10-21T08:00:00.000Z",
  status: "warning",
  items: [
    {
      id: "version",
      status: "ok",
      reason: null,
      facts: { version: "1.4.2" },
      page: null,
      docs: "operations.md#updates",
    },
    {
      id: "storage",
      status: "warning",
      reason: "warning",
      facts: {
        store: "local",
        usedBytes: 86_000_000_000,
        totalBytes: 100_000_000_000,
        percent: 86,
        level: 1,
      },
      page: "/settings/instance/storage",
      docs: "storage.md",
    },
  ],
  queues: [
    {
      queue: "mail.deliver",
      queued: 2,
      active: 1,
      deferred: 0,
      failed: 0,
      oldestQueuedAt: "2026-10-24T08:14:00.000Z",
    },
  ],
  recentErrors: [
    {
      type: "Request failed",
      code: "ECONNRESET",
      services: ["api"],
      count: 3,
      lastAt: "2026-10-21T07:42:10.000Z",
    },
  ],
};

export const maintenanceSchema = z
  .object({
    enabled: z.boolean().describe("Whether the instance is in maintenance mode and refuses changes."),
    message: z
      .string()
      .describe(
        "The message of the instance administrators shown in the banner. Empty when they wrote none.",
      ),
    blockSignIn: z
      .boolean()
      .describe("Whether signing in is paused for everyone except instance administrators."),
    startedAt: z.iso
      .datetime()
      .nullable()
      .describe("When maintenance mode was switched on, or null when it is off."),
  })
  .describe("The maintenance mode of the instance.");

export const maintenanceDetailsSchema = maintenanceSchema
  .extend({
    changedAt: z.iso.datetime().nullable().describe("When maintenance mode was last switched or changed."),
    changedBy: z
      .object({ id: idSchema.describe("Account ID."), name: z.string().describe("Display name.") })
      .nullable()
      .describe("Who changed it last, or null when the command line or no one did."),
  })
  .describe("The maintenance mode of the instance with who changed it.");

export const maintenanceInputSchema = z
  .object({
    enabled: z
      .boolean()
      .describe("`true` switches maintenance mode on or changes its message, `false` switches it off."),
    message: z
      .string()
      .max(500)
      .optional()
      .describe("Message for the banner, at most 500 characters, for example when the maintenance ends."),
    blockSignIn: z
      .boolean()
      .optional()
      .describe(
        "Pause signing in for everyone except instance administrators. Existing sessions stay, read-only.",
      ),
  })
  .describe("Switches maintenance mode.");
