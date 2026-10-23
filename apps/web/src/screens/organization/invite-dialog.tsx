import { emailSchema } from "@lunedo/shared";
import {
  Button,
  Combobox,
  type ComboboxItem,
  Dialog,
  Field,
  Input,
  Notice,
  SegmentedControl,
  Textarea,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { organizationKeys, rolesQuery } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { memberLoader } from "../../components/pickers.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { useSession } from "../../shell/shell-context.js";
import { roleItems } from "./roles.js";

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
  const responsibleLoader = useMemo(() => memberLoader(organizationId), [organizationId]);
  const [emails, setEmails] = useState("");
  const [kind, setKind] = useState<Kind>("member");
  const [role, setRole] = useState("none");
  const [expiry, setExpiry] = useState("");
  const [responsible, setResponsible] = useState<ComboboxItem | null>(
    session.account ? { value: session.account.id, label: session.account.name } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [emailProblem, setEmailProblem] = useState<"required" | "invalid" | null>(null);
  const emailsRef = useRef<HTMLTextAreaElement>(null);
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
      setEmailProblem(parsed.invalid.length > 0 ? "invalid" : "required");
      emailsRef.current?.focus();
      return;
    }
    setEmailProblem(null);
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
              ...(kind === "guest" && responsible ? { responsibleAccountId: responsible.value } : {}),
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
        {error ? (
          <Notice variant="danger" title={t("failures.sendInvitations")}>
            {error}
          </Notice>
        ) : null}
        <Field
          label={t("members.emails")}
          hint={t("members.emailsHint")}
          {...(emailProblem === "invalid"
            ? { error: t("members.invalidEmails", { emails: parsed.invalid.join(", ") }) }
            : emailProblem === "required" && parsed.valid.length === 0
              ? { error: t("members.emailsRequired") }
              : {})}
        >
          <Textarea
            ref={emailsRef}
            value={emails}
            onChange={(event) => {
              setEmails(event.target.value);
              if (emailProblem && parseEmails(event.target.value).invalid.length === 0) setEmailProblem(null);
            }}
            rows={3}
            autoFocus
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("members.kind")}>
            <SegmentedControl
              label={t("members.kind")}
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
              <Combobox
                aria-label={t("roles.role")}
                value={role}
                onValueChange={(value) => setRole(value ?? "none")}
                items={[
                  { value: "none", label: t("members.noExtraRole") },
                  ...roleItems(t, roles.data ?? []),
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
            <Combobox
              aria-label={t("members.responsible")}
              value={responsible?.value ?? null}
              selectedItem={responsible}
              load={responsibleLoader}
              onValueChange={(_value, item) => setResponsible(item)}
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
              count: parsed.valid.length,
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
