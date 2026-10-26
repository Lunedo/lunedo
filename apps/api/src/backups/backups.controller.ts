import type { BackupList, BackupOverview, BackupStatus, RunView, TestRestoreView } from "@lunedo/server";
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { ProblemException } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import {
  backupListSchema,
  backupNameParams,
  backupOverviewSchema,
  backupSettingsChangeSchema,
  backupStatusSchema,
  backupTargetSchema,
  exampleBackupList,
  exampleBackupOverview,
  exampleBackupStatus,
  exampleS3Target,
  exampleTestRestore,
  keyConfirmationSchema,
  startedTestRestoreSchema,
  targetTestResultSchema,
  testRestoreParams,
  testRestoreSchema,
} from "./schemas.js";

const TAG = "Backups";
const VIEW = "instance.operations.view";
const MANAGE = "instance.operations.manage";

const iso = (value: Date | null) => value?.toISOString() ?? null;

function presentRun(run: RunView) {
  return { ...run, startedAt: run.startedAt.toISOString(), finishedAt: iso(run.finishedAt) };
}

function presentTest(test: TestRestoreView): z.input<typeof testRestoreSchema> {
  return { ...test, startedAt: test.startedAt.toISOString(), finishedAt: iso(test.finishedAt) };
}

function presentOverview(overview: BackupOverview): z.input<typeof backupOverviewSchema> {
  return {
    ...overview,
    restoredAt: iso(overview.restoredAt),
    nextRunAt: iso(overview.nextRunAt),
    keyConfirmed: overview.keyConfirmed
      ? { ...overview.keyConfirmed, at: overview.keyConfirmed.at.toISOString() }
      : null,
    lastSuccess: overview.lastSuccess ? presentRun(overview.lastSuccess) : null,
    lastFailure: overview.lastFailure ? presentRun(overview.lastFailure) : null,
    runs: overview.runs.map(presentRun),
  };
}

function presentStatus(status: BackupStatus): z.input<typeof backupStatusSchema> {
  return {
    ...status,
    restoredAt: iso(status.restoredAt),
    testRestoreCleanupAt: iso(status.testRestoreCleanupAt),
    nextRunAt: iso(status.nextRunAt),
    lastSuccess: status.lastSuccess
      ? { ...status.lastSuccess, at: status.lastSuccess.at.toISOString() }
      : null,
    lastFailure: status.lastFailure
      ? { ...status.lastFailure, at: status.lastFailure.at.toISOString() }
      : null,
  };
}

function presentList(list: BackupList): z.input<typeof backupListSchema> {
  return {
    ...list,
    backups: list.backups.map((backup) => ({
      ...backup,
      createdAt: backup.createdAt.toISOString(),
      testRestore: backup.testRestore ? presentTest(backup.testRestore) : null,
    })),
  };
}

