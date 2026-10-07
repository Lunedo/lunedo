import {
  Button,
  Combobox,
  Dialog,
  EmptyState,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Notice,
  RadioGroup,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Layers, Plus, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { organizationQuery, organizationSettingsQuery } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { SaveIndicator, useSaveState } from "../../components/auto-save.js";
import { SettingsList } from "../../components/settings-list.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { SettingsPage } from "../../screens/settings/settings-page.js";
import { useOrganizationSettingMutation } from "../../settings/setting-mutations.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import {
  type Grant,
  type Holder,
  HolderPicker,
  holderLabel,
  holderValue,
  RoleSelect,
} from "../access/holders.js";
import { type SpaceRole, type SpaceVisibility, spaceDefaultsQuery, spaceKeys } from "../space-queries.js";
import { Panel } from "./panel.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/spaces");
const VISIBILITIES: SpaceVisibility[] = ["private", "organization", "instance"];

export function OrganizationSpacesScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const organization = useQuery(organizationQuery(organizationId));
  const settings = useQuery(organizationSettingsQuery(organizationId));
  const mutation = useOrganizationSettingMutation(organizationId);
  const canManage = state.can("organization.settings.manage");
  return (
    <SettingsPage
      title={t("spaces.organization.title")}
      description={t("spaces.organization.description")}
      icon={Layers}
      organizationId={organizationId}
    >
      <Panel title={t("spaces.organization.creating")}>
        <SettingsList
          settings={settings.data}
          keys={["spaces.membersCreateSpaces"]}
          level="organization"
          {...(organization.data ? { organizationName: organization.data.name } : {})}
          canManage={() => canManage}
          onChange={async (key, change) => {
            await mutation.mutateAsync({ key, change });
          }}
        />
      </Panel>
      <DefaultPermissions
        organizationId={organizationId}
        organizationName={organization.data?.name ?? null}
        editable={canManage}
      />
      {state.can("organization.spaces.view") ? (
        <WithoutAdministrator organizationId={organizationId} />
      ) : null}
    </SettingsPage>
  );
}

