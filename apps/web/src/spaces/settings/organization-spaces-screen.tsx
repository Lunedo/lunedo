import {
  Badge,
  Button,
  Combobox,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Menu,
  type MenuItem,
  Notice,
  RadioGroup,
  Select,
  Skeleton,
  Table,
  TableToolbar,
  Tabs,
  TruncatedText,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ExternalLink,
  Lock,
  MoreHorizontal,
  Plus,
  Settings,
  ShieldCheck,
  ShieldPlus,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { organizationQuery, organizationSettingsQuery } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { SaveIndicator, useSaveState } from "../../components/auto-save.js";
import { SettingsList } from "../../components/settings-list.js";
import { useServerTable } from "../../components/table-state.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
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
import { BecomeAdministratorDialog, type BecomeAdministratorTarget } from "./become-administrator-dialog.js";
import { ConfidentialSpaces } from "./confidential-spaces.js";
import { Panel } from "./panel.js";
import { SpaceCleanup } from "./space-cleanup.js";

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
  const canView = state.can("organization.spaces.view");
  const [tab, setTab] = useState(canView ? "all" : "defaults");
  const defaults = (
    <div className="flex flex-col gap-8">
      <Panel title={t("spaces.organization.creating")}>
        <SettingsList
          settings={settings.data}
          keys={["spaces.membersCreateSpaces", "spaces.membersCreateConfidentialSpaces"]}
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
    </div>
  );
  return (
    <SettingsPage
      wide
      title={t("spaces.organization.title")}
      description={t("spaces.organization.description", { name: organization.data?.name ?? "" })}
    >
      {canView ? (
        <Tabs
          label={t("spaces.organization.title")}
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: "all", label: t("spaces.organization.allSpaces") },
            ...(state.can("organization.spaces.manage")
              ? [{ value: "cleanup", label: t("spaces.cleanup.tab") }]
              : []),
            { value: "defaults", label: t("spaces.organization.defaultsTab") },
          ]}
        >
          {tab === "all" ? (
            <div className="flex flex-col gap-6">
              <WithoutAdministrator organizationId={organizationId} />
              <AllSpaces
                organizationId={organizationId}
                canManageSpaces={state.can("organization.spaces.manage")}
              />
              <ConfidentialSpaces
                organizationId={organizationId}
                canManage={state.can("organization.spaces.manage")}
              />
              <ConfidentialSpaces
                organizationId={organizationId}
                canManage={state.can("organization.spaces.manage")}
                kind="personal"
              />
            </div>
          ) : tab === "cleanup" ? (
            <SpaceCleanup
              organizationId={organizationId}
              organizationName={organization.data?.name}
              canManage={state.can("organization.spaces.manage")}
              canChangeSetting={canManage}
              settings={settings.data}
              onSettingChange={async (key, change) => {
                await mutation.mutateAsync({ key, change });
              }}
            />
          ) : (
            defaults
          )}
        </Tabs>
      ) : (
        defaults
      )}
    </SettingsPage>
  );
}

type SpaceTypeFilter = "all" | "standard" | "knowledgeBase";
type SpaceStateFilter = "all" | "active" | "archived";
type OrganizationSpace = NonNullable<Awaited<ReturnType<typeof fetchOrganizationSpaces>>>["items"][number];

function fetchOrganizationSpaces(
  organizationId: string,
  search: string,
  cursor: string | null,
  limit: number,
  type: SpaceTypeFilter,
  stateFilter: SpaceStateFilter,
) {
  return request(() =>
    api.GET("/api/v1/organizations/{organizationId}/spaces", {
      params: {
        path: { organizationId },
        query: {
          limit,
          ...(search ? { q: search } : {}),
          ...(cursor ? { cursor } : {}),
          ...(type !== "all" ? { type } : {}),
          ...(stateFilter !== "all" ? { state: stateFilter } : {}),
        },
      },
    }),
  );
}

function SpaceStatus({ space }: { space: OrganizationSpace }) {
  const { t } = useTranslation();
  if (space.archived) return <Badge variant="neutral">{t("spaces.organization.status.archived")}</Badge>;
  if (space.confidential)
    return (
      <Badge variant="warning" icon={Lock}>
        {t("spaces.organization.status.confidential")}
      </Badge>
    );
  return (
    <Badge variant={space.visibility === "private" ? "neutral" : "info"}>
      {t(`spaces.organization.status.${space.visibility === "private" ? "private" : "shared"}`)}
    </Badge>
  );
}