@Controller("api/v1/instance/backups")
export class BackupsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #backups() {
    return servicesOf(this.context).backups;
  }

  @Get()
  @Permission(VIEW)
  @ApiRoute({
    summary: "Get the backup settings and state",
    description:
      "Shows the target, the schedule, the retention, backups before updates, the latest runs and active warnings. The secret key of an S3 target is never returned.",
    tags: [TAG],
    response: {
      description: "Settings and state.",
      schema: backupOverviewSchema,
      example: exampleBackupOverview,
    },
  })
  async overview() {
    return presentOverview(await this.#backups.overview());
  }

  @Get("status")
  @Permission(VIEW)
  @ApiRoute({
    summary: "Get a short backup status",
    description:
      "Last success, last failure, next run and whether backups and backups before updates are on.",
    tags: [TAG],
    response: { description: "The status.", schema: backupStatusSchema, example: exampleBackupStatus },
  })
  async status() {
    return presentStatus(await this.#backups.status());
  }

  @Patch("settings")
  @Permission(MANAGE)
  @ApiRoute({
    summary: "Change the backup settings",
    description:
      "Changes the schedule, the retention, the scope, backups before updates, the warning period and the monthly test restore. Backups can be turned on only with a target. Changes are audited.",
    tags: [TAG],
    body: backupSettingsChangeSchema,
    bodyExample: { enabled: true, dailyTime: "02:30", weeklyDay: 7, retention: { daily: 7 } },
    response: {
      description: "Settings and state.",
      schema: backupOverviewSchema,
      example: exampleBackupOverview,
    },
    errors: ["invalidInput", "invalidBackupSettings"],
  })
  async updateSettings(
    @Body() body: z.output<typeof backupSettingsChangeSchema>,
    @Req() request: FastifyRequest,
  ) {
    return presentOverview(await this.#backups.updateSettings(actorOf(request), body));
  }

  @Put("target")
  @Permission(MANAGE)
  @ApiRoute({
    summary: "Set the backup target",
    description:
      "Sets the local directory or the S3-compatible storage that backups are written to. The secret key is stored encrypted and never returned; leave it out to keep the stored one. Changes are audited without the secret key.",
    tags: [TAG],
    body: backupTargetSchema,
    bodyExample: { kind: "local", path: "/var/lib/lunedo/backups" },
    response: {
      description: "Settings and state.",
      schema: backupOverviewSchema,
      example: exampleBackupOverview,
    },
    errors: ["invalidInput", "invalidBackupSettings"],
  })
  async updateTarget(@Body() body: z.output<typeof backupTargetSchema>, @Req() request: FastifyRequest) {
    return presentOverview(await this.#backups.updateTarget(actorOf(request), body));
  }

  @Post("target/test")
  @Permission(MANAGE)
  @ApiRoute({
    summary: "Test a backup target",
    description:
      "Writes, reads, lists and deletes a small test object with the given settings, without saving them, and says which step failed and why.",
    tags: [TAG],
    body: backupTargetSchema,
    bodyExample: exampleS3Target,
    response: {
      description: "The result.",
      schema: targetTestResultSchema,
      example: {
        ok: false,
        failure: "credentials",
        step: "write",
        message:
          "Writing to the backup target failed: The access key or the secret key was not accepted. Check both keys.",
        blockedAddress: null,
        allowedNetwork: null,
      },
    },
    errors: ["invalidInput", "invalidBackupSettings"],
  })
  async testTarget(
    @Body() body: z.output<typeof backupTargetSchema>,
  ): Promise<z.input<typeof targetTestResultSchema>> {
    const result = await this.#backups.testTarget(body);
    return result.ok
      ? { ok: true, failure: null, step: null, message: null, blockedAddress: null, allowedNetwork: null }
      : result;
  }

  @Put("key-confirmation")
  @Permission(MANAGE)
  @ApiRoute({
    summary: "Confirm that the backup key is stored elsewhere",
    description:
      "Records when and by whom it was confirmed that the backup key is kept outside Lunedo, or withdraws it. A backup cannot be restored without this key.",
    tags: [TAG],
    body: keyConfirmationSchema,
    bodyExample: { confirmed: true },
    response: {
      description: "Settings and state.",
      schema: backupOverviewSchema,
      example: exampleBackupOverview,
    },
  })
  async confirmKey(@Body() body: z.output<typeof keyConfirmationSchema>, @Req() request: FastifyRequest) {
    return presentOverview(await this.#backups.confirmKey(actorOf(request), body.confirmed));
  }

  @Post("target/confirmation")
  @Permission(MANAGE)
  @ApiRoute({
    summary: "Confirm the backup target after a restore",
    description:
      "After a restore from a backup, scheduled backups, retention and the monthly test restore are paused, so that a copy of an instance never writes into or deletes from the backups of the original. Confirming the target resumes them. Changing the target resumes them as well. The confirmation is audited.",
    tags: [TAG],
    response: {
      description: "Settings and state.",
      schema: backupOverviewSchema,
      example: exampleBackupOverview,
    },
    errors: ["invalidBackupSettings"],
  })
  async confirmTarget(@Req() request: FastifyRequest) {
    return presentOverview(await this.#backups.confirmTarget(actorOf(request)));
  }

  @Get("files")
  @Permission(VIEW)
  @ApiRoute({
    summary: "List the backups in the target",
    description:
      "Lists the backups Lunedo created in the target, with class, size, version and the latest test restore. Backups are never downloaded through the API.",
    tags: [TAG],
    response: { description: "The backups.", schema: backupListSchema, example: exampleBackupList },
  })
  async list() {
    return presentList(await this.#backups.list());
  }

  @Post("runs")
  @Permission(MANAGE)
  @ApiRoute({
    summary: "Back up now",
    description:
      "Starts a manual backup to the target. Manual backups are kept until they are deleted. The list shows the backup when it is done.",
    tags: [TAG],
    status: 202,
    errors: ["invalidBackupSettings", "backupRunning", "backupTargetFailed"],
  })
  async run(@Req() request: FastifyRequest) {
    await this.#backups.requestBackup(actorOf(request));
  }

  @Delete("files/:name")
  @Permission(MANAGE)
  @ApiRoute({
    summary: "Delete a backup",
    description:
      "Deletes a backup Lunedo created from the target. This cannot be undone. Deletions are audited.",
    tags: [TAG],
    params: backupNameParams,
    errors: ["backupNotFound", "invalidBackupSettings", "backupTargetFailed"],
  })
  async remove(@Param("name") name: string, @Req() request: FastifyRequest) {
    await this.#backups.deleteBackup(actorOf(request), name);
  }

  @Post("files/:name/test-restore")
  @Permission(MANAGE)
  @ApiRoute({
    summary: "Test-restore a backup",
    description:
      "Verifies the backup and, where the database user may create databases, restores it into a temporary database and directory, checks it and removes both. The result is kept with the backup.",
    tags: [TAG],
    status: 202,
    params: backupNameParams,
    response: {
      description: "The started test restore.",
      schema: startedTestRestoreSchema,
      example: { id: exampleTestRestore.id },
    },
    errors: ["backupNotFound", "backupRunning", "invalidBackupSettings", "backupTargetFailed"],
  })
  async testRestore(@Param("name") name: string, @Req() request: FastifyRequest) {
    return { id: await this.#backups.requestTestRestore(actorOf(request), name) };
  }

  @Get("test-restores/:id")
  @Permission(VIEW)
  @ApiRoute({
    summary: "Get a test restore",
    description: "Shows how far a test restore got and what it checked.",
    tags: [TAG],
    params: testRestoreParams,
    response: { description: "The test restore.", schema: testRestoreSchema, example: exampleTestRestore },
    errors: ["notFound"],
  })
  async getTestRestore(@Param("id") id: string) {
    const found = await this.#backups.testRestore(id);
    if (!found) throw new ProblemException("notFound", "The test restore does not exist");
    return presentTest(found);
  }
}
