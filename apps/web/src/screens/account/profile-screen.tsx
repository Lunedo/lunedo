import { emailSchema } from "@lunedo/shared";
import { Button, Dialog, Field, Input, Notice, Section, SettingRow, useToast } from "@lunedo/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { OwnIdentities } from "../../components/linked-identities.js";
import { problemMessage } from "../../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { useInlineReauthentication } from "../../session/reauthentication.js";
import { useSession } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

export function ProfileScreen() {
  const { t } = useTranslation();
  const session = useSession();
  return (
    <SettingsPage title={t("profile.title")} description={t("profile.description")}>
      <Section title={t("profile.details")}>
        <SettingRow
          label={t("profile.displayName")}
          control={<span className="min-w-0 break-words">{session.account?.name ?? ""}</span>}
        />
        <EmailRow />
      </Section>
      <Section title={t("identities.title")}>
        <OwnIdentities />
      </Section>
    </SettingsPage>
  );
}

export function EmailRow() {
  const { t } = useTranslation();
  const session = useSession();
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingRow
        label={t("auth.email")}
        description={session.account?.email ?? ""}
        control={
          <Button variant="outline" onClick={() => setOpen(true)}>
            {t("security.changeEmail")}
          </Button>
        }
      />
      <ChangeEmailDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

const emailForm = z.object({ email: emailSchema });

function ChangeEmailDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const reauthentication = useInlineReauthentication(open);
  const form = useSchemaForm(emailForm, { defaultValues: { email: "" } });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(() => api.POST("/api/v1/account/email", { body: values }));
      toast({ title: t("security.emailConfirmationSent"), variant: "success" });
      form.reset();
      onOpenChange(false);
    } catch (failure) {
      if (!applyServerFieldErrors(form, t, failure)) setError(problemMessage(t, failure));
    }
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("security.changeEmail")}
      description={t("security.changeEmailDescription")}
      size="sm"
    >
      {reauthentication.panel}
      <form
        className="flex flex-col gap-4"
        noValidate
        hidden={reauthentication.active}
        onSubmit={submitWith(submit)}
      >
        {error ? (
          <Notice variant="danger" title={t("failures.changeEmail")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("security.newEmail")} error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...form.register("email")} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            {t("security.sendConfirmation")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