function DefaultPermissions({
  organizationId,
  organizationName,
  editable,
}: {
  organizationId: string;
  organizationName: string | null;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const defaults = useQuery(spaceDefaultsQuery(organizationId));
  const tracker = useSaveState();
  const [adding, setAdding] = useState<(Holder & { name: string }) | null>(null);
  const [addingRole, setAddingRole] = useState<SpaceRole>("reader");
  const [addError, setAddError] = useState<string | null>(null);

  const save = (visibility: SpaceVisibility, grants: Grant[]) =>
    tracker.run(async () => {
      const saved = await request(() =>
        api.PUT("/api/v1/organizations/{organizationId}/space-defaults", {
          params: { path: { organizationId } },
          body: {
            visibility,
            grants: grants.map(({ principalKind, principalId, role }) => ({
              principalKind,
              principalId,
              role,
            })),
          },
        }),
      );
      queryClient.setQueryData(spaceKeys.defaults(organizationId), saved);
    });

  if (defaults.isPending) return <Skeleton className="h-field w-full" />;
  if (defaults.isError) {
    return (
      <LoadError
        what={t("spaces.organization.defaultsFailed")}
        error={defaults.error}
        onRetry={() => defaults.refetch()}
      />
    );
  }
  const { visibility, grants } = defaults.data;
  return (
    <Panel
      title={t("spaces.organization.defaults")}
      description={t("spaces.organization.defaultsDescription")}
      actions={<SaveIndicator tracker={tracker} />}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">{t("spaces.create.visibility")}</legend>
        <RadioGroup
          label={t("spaces.create.visibility")}
          variant="card"
          value={visibility}
          onValueChange={(value) => editable && void save(value as SpaceVisibility, grants)}
          options={VISIBILITIES.map((value) => ({
            value,
            label: t(`spaces.visibility.${value}.label`),
            description: t(`spaces.visibility.${value}.description`, {
              organization: organizationName ?? "",
            }),
          }))}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">{t("spaces.create.permissions")}</legend>
        <p className="text-sm text-text-muted">{t("spaces.organization.creatorAdmin")}</p>
        {grants.length === 0 ? (
          <p className="text-sm text-text-muted">{t("spaces.organization.noDefaultHolders")}</p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {grants.map((grant) => {
            const text = holderLabel(t, grant, organizationName);
            return (
              <li key={holderValue(grant)} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 grow basis-field truncate" title={text}>
                  {text}
                </span>
                <div className="w-unit-field">
                  <RoleSelect
                    label={t("spaces.create.roleOf", { holder: text })}
                    value={grant.role}
                    onValueChange={(role) =>
                      editable &&
                      void save(
                        visibility,
                        grants.map((entry) =>
                          holderValue(entry) === holderValue(grant) ? { ...entry, role } : entry,
                        ),
                      )
                    }
                  />
                </div>
                {editable ? (
                  <IconButton
                    label={t("spaces.create.removeHolder", { holder: text })}
                    icon={X}
                    onClick={() =>
                      void save(
                        visibility,
                        grants.filter((entry) => holderValue(entry) !== holderValue(grant)),
                      )
                    }
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
        {editable ? (
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!adding) {
                setAddError(t("spaces.create.chooseHolderFirst"));
                focusFirstInvalidSoon();
                return;
              }
              setAddError(null);
              void save(visibility, [
                ...grants.filter((entry) => holderValue(entry) !== holderValue(adding)),
                { ...adding, role: addingRole },
              ]).then((ok) => ok && setAdding(null));
            }}
          >
            <div className="min-w-0 flex-1">
              <Field label={t("spaces.create.addHolder")} {...(addError ? { error: addError } : {})}>
                <HolderPicker
                  label={t("spaces.create.addHolder")}
                  organizationId={organizationId}
                  organizationName={organizationName}
                  personal={false}
                  exclude={grants.map(holderValue)}
                  value={adding ? holderValue(adding) : null}
                  onValueChange={setAdding}
                />
              </Field>
            </div>
            <div className="sm:w-unit-field">
              <RoleSelect
                label={t("spaces.create.newRole")}
                value={addingRole}
                onValueChange={setAddingRole}
              />
            </div>
            <Button type="submit" variant="secondary" icon={Plus}>
              {t("spaces.create.add")}
            </Button>
          </form>
        ) : null}
      </fieldset>
    </Panel>
  );
}

function WithoutAdministrator({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const spaces = useQuery({
    queryKey: spaceKeys.withoutAdministrator(organizationId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/spaces-without-administrator", {
          params: { path: { organizationId }, query: { limit: 200 } },
        }),
      ),
  });
  const [appointing, setAppointing] = useState<{ id: string; name: string } | null>(null);
  return (
    <Panel
      title={t("spaces.organization.withoutAdmin")}
      description={t("spaces.organization.withoutAdminDescription")}
    >
      {spaces.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {spaces.isError ? (
        <LoadError
          what={t("spaces.organization.withoutAdminFailed")}
          error={spaces.error}
          onRetry={() => spaces.refetch()}
        />
      ) : null}
      {spaces.data && spaces.data.items.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={t("spaces.organization.allHaveAdmins")}
          description={t("spaces.organization.allHaveAdminsDescription")}
        />
      ) : null}
      {spaces.data && spaces.data.items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {spaces.data.items.map((space) => (
            <li key={space.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium" title={space.name}>
                  {space.name}
                </span>
                <span className="text-sm text-text-muted">{space.key}</span>
              </div>
              {state.can("organization.spaces.manage") ? (
                <Button variant="secondary" onClick={() => setAppointing({ id: space.id, name: space.name })}>
                  {t("spaces.organization.appoint")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <AppointDialog
        organizationId={organizationId}
        space={appointing}
        onOpenChange={(open) => !open && setAppointing(null)}
      />
    </Panel>
  );
}

function AppointDialog({
  organizationId,
  space,
  onOpenChange,
}: {
  organizationId: string;
  space: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [person, setPerson] = useState<{ value: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!space) return;
    if (!person) {
      setError(t("spaces.organization.choosePerson"));
      focusFirstInvalidSoon();
      return;
    }
    setError(null);
    setFailure(null);
    setSaving(true);
    try {
      await request(() =>
        api.POST("/api/v1/organizations/{organizationId}/spaces/{spaceId}/administrator", {
          params: { path: { organizationId, spaceId: space.id } },
          body: { accountId: person.value },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: spaceKeys.withoutAdministrator(organizationId) });
      toast({
        title: t("spaces.organization.appointed", { person: person.label, space: space.name }),
        variant: "success",
      });
      setPerson(null);
      onOpenChange(false);
    } catch (problem) {
      setFailure(problemMessage(t, problem));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={space !== null}
      onOpenChange={onOpenChange}
      title={space ? t("spaces.organization.appointTitle", { space: space.name }) : ""}
      size="sm"
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {failure ? (
          <Notice variant="danger" title={t("spaces.organization.appointFailed")}>
            {failure}
          </Notice>
        ) : null}
        <Field
          label={t("spaces.organization.person")}
          hint={t("spaces.organization.personHint")}
          {...(error ? { error } : {})}
        >
          <Combobox
            aria-label={t("spaces.organization.person")}
            value={person?.value ?? null}
            selectedItem={person}
            emptyText={t("spaces.holders.noMatch")}
            load={async (query) => {
              const members = await request(() =>
                api.GET("/api/v1/organizations/{organizationId}/members", {
                  params: { path: { organizationId }, query: { limit: 20, ...(query ? { q: query } : {}) } },
                }),
              );
              return {
                items: members.items.map((member) => ({
                  value: member.accountId,
                  label: member.name,
                  ...(member.email ? { description: member.email } : {}),
                })),
              };
            }}
            onValueChange={(value, item) => setPerson(value && item ? { value, label: item.label } : null)}
          />
        </Field>
        <Notice variant="warning" title={t("spaces.organization.appointEffectTitle")}>
          {t("spaces.organization.appointEffect", { space: space?.name ?? "" })}
        </Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {t("spaces.organization.appointSubmit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
