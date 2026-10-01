import { emailSchema } from "@pagehall/shared";
import { Button, Dialog, Field, Input, Notice, Select, Textarea, useToast } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { membersQuery, organizationKeys, rolesQuery } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { useSession } from "../../shell/shell-context.js";

type Kind = "member" | "collaborator" | "guest";

export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const entries = text
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const unique = [...new Set(entries.map((entry) => entry.toLowerCase()))];
  return {
    valid: unique.filter((entry) => emailSchema.safeParse(entry).success),
    invalid: unique.filter((entry) => !emailSchema.safeParse(entry).success),
  };
}

export function InviteDialog({
  open,
  onOpenChange,
  organizationId,
  organizationName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationName: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const session = useSession();
  const queryClient = useQueryClient();
  const roles = useQuery({ ...rolesQuery(organizationId), enabled: open });
  const members = useQuery({ ...membersQuery(organizationId), enabled: open });
  const [emails, setEmails] = useState("");
  const [kind, setKind] = useState<Kind>("member");
  const [role, setRole] = useState("none");
  const [expiry, setExpiry] = useState("");
  const [responsible, setResponsible] = useState(session.account?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = parseEmails(emails);
  const roleLabel =
    role === "none"
      ? t("members.kinds.member")
      : role.startsWith("builtIn:")
        ? translateKey(t, `roles.builtIn.${role.slice(8)}`)
        : (roles.data?.find((entry) => `custom:${entry.id}` === role)?.name ?? "");

  const submit = async () => {
    setError(null);
    if (parsed.valid.length === 0 || parsed.invalid.length > 0) {
      setError(
        parsed.invalid.length > 0
          ? t("members.invalidEmails", { emails: parsed.invalid.join(", ") })
          : t("validation.required"),
      );
      return;
    }
    setBusy(true);
    const failed: string[] = [];
    for (const email of parsed.valid) {
      try {
        await request(() =>
          api.POST("/api/v1/organizations/{organizationId}/invitations", {
            params: { path: { organizationId } },
            body: {
              email,
              kind,
              ...(kind === "member" && role !== "none"
                ? {
                    role: role.startsWith("builtIn:")
                      ? { builtIn: role.slice(8) as "owner" | "administrator" }
                      : { customRoleId: role.slice(7) },
                  }
                : {}),
              ...(expiry ? { membershipExpiresAt: new Date(`${expiry}T23:59:59`).toISOString() } : {}),
              ...(kind === "guest" && responsible ? { responsibleAccountId: responsible } : {}),
            },
          }),
        );
      } catch (failure) {
        failed.push(`${email}: ${problemMessage(t, failure)}`);
      }
    }
    setBusy(false);
    await queryClient.invalidateQueries({ queryKey: organizationKeys.invitations(organizationId) });
    const sent = parsed.valid.length - failed.length;
    if (sent > 0) toast({ title: t("members.invitationsSent", { count: sent }), variant: "success" });
    if (failed.length > 0) setError(failed.join("\n"));
    else {
      setEmails("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("members.invite")} size="md">
      <div className="flex flex-col gap-4">
        {error ? <Notice variant="danger">{error}</Notice> : null}
        <Field label={t("members.emails")} hint={t("members.emailsHint")}>
          <Textarea value={emails} onChange={(event) => setEmails(event.target.value)} rows={3} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("members.kind")}>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as Kind)}
              options={(["member", "collaborator", "guest"] as const).map((value) => ({
                value,
                label: t(`members.kinds.${value}`),
              }))}
            />
          </Field>
          {kind === "member" ? (
            <Field label={t("roles.role")}>
              <Select
                value={role}
                onValueChange={setRole}
                options={[
                  { value: "none", label: t("members.noExtraRole") },
                  { value: "builtIn:administrator", label: t("roles.builtIn.administrator") },
                  { value: "builtIn:owner", label: t("roles.builtIn.owner") },
                  ...(roles.data ?? []).map((entry) => ({ value: `custom:${entry.id}`, label: entry.name })),
                ]}
              />
            </Field>
          ) : (
            <Field label={t("members.expires")} hint={t("members.expiresHint")}>
              <Input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
            </Field>
          )}
        </div>
        {kind === "guest" ? (
          <Field label={t("members.responsible")} hint={t("members.responsibleHint")}>
            <Select
              value={responsible}
              onValueChange={setResponsible}
              options={(members.data ?? [])
                .filter((entry) => entry.kind === "member" && entry.accountType === "standard")
                .map((entry) => ({ value: entry.accountId, label: entry.name }))}
            />
          </Field>
        ) : null}
        {kind === "collaborator" ? <Notice variant="info">{t("members.collaboratorHint")}</Notice> : null}
        {kind === "guest" ? <Notice variant="info">{t("members.guestHint")}</Notice> : null}
        {parsed.valid.length > 0 ? (
          <AccessImpact
            change="gains"
            people={parsed.valid}
            what={t("members.inviteImpact", {
              name: organizationName,
              role: roleLabel,
              kind: t(`members.kinds.${kind}`),
            })}
          />
        ) : null}
        <p className="text-sm text-text-muted">{t("members.invitationExpiry")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {t("members.sendInvitations", { count: Math.max(parsed.valid.length, 1) })}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
