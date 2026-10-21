import { updateCheckFailures } from "@pagehall/server";
import { z } from "zod";

const notesSchema = z
  .object({
    new: z.array(z.string()).describe("New features."),
    improved: z.array(z.string()).describe("Improvements."),
    fixed: z.array(z.string()).describe("Fixes."),
    breaking: z.array(z.string()).describe("Breaking changes to read before updating."),
    manualSteps: z.array(z.string()).describe("Steps the operator does by hand during the update."),
  })
  .describe("Release notes by group, as plain text.");

const releaseSchema = z
  .object({
    version: z.string().describe("The release version, for example `1.5.0`."),
    date: z.iso.date().nullable().describe("Release date."),
    minimumUpdateFrom: z
      .string()
      .nullable()
      .describe("The oldest version that can update to this release directly, or null for any."),
    url: z.string().nullable().describe("Address of the release page, always HTTPS."),
    notes: notesSchema,
  })
  .describe("A release.");

export const updatesSchema = z
  .object({
    running: z.string().describe("The running version. Builds without a release show a commit or `dev`."),
    runningIsRelease: z.boolean().describe("Whether the running version is a release that can be compared."),
    check: z
      .object({
        enabled: z.boolean().describe("Whether the update check is on."),
        disabledBy: z
          .enum(["environment", "setting"])
          .nullable()
          .describe(
            "What turned it off: `environment` for `PAGEHALL_UPDATE_CHECK=false`, `setting` for the instance setting.",
          ),
        url: z.string().describe("The address of the version file."),
        checkedAt: z.iso.datetime().nullable().describe("When the last check ran, or null."),
        succeeded: z.boolean().describe("Whether the last check succeeded."),
        failure: z
          .enum(updateCheckFailures)
          .nullable()
          .describe(
            "Why the last check failed: `unreachable`, `timeout`, `blockedAddress`, `insecureAddress`, `untrustedCertificate`, `tooManyRedirects`, `httpStatus`, `tooLarge` or `invalidFile`.",
          ),
      })
      .describe("The update check. It downloads a public version file and sends nothing beyond the request."),
    latest: z.string().nullable().describe("The newest release after the running version, or null."),
    available: z.array(releaseSchema).describe("Releases after the running version, oldest first."),
    commands: z
      .object({
        method: z
          .enum(["script", "compose", "other", "unknown"])
          .describe("The recorded installation method, from `PAGEHALL_INSTALL_METHOD`."),
        steps: z
          .array(
            z.object({
              kind: z
                .enum(["command", "note"])
                .describe("`command` to run in a shell, `note` to do by hand."),
              text: z.string().describe("The command or the step."),
            }),
          )
          .describe("What to do, in order."),
      })
      .nullable()
      .describe("How to update to the newest release, built by Pagehall from the installation method."),
    whatsNew: z
      .object({
        available: z.boolean().describe("Whether the changelog is part of this image."),
        version: z.string().nullable().describe("The section shown: the running version, or `Unreleased`."),
        date: z.iso.date().nullable().describe("Release date of the running version."),
        notes: notesSchema.nullable(),
      })
      .describe(
        "What is new in the running version, from the changelog in the image. Works with the check off.",
      ),
  })
  .describe("The running version, available updates and what is new.");

export const exampleUpdates: z.input<typeof updatesSchema> = {
  running: "1.4.2",
  runningIsRelease: true,
  check: {
    enabled: true,
    disabledBy: null,
    url: "https://github.com/pagehall/pagehall/releases/latest/download/pagehall-versions.json",
    checkedAt: "2026-11-03T04:11:00.000Z",
    succeeded: true,
    failure: null,
  },
  latest: "1.5.0",
  available: [
    {
      version: "1.5.0",
      date: "2026-11-02",
      minimumUpdateFrom: "1.3.0",
      url: "https://github.com/pagehall/pagehall/releases/tag/v1.5.0",
      notes: {
        new: ["Maintenance mode for scripted maintenance."],
        improved: [],
        fixed: [],
        breaking: [],
        manualSteps: [],
      },
    },
  ],
  commands: {
    method: "script",
    steps: [
      { kind: "command", text: "cd /opt/pagehall" },
      { kind: "command", text: "./pagehall update 1.5.0" },
    ],
  },
  whatsNew: {
    available: true,
    version: "1.4.2",
    date: "2026-10-01",
    notes: { new: [], improved: [], fixed: ["Uploads through Nginx."], breaking: [], manualSteps: [] },
  },
};
