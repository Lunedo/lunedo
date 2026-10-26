import { Button, Dialog, Field, focusFirstInvalidSoon, Notice, Textarea, useToast } from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { spaceKeys } from "../space-queries.js";

const REASON_MAX = 500;

export interface BecomeAdministratorTarget {
  id: string;
  key: string;
  name: string;
}

export function BecomeAdministratorDialog({
  organizationId,
  space,
  onClose,
}: {
  organizationId: string;
  space: BecomeAdministratorTarget;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const value = reason.trim();
    if (value.length === 0 || value.length > REASON_MAX) {
      setError(t("spaces.become.reasonRequired", { max: REASON_MAX }));
      focusFirstInvalidSoon();
      return;
    }
    setError(null);
    setFailure(null);
    setSaving(true);
    try {
      await request(() =>
        api.POST("/api/v1/organizations/{organizationId}/spaces/{spaceId}/self-appointment", {
          params: { path: { organizationId, spaceId: space.id } },
          body: { reason: value },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: spaceKeys.organizationSpaces(organizationId) });
      await queryClient.invalidateQueries({ queryKey: spaceKeys.withoutAdministrator(organizationId) });
      toast({
        variant: "success",
        title: t("spaces.become.done", { space: space.name }),
        action: {
          label: t("spaces.become.openSpace"),
          onSelect: () => void navigate({ to: "/spaces/$spaceKey", params: { spaceKey: space.key } }),
        },
      });
      onClose();
    } catch (problem) {
      setFailure(problemMessage(t, problem));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("spaces.become.title", { space: space.name })}
      description={t("spaces.become.description", { space: space.name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            {t("spaces.become.confirm")}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {failure ? (
          <Notice variant="danger" title={t("spaces.become.failed", { space: space.name })}>
            {failure}
          </Notice>
        ) : null}
        <Notice variant="warning" title={t("spaces.become.effectTitle")}>
          {t("spaces.become.effect")}
        </Notice>
        <Field
          label={t("spaces.become.reason")}
          hint={t("spaces.become.reasonHint")}
          {...(error ? { error } : {})}
        >
          <Textarea
            rows={3}
            maxLength={REASON_MAX * 2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}
