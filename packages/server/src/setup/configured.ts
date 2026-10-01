import { eq } from "drizzle-orm";
import { type AccountService, PasswordPolicyError } from "../accounts/accounts.js";
import { instanceNameSetting, instanceUrlSetting } from "../accounts/instance-settings.js";
import { SYSTEM } from "../accounts/principal.js";
import { instance } from "../accounts/schema.js";
import type { ConfiguredSetup } from "../config/load.js";
import type { Logger } from "../logging/logger.js";
import type { MailService } from "../mail/mail-service.js";
import { runWithRequestContext } from "../observability/request-context.js";
import { StartupError } from "../runtime/startup-error.js";
import type { SettingsService } from "../settings/service.js";
import type { SetupService } from "./setup-service.js";

export async function applyConfiguredSetup(options: {
  setup: ConfiguredSetup;
  service: SetupService;
  accounts: AccountService;
  settings: SettingsService;
  mail: MailService;
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
      const steps = ["systemCheck", "instance", "owner", "keyBackup"];
      if (setup.smtp) {
        const { password, ...configuration } = setup.smtp;
        await options.mail.configureSmtp(configuration, password?.reveal() ?? null, { tx });
        steps.push("mail");
      }
      await service.completeSteps(tx, steps);
      await service.markComplete(tx, "configuration");
      return true;
    }),
  );
  if (applied) options.logger.info("Setup applied from the configuration");
  return applied;
}