function AllSpaces({
  organizationId,
  canManageSpaces,
}: {
  organizationId: string;
  canManageSpaces: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const [type, setType] = useState<SpaceTypeFilter>("all");
  const [stateFilter, setStateFilter] = useState<SpaceStateFilter>("all");
  const [appointing, setAppointing] = useState<{ id: string; name: string } | null>(null);
  const [becoming, setBecoming] = useState<BecomeAdministratorTarget | null>(null);
  const table = useServerTable(
    [...spaceKeys.organizationSpaces(organizationId), type, stateFilter],
    (search, cursor, limit) =>
      fetchOrganizationSpaces(organizationId, search, cursor, limit, type, stateFilter),
  );
  const label = (space: OrganizationSpace) => space.name ?? t("spaces.organization.confidentialName");

  const archive = async (space: OrganizationSpace, archived: boolean) => {
    try {
      await request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/archived", {
          params: { path: { spaceId: space.id } },
          body: { archived },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: spaceKeys.organizationSpaces(organizationId) });
      toast({
        title: t(archived ? "spaces.organization.archived" : "spaces.organization.restored", {
          name: label(space),
        }),
        undo: { onUndo: () => void archive(space, !archived) },
      });
    } catch (failure) {
      showFailure(
        t("spaces.organization.archiveFailed", { name: label(space) }),
        failure,
        () => void archive(space, archived),
      );
    }
  };

  const menu = (space: OrganizationSpace): MenuItem[] => [
    ...(space.confidential
      ? []
      : [
          {
            label: t("spaces.organization.open"),
            icon: ExternalLink,
            onSelect: () => void navigate({ to: "/spaces/$spaceKey", params: { spaceKey: space.key } }),
          },
        ]),
    ...(space.canManage
      ? [
          {
            label: t("spaces.organization.settings"),
            icon: Settings,
            onSelect: () =>
              void navigate({ to: "/spaces/$spaceKey/settings/general", params: { spaceKey: space.key } }),
          },
          {
            label: t("spaces.organization.changeAdmins"),
            icon: UserCog,
            onSelect: () =>
              void navigate({
                to: "/spaces/$spaceKey/settings/permissions",
                params: { spaceKey: space.key },
              }),
          },
        ]
      : space.administrators.length === 0 && !space.confidential
        ? [
            {
              label: t("spaces.organization.appoint"),
              icon: UserCog,
              onSelect: () => setAppointing({ id: space.id, name: label(space) }),
            },
          ]
        : []),
    ...(!space.canManage && !space.confidential && canManageSpaces
      ? [
          {
            label: t("spaces.become.action"),
            icon: ShieldPlus,
            onSelect: () => setBecoming({ id: space.id, key: space.key, name: label(space) }),
          },
        ]
      : []),
    ...(space.canManage
      ? [
          { type: "separator" as const },
          {
            label: space.archived ? t("spaces.organization.restore") : t("spaces.organization.archive"),
            icon: Archive,
            onSelect: () => void archive(space, !space.archived),
          },
        ]
      : []),
    ...(space.canDelete
      ? [
          {
            label: t("spaces.organization.delete"),
            icon: Trash2,
            danger: true,
            onSelect: () =>
              void navigate({ to: "/spaces/$spaceKey/settings/general", params: { spaceKey: space.key } }),
          },
        ]
      : []),
  ];

  return (
    <section aria-labelledby="all-spaces" className="flex flex-col gap-3">
      <h2 id="all-spaces" className="sr-only">
        {t("spaces.organization.allSpaces")}
      </h2>
      <TableToolbar
        search={{
          ...table.search,
          label: t("spaces.organization.search"),
          placeholder: t("spaces.organization.search"),
        }}
        filters={
          <>
            <Select
              aria-label={t("spaces.organization.typeFilter")}
              className="w-auto"
              value={type}
              onValueChange={(value) => {
                setType(value as SpaceTypeFilter);
                table.reset();
              }}
              options={[
                { value: "all", label: t("spaces.organization.types.all") },
                { value: "standard", label: t("spaces.organization.types.standard") },
                { value: "knowledgeBase", label: t("spaces.organization.types.knowledgeBase") },
              ]}
            />
            <Select
              aria-label={t("spaces.organization.stateFilter")}
              className="w-auto"
              value={stateFilter}
              onValueChange={(value) => {
                setStateFilter(value as SpaceStateFilter);
                table.reset();
              }}
              options={[
                { value: "all", label: t("spaces.organization.states.all") },
                { value: "active", label: t("spaces.organization.states.active") },
                { value: "archived", label: t("spaces.organization.states.archived") },
              ]}
            />
          </>
        }
        pagination={table.pagination}
      />
      {table.query.isError ? (
        <LoadError
          what={t("spaces.organization.listFailed")}
          error={table.query.error}
          onRetry={() => table.query.refetch()}
        />
      ) : null}
      <Table
        caption={t("spaces.organization.allSpaces")}
        rowKey={(space) => space.id}
        rows={table.rows}
        loading={table.query.isPending}
        pagination={table.pagination}
        empty={<p className="text-text-muted">{t("spaces.organization.noSpaces")}</p>}
        columns={[
          {
            key: "name",
            header: t("spaces.organization.name"),
            grow: true,
            cell: (space) => (
              <span className="flex min-w-0 items-center gap-2">
                <span className="inline-flex size-control-sm shrink-0 items-center justify-center rounded-sm bg-accent-soft text-xs font-semibold text-accent">
                  {space.key.slice(0, 2)}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <TruncatedText
                    text={label(space)}
                    className={space.name ? "font-medium" : "font-medium text-text-muted italic"}
                  />
                  <span className="text-xs text-text-muted">{space.key}</span>
                </span>
              </span>
            ),
          },
          {
            key: "type",
            header: t("spaces.organization.type"),
            hideBelow: "md",
            cell: (space) => (
              <span className="whitespace-nowrap">
                {t(
                  `spaces.organization.types.${space.type === "knowledgeBase" ? "knowledgeBase" : "standard"}`,
                )}
              </span>
            ),
          },
          {
            key: "admins",
            header: t("spaces.organization.admins"),
            hideBelow: "sm",
            cell: (space) =>
              space.confidential ? (
                <span className="text-text-muted">{t("spaces.organization.hidden")}</span>
              ) : space.administrators.length === 0 ? (
                <Badge variant="warning">{t("spaces.organization.noAdmin")}</Badge>
              ) : (
                <TruncatedText
                  text={space.administrators.map((holder) => holder.name).join(", ")}
                  className="max-w-field"
                />
              ),
          },
          {
            key: "pages",
            header: t("spaces.organization.pages"),
            align: "end",
            hideBelow: "md",
            cell: (space) => <span className="tabular-nums">{format.number(space.pages)}</span>,
          },
          {
            key: "storage",
            header: t("spaces.organization.storage"),
            align: "end",
            hideBelow: "md",
            cell: (space) => (
              <span className="whitespace-nowrap tabular-nums">{format.bytes(space.storageBytes)}</span>
            ),
          },
          {
            key: "activity",
            header: t("spaces.organization.lastActivity"),
            hideBelow: "md",
            cell: (space) => (
              <span className="whitespace-nowrap text-text-muted">
                {format.relative(space.lastActivityAt)}
              </span>
            ),
          },
          {
            key: "status",
            header: t("spaces.organization.statusColumn"),
            cell: (space) => <SpaceStatus space={space} />,
          },
          {
            key: "actions",
            sticky: true,
            align: "end",
            header: <span className="sr-only">{t("settings.actions")}</span>,
            cell: (space) => {
              const items = menu(space);
              return items.length > 0 ? (
                <Menu
                  align="end"
                  trigger={
                    <IconButton
                      label={t("spaces.organization.actionsFor", { name: label(space) })}
                      icon={MoreHorizontal}
                    />
                  }
                  items={items}
                />
              ) : null;
            },
          },
        ]}
      />
      <AppointDialog
        organizationId={organizationId}
        space={appointing}
        onOpenChange={(open) => !open && setAppointing(null)}
      />
      {becoming ? (
        <BecomeAdministratorDialog
          organizationId={organizationId}
          space={becoming}
          onClose={() => setBecoming(null)}
        />
      ) : null}
    </section>
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
  if (spaces.data && spaces.data.items.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-success">
        <ShieldCheck aria-hidden="true" className="size-icon-md shrink-0" />
        {t("spaces.organization.allHaveAdmins")}
      </p>
    );
  }
  return (
    <Panel title={t("spaces.organization.withoutAdmin")}>
      {spaces.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {spaces.isError ? (
        <LoadError
          what={t("spaces.organization.withoutAdminFailed")}
          error={spaces.error}
          onRetry={() => spaces.refetch()}
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
      await queryClient.invalidateQueries({ queryKey: spaceKeys.organizationSpaces(organizationId) });
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
