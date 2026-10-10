import {
  Button,
  Checkbox,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  Input,
  Notice,
  Select,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { isApiError, request } from "../api/request.js";
import { problemMessage } from "../errors/problem-message.js";
import { useOrganizationState, useSession } from "../shell/shell-context.js";
import type { Grant } from "./access/holders.js";
import { GrantsField, VisibilityField, WhoGetsAccess } from "./access/space-access-fields.js";
import { type SpaceVisibility, spaceDefaultsQuery, spaceKeys } from "./space-queries.js";

const KEY_PATTERN = /^[A-Z0-9]{2,10}$/;

export function CreateSpaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const [organizationId, setOrganizationId] = useState<string | null>(state.organizationId);
  useEffect(() => {
    if (open) setOrganizationId(state.organizationId);
  }, [open, state.organizationId]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("spaces.create.title")} size="lg">
      {open && organizationId ? (
        <CreateSpaceForm
          key={organizationId}
          organizationId={organizationId}
          onOrganizationChange={setOrganizationId}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function CreateSpaceForm({
  organizationId,
  onOrganizationChange,
  onDone,
}: {
  organizationId: string;
  onOrganizationChange: (id: string) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const state = useOrganizationState();
  const session = useSession();
  const organization = state.organizations.find((entry) => entry.id === organizationId) ?? null;
  const defaults = useQuery(spaceDefaultsQuery(organizationId));
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<SpaceVisibility>("organization");
  const [confidential, setConfidential] = useState(false);
  const canCreateConfidential = state.can("organization.spaces.createConfidential");
  const [grants, setGrants] = useState<Grant[]>([]);
  const visibleGrants = confidential ? grants.filter((grant) => grant.principalKind === "account") : grants;
  const [initialized, setInitialized] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; key?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const suggestion = useRef(0);

  if (defaults.data && !initialized) {
    setInitialized(true);
    setVisibility(defaults.data.visibility);
    setGrants(defaults.data.grants.map((grant) => ({ ...grant })));
  }

  useEffect(() => {
    if (keyEdited || name.trim() === "") return;
    const request_ = ++suggestion.current;
    const timer = setTimeout(() => {
      void request(() =>
        api.GET("/api/v1/organizations/{organizationId}/space-key-suggestion", {
          params: { path: { organizationId }, query: { name: name.trim() } },
        }),
      )
        .then((result) => {
          if (request_ === suggestion.current) setKey(result.key);
        })
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [name, keyEdited, organizationId]);

  const ownId = session.account?.id ?? "";

  const validate = async (): Promise<boolean> => {
    const next: { name?: string; key?: string } = {};
    if (name.trim() === "") next.name = t("spaces.create.nameRequired");
    const normalized = key.trim().toUpperCase();
    if (!KEY_PATTERN.test(normalized)) next.key = t("spaces.create.keyInvalid");
    else {
      const check = await request(() =>
        api.GET("/api/v1/organizations/{organizationId}/space-keys/{key}", {
          params: { path: { organizationId, key: normalized } },
        }),
      ).catch(() => null);
      if (check && !check.available) next.key = t("spaces.create.keyTaken", { key: normalized });
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    setFailure(null);
    setSubmitting(true);
    try {
      if (!(await validate())) {
        focusFirstInvalidSoon();
        return;
      }
      const created = await request(() =>
        api.POST("/api/v1/organizations/{organizationId}/spaces", {
          params: { path: { organizationId } },
          body: {
            name: name.trim(),
            key: key.trim().toUpperCase(),
            description: description.trim(),
            visibility: confidential ? "private" : visibility,
            confidential,
            grants: visibleGrants
              .filter((grant) => !(grant.principalKind === "account" && grant.principalId === ownId))
              .map(({ principalKind, principalId, role }) => ({ principalKind, principalId, role })),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
      toast({ title: t("spaces.create.created", { name: created.name }), variant: "success" });
      onDone();
      await navigate({ to: "/spaces/$spaceKey", params: { spaceKey: created.key } });
    } catch (error) {
      if (isApiError(error, "keyTaken")) {
        setErrors({ key: t("spaces.create.keyTaken", { key: key.trim().toUpperCase() }) });
        focusFirstInvalidSoon();
      } else setFailure(problemMessage(t, error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {failure ? (
        <Notice variant="danger" title={t("spaces.create.failed")}>
          {failure}
        </Notice>
      ) : null}
      {state.multipleOrganizations ? (
        <Field label={t("spaces.create.organization")}>
          <Select
            value={organizationId}
            onValueChange={onOrganizationChange}
            options={state.organizations
              .filter((entry) => entry.membershipKind === "member")
              .map((entry) => ({ value: entry.id, label: entry.name }))}
          />
        </Field>
      ) : null}
      <Field label={t("spaces.create.name")} {...(errors.name ? { error: errors.name } : {})}>
        <Input
          autoFocus
          value={name}
          maxLength={100}
          placeholder={t("spaces.create.namePlaceholder")}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field
        label={t("spaces.create.key")}
        hint={t("spaces.create.keyHint")}
        {...(errors.key ? { error: errors.key } : {})}
      >
        <Input
          value={key}
          maxLength={10}
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(event) => {
            setKeyEdited(true);
            setKey(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
          }}
          onBlur={() => {
            if (key) void validate();
          }}
        />
      </Field>
      <Field label={t("spaces.create.description")} hint={t("spaces.create.descriptionHint")}>
        <Textarea
          rows={2}
          maxLength={1000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      {canCreateConfidential ? (
        <div className="flex flex-col gap-2">
          <Checkbox
            label={t("confidential.createLabel")}
            description={t("confidential.createDescription")}
            checked={confidential}
            onCheckedChange={setConfidential}
          />
          {confidential ? (
            <Notice variant="info" title={t("confidential.createNoticeTitle")}>
              {t("confidential.limit")}
            </Notice>
          ) : null}
        </div>
      ) : null}
      {confidential ? null : (
        <VisibilityField
          value={visibility}
          onChange={setVisibility}
          organizationName={organization?.name ?? ""}
        />
      )}
      <GrantsField
        organizationId={organizationId}
        organizationName={organization?.name ?? null}
        grants={visibleGrants}
        onChange={setGrants}
        ownId={ownId}
        peopleOnly={confidential}
      />
      <WhoGetsAccess
        visibility={confidential ? null : visibility}
        grants={visibleGrants}
        ownId={ownId}
        organizationName={organization?.name ?? null}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={submitting}>
          {t("spaces.create.submit")}
        </Button>
      </div>
    </form>
  );
}
