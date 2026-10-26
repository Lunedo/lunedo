import { accountNameSchema, emailSchema } from "@lunedo/shared";
import {
  Button,
  Combobox,
  type ComboboxItem,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  Input,
  Notice,
  Select,
  Textarea,
  Tooltip,
  useToast,
} from "@lunedo/ui";
import { House } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";

export function PlaceholderDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found: { name?: string; email?: string } = {};
    if (!accountNameSchema.safeParse(name).success) found.name = t("validation.required");
    if (!emailSchema.safeParse(email.trim()).success) found.email = t("validation.email");
    setErrors(found);
    if (found.name || found.email) {
      focusFirstInvalidSoon();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request(() =>
        api.POST("/api/v1/instance/accounts/placeholders", {
          body: { name: name.trim(), email: email.trim() },
        }),
      );
      toast({ title: t("lifecycle.placeholder.created", { name: name.trim() }), variant: "success" });
      await onCreated();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("lifecycle.placeholder.title")}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {t("lifecycle.placeholder.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">{t("lifecycle.placeholder.description")}</p>
        {error ? (
          <Notice variant="danger" title={t("failures.createPlaceholder")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("lifecycle.placeholder.name")} {...(errors.name ? { error: errors.name } : {})}>
          <Input value={name} autoComplete="off" onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field
          label={t("lifecycle.placeholder.email")}
          hint={t("lifecycle.placeholder.emailHint")}
          help={t("lifecycle.placeholder.emailHelp")}
          {...(errors.email ? { error: errors.email } : {})}
        >
          <Input
            type="email"
            value={email}
            autoComplete="off"
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

async function searchAccounts(query: string, except: string): Promise<ComboboxItem[]> {
  const page = await request(() =>
    api.GET("/api/v1/instance/accounts", {
      params: { query: { limit: 20, state: "active", ...(query ? { q: query } : {}) } },
    }),
  );
  return page.items
    .filter((item) => item.id !== except && (item.type === "standard" || item.type === "guest"))
    .map((item) => ({ value: item.id, label: item.name, description: item.email ?? undefined }));
}

export function MergePlaceholder({
  placeholder,
  ownAccountId,
  onMerged,
}: {
  placeholder: { id: string; name: string };
  ownAccountId: string | null;
  onMerged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [target, setTarget] = useState<ComboboxItem | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const own = target !== null && target.value === ownAccountId;

  const merge = async () => {
    if (!target || own) {
      setMissing(!target);
      focusFirstInvalidSoon();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const moved = await request(() =>
        api.POST("/api/v1/instance/accounts/{accountId}/merge", {
          params: { path: { accountId: placeholder.id } },
          body: { accountId: target.value },
        }),
      );
      toast({
        title: t("lifecycle.merge.done", { placeholder: placeholder.name, account: target.label, ...moved }),
        variant: "success",
      });
      await onMerged();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">{t("lifecycle.merge.description")}</p>
      {error ? (
        <Notice variant="danger" title={t("failures.mergePlaceholder")}>
          {error}
        </Notice>
      ) : null}
      <Field
        label={t("lifecycle.merge.account")}
        {...(own
          ? { error: t("lifecycle.merge.notOwn") }
          : missing && !target
            ? { error: t("lifecycle.merge.chooseAccount") }
            : {})}
      >
        <Combobox
          value={target?.value ?? null}
          selectedItem={target}
          onValueChange={(_value, item) => setTarget(item)}
          placeholder={t("lifecycle.merge.search")}
          emptyText={t("lifecycle.merge.noAccounts")}
          load={async (query) => ({
            items: await searchAccounts(query.trim(), placeholder.id),
            nextCursor: null,
          })}
        />
      </Field>
      <div>
        <Button variant="primary" size="sm" loading={busy} onClick={() => void merge()}>
          {t("lifecycle.merge.action")}
        </Button>
      </div>
    </div>
  );
}

export function HomeOrganizationChange({
  accountId,
  memberships,
  onChanged,
}: {
  accountId: string;
  memberships: { organizationId: string; name: string; kind: string; home: boolean }[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const candidates = memberships.filter((membership) => membership.kind === "member");
  const home = memberships.find((membership) => membership.home);
  const current = home?.organizationId ?? "";
  const [organizationId, setOrganizationId] = useState(current);
  const [unchanged, setUnchanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currentLine = (
    <p className="flex items-center gap-1.5 font-medium">
      <HomeMark />
      {home?.name ?? "—"}
    </p>
  );
  if (candidates.length < 2) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        {currentLine}
        <p className="text-text-muted">{t("lifecycle.home.onlyOne")}</p>
      </div>
    );
  }

  const change = async () => {
    if (organizationId === current) {
      setUnchanged(true);
      focusFirstInvalidSoon();
      return;
    }
    setUnchanged(false);
    setBusy(true);
    setError(null);
    try {
      await request(() =>
        api.PUT("/api/v1/accounts/{accountId}/home-organization", {
          params: { path: { accountId } },
          body: { organizationId },
        }),
      );
      const name = candidates.find((membership) => membership.organizationId === organizationId)?.name ?? "";
      toast({ title: t("lifecycle.home.changed", { organization: name }), variant: "success" });
      await onChanged();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm">{currentLine}</div>
      <p className="text-sm text-text-muted">{t("lifecycle.home.description")}</p>
      {error ? (
        <Notice variant="danger" title={t("failures.changeHomeOrganization")}>
          {error}
        </Notice>
      ) : null}
      <Field
        label={t("lifecycle.home.newHome")}
        {...(unchanged && organizationId === current ? { error: t("lifecycle.home.chooseOther") } : {})}
      >
        <Select
          aria-label={t("lifecycle.home.newHome")}
          value={organizationId}
          onValueChange={setOrganizationId}
          options={candidates.map((membership) => ({
            value: membership.organizationId,
            label: membership.name,
          }))}
        />
      </Field>
      <div>
        <Button variant="secondary" size="sm" loading={busy} onClick={() => void change()}>
          {t("lifecycle.home.action")}
        </Button>
      </div>
    </div>
  );
}

export function AnonymizeDialog({
  account,
  onClose,
  onDone,
}: {
  account: { id: string; name: string };
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<{ reason: boolean; confirmation: boolean }>({
    reason: false,
    confirmation: false,
  });
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const problems = {
      reason: reason.trim().length === 0,
      confirmation: confirmation.trim() !== account.name.trim(),
    };
    setInvalid(problems);
    if (problems.reason) {
      reasonRef.current?.focus();
      return;
    }
    if (problems.confirmation) {
      confirmationRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request(() =>
        api.POST("/api/v1/instance/accounts/{accountId}/anonymize", {
          params: { path: { accountId: account.id } },
          body: { reason: reason.trim(), confirmation },
        }),
      );
      toast({ title: t("lifecycle.anonymize.done"), variant: "success" });
      await onDone();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("lifecycle.anonymize.title")}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="dangerPrimary" loading={busy} onClick={() => void submit()}>
            {t("lifecycle.anonymize.action")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Notice variant="danger" title={t("lifecycle.anonymize.irreversible")}>
          <ul className="list-disc ps-5">
            <li>{t("lifecycle.anonymize.removesProfile", { name: account.name })}</li>
            <li>{t("lifecycle.anonymize.deletesAccess")}</li>
            <li>{t("lifecycle.anonymize.endsMemberships")}</li>
            <li>{t("lifecycle.anonymize.keepsContent")}</li>
            <li>{t("lifecycle.anonymize.auditLog")}</li>
          </ul>
        </Notice>
        <Notice variant="warning">{t("lifecycle.anonymize.copies")}</Notice>
        {error ? (
          <Notice variant="danger" title={t("failures.anonymize")}>
            {error}
          </Notice>
        ) : null}
        <Field
          label={t("lifecycle.anonymize.reason")}
          hint={t("lifecycle.anonymize.reasonHint")}
          help={t("lifecycle.anonymize.reasonHelp")}
          {...(invalid.reason ? { error: t("lifecycle.anonymize.reasonRequired") } : {})}
        >
          <Textarea
            ref={reasonRef}
            value={reason}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
              if (invalid.reason && event.target.value.trim())
                setInvalid((current) => ({ ...current, reason: false }));
            }}
          />
        </Field>
        <Field
          label={t("lifecycle.anonymize.confirm", { name: account.name })}
          {...(invalid.confirmation ? { error: t("common.nameMismatch") } : {})}
        >
          <Input
            ref={confirmationRef}
            value={confirmation}
            autoComplete="off"
            onChange={(event) => {
              setConfirmation(event.target.value);
              if (invalid.confirmation && event.target.value.trim() === account.name.trim())
                setInvalid((current) => ({ ...current, confirmation: false }));
            }}
          />
        </Field>
        <p className="text-sm text-text-muted">{t("lifecycle.anonymize.reauthentication")}</p>
      </div>
    </Dialog>
  );
}

export function HomeMark() {
  const { t } = useTranslation();
  return (
    <Tooltip content={t("instance.accounts.homeHint")}>
      <span
        role="img"
        aria-label={t("instance.accounts.homeHint")}
        className="inline-flex shrink-0 text-text-muted"
      >
        <House aria-hidden className="size-4" />
      </span>
    </Tooltip>
  );
}
