import { accountNameSchema, emailSchema, PASSWORD_MAX_LENGTH } from "@pagehall/shared";
import { Button, Field, Input, Notice, PasswordInput } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { instanceInfoQuery } from "../../../api/queries.js";
import { RecoveryCodes } from "../../../components/recovery-codes.js";
import { TotpEnrollment } from "../../../components/totp-enrollment.js";
import { problemMessage } from "../../../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../../forms/use-schema-form.js";
import { isLanguage } from "../../../i18n/index.js";
import { runSetupAction } from "../setup-api.js";
import type { StepProps } from "./step-props.js";

const ownerForm = z
  .object({
    name: accountNameSchema,
    email: emailSchema,
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    repeated: z.string(),
  })
  .refine((values) => values.password === values.repeated, { path: ["repeated"], message: "mismatch" });

export function OwnerStep({ details, back, onDone, refresh }: StepProps<"owner">) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(details.owner === null);
  const [codes, setCodes] = useState<string[] | null>(null);

  if (codes) {
    return (
      <div className="flex flex-col gap-4">
        <RecoveryCodes codes={codes} />
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => void onDone()}>
            {t("setup.continue")}
          </Button>
        </div>
      </div>
    );
  }

  if (editing || !details.owner) {
    return (
      <OwnerForm
        back={back}
        onSaved={async () => {
          setEditing(false);
          await refresh();
        }}
      />
    );
  }

  if (!details.totpConfirmed) {
    return (
      <div className="flex flex-col gap-4">
        <Notice variant="info" title={t("setup.owner.twoFactorRequired")}>
          {t("setup.owner.twoFactorDescription")}
        </Notice>
        <TotpEnrollment
          queryKey={["setup", "owner", "totp", details.owner.email]}
          begin={() => runSetupAction("owner", "beginTotp", {})}
          confirm={async (code) => {
            const result = await runSetupAction("owner", "confirmTotp", { code });
            setCodes(result.recoveryCodes);
            await refresh();
          }}
        />
        <div className="flex justify-between gap-2">
          {back}
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t("setup.owner.change")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Notice variant="success" title={t("setup.owner.ready")}>
        <span className="inline-flex items-center gap-2">
          <CircleCheck aria-hidden="true" className="size-icon-md" />
          {t("setup.owner.summary", { name: details.owner.name, email: details.owner.email ?? "" })}
        </span>
      </Notice>
      <div className="flex justify-between gap-2">
        {back}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t("setup.owner.change")}
          </Button>
          <Button variant="primary" onClick={() => void onDone()}>
            {t("setup.continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function OwnerForm({ back, onSaved }: { back: StepProps<"owner">["back"]; onSaved: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const info = useQuery(instanceInfoQuery);
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(ownerForm, {
    defaultValues: { name: "", email: "", password: "", repeated: "" },
    messages: { repeated: t("auth.passwordsDiffer") },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await runSetupAction("owner", "createAccount", {
        name: values.name,
        email: values.email,
        password: values.password,
        ...(isLanguage(i18n.language) ? { language: i18n.language } : {}),
      });
      await onSaved();
    } catch (failure) {
      if (!applyServerFieldErrors(form, failure, t("validation.invalid")))
        setError(problemMessage(t, failure));
    }
  });
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
      {error ? <Notice variant="danger">{error}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("auth.name")} error={form.formState.errors.name?.message}>
          <Input autoComplete="name" autoFocus {...form.register("name")} />
        </Field>
        <Field label={t("auth.email")} error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register("email")} />
        </Field>
      </div>
      <Field
        label={t("auth.password")}
        hint={t("auth.passwordHint", { minimum: info.data?.passwordMinLength ?? 12 })}
        error={form.formState.errors.password?.message}
      >
        <PasswordInput autoComplete="new-password" {...form.register("password")} />
      </Field>
      <Field label={t("auth.repeatPassword")} error={form.formState.errors.repeated?.message}>
        <PasswordInput autoComplete="new-password" {...form.register("repeated")} />
      </Field>
      <div className="flex justify-between gap-2">
        {back}
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          {t("setup.continue")}
        </Button>
      </div>
    </form>
  );
}
