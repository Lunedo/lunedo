import { breakGlassReasonSchema } from "@lunedo/shared";
import { Button, Dialog, Field, Notice, Textarea } from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { instanceKeys } from "../../api/instance-queries.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../../forms/use-schema-form.js";

const reasonForm = z.object({ reason: breakGlassReasonSchema });

export function BreakGlassDialog({
  organization,
  onClose,
}: {
  organization: { id: string; name: string };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(reasonForm, { defaultValues: { reason: "" } });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(() =>
        api.POST("/api/v1/organizations/{organizationId}/break-glass", {
          params: { path: { organizationId: organization.id } },
          body: values,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: instanceKeys.breakGlass });
      await queryClient.invalidateQueries({ queryKey: ["account", "permissions"] });
      onClose();
      await navigate({
        to: "/settings/organizations/$organizationId/members",
        params: { organizationId: organization.id },
      });
    } catch (failure) {
      setError(problemMessage(t, failure));
    }
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("breakGlass.requestFor", { name: organization.name })}
      description={t("breakGlass.requestDescription")}
      size="md"
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
        {error ? (
          <Notice variant="danger" title={t("failures.startBreakGlass")}>
            {error}
          </Notice>
        ) : null}
        <Notice variant="warning" title={t("breakGlass.audited")}>
          {t("breakGlass.ownersNotified")}
        </Notice>
        <Field
          label={t("breakGlass.reason")}
          hint={t("breakGlass.reasonHint")}
          error={form.formState.errors.reason?.message}
        >
          <Textarea rows={3} autoFocus {...form.register("reason")} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="dangerPrimary"
            icon={ShieldAlert}
            loading={form.formState.isSubmitting}
          >
            {t("breakGlass.request")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
