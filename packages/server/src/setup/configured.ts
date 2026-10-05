import { proposeFormats } from "@pagehall/shared";
import { eq } from "drizzle-orm";
import { type AccountService, PasswordPolicyError } from "../accounts/accounts.js";
import { instanceNameSetting, instanceUrlSetting } from "../accounts/instance-settings.js";
import { SYSTEM } from "../accounts/principal.js";
import { instance } from "../accounts/schema.js";
import type { ConfiguredSetup } from "../config/load.js";
import type { Logger } from "../logging/logger.js";
import type { MailService } from "../mail/mail-service.js";
import { runWithRequestContext } from "../observability/request-context.js";
import type { OrganizationService } from "../organizations/organizations.js";
import { organizationSettingsChain } from "../organizations/settings.js";
import { StartupError } from "../runtime/startup-error.js";
import { applyFormats } from "../settings/preferences.js";
import type { SettingsService } from "../settings/service.js";
import type { SetupService } from "./setup-service.js";

export async function applyConfiguredSetup(options: {
  setup: ConfiguredSetup;
  service: SetupService;
  accounts: AccountService;
  settings: SettingsService;
  mail: MailService;
  organizations: OrganizationService;
  logger: Logger;
}): Promise<boolean> {
  const { setup, service } = options;
  if (await service.isComplete()) return false;
  const applied = await runWithRequestContext({ requestId: "configured-setup", actor: SYSTEM }, () =>
    service.locked(async (tx) => {
      const [state] = await tx.select({ completedAt: instance.setupCompletedAt }).from(instance);
      if (state?.completedAt) return false;
      await options.settings.set(instanceUrlSetting, {}, "instance", setup.instanceUrl, { tx });
      if (setup.instanceName) {
        await options.settings.set(instanceNameSetting, {}, "instance", setup.instanceName, { tx });
      }
      const owner = await options.accounts
        .createStandard(tx, {
          email: setup.owner.email,
          name: setup.owner.name,
          password: setup.owner.password.reveal(),
          homeOrganizationId: null,
        })
        .catch((error: unknown) => {
          if (error instanceof PasswordPolicyError) {
            throw new StartupError(
              `PAGEHALL_OWNER_PASSWORD: does not meet the password policy (${error.problem})`,
            );
          }
          throw error;
        });
      await tx.insert(instance).values({ id: 1 }).onConflictDoNothing();
      await tx.update(instance).set({ ownerAccountId: owner.id }).where(eq(instance.id, 1));
      const organization = await options.organizations.create(tx, SYSTEM, {
        name: setup.organization.name,
        ...(setup.organization.language ? { language: setup.organization.language } : {}),
        ...(setup.organization.timeZone ? { timeZone: setup.organization.timeZone } : {}),
        ownerAccountId: owner.id,
      });
      await applyFormats(
        options.settings,
        organizationSettingsChain(organization.id),
        "organization",
        proposeFormats(organization.language, organization.timeZone),
        { tx },
      );
      if (setup.smtp) {
        const { password, ...configuration } = setup.smtp;
        await options.mail.configureSmtp(configuration, password?.reveal() ?? null, { tx });
      }
      await service.completeSteps(tx, ["systemCheck", "instance", "owner", "keyBackup", "organization"]);
      await service.markComplete(tx, "configuration");
      return true;
    }),
  );
  if (applied) options.logger.info("Setup applied from the configuration");
  return applied;
}
