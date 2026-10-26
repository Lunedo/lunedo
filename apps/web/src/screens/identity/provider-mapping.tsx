import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  type ComboboxItem,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Menu,
  Notice,
  SegmentedControl,
  Select,
  type SelectOption,
  Table,
  TableToolbar,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import {
  ArrowDown,
  ArrowUp,
  MoreHorizontal,
  Pencil,
  Plus,
  Shield,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import {
  createMappingRule,
  groupPreviewQuery,
  type IdentityProvider,
  type MappingRule,
  type MappingRuleInput,
  mappingKeys,
  mappingRulesQuery,
  orderMappingRules,
  removeMappingRule,
  searchProviderGroups,
  updateMappingRule,
} from "../../api/identity-queries.js";
import { instanceRolesQuery } from "../../api/instance-queries.js";
import { rolesQuery } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { FailureNotice, LoadError, useFailureToast } from "../../errors/failure.js";
import { translateKey } from "../../i18n/translate.js";

type Target = "organization" | "instance";
type RoleValue = string;

const MEMBER = "member";
const BUILT_IN = "builtIn:";
const CUSTOM = "custom:";

function roleLabel(t: TFunction, role: MappingRule["role"]): string {
  if (role === null) return t("roles.builtIn.member");
  if ("builtIn" in role) return translateKey(t, `roles.builtIn.${role.builtIn}`);
  return role.name;
}

export function grantsText(t: TFunction, rule: MappingRule): string {
  const parts = [roleLabel(t, rule.role)];
  if (rule.synchronizedGroup)
    parts.push(t("identityProviders.mapping.inGroup", { name: rule.synchronizedGroup.name }));
  if (rule.homeOrganization) parts.push(t("identityProviders.mapping.homeOrganization"));
  return parts.join(" · ");
}

function roleValue(role: MappingRule["role"]): RoleValue {
  if (role === null) return MEMBER;
  return "builtIn" in role ? `${BUILT_IN}${role.builtIn}` : `${CUSTOM}${role.customRoleId}`;
}

function roleInput(value: RoleValue): MappingRuleInput["role"] {
  if (value.startsWith(BUILT_IN)) {
    return { builtIn: value.slice(BUILT_IN.length) as "owner" | "administrator" | "securityAuditor" };
  }
  if (value.startsWith(CUSTOM)) return { customRoleId: value.slice(CUSTOM.length) };
  return null;
}

export function ruleInputOf(rule: MappingRule): MappingRuleInput {
  const group = { id: rule.group.id, name: rule.group.name };
  const role = !rule.role
    ? null
    : "builtIn" in rule.role
      ? { builtIn: rule.role.builtIn as "owner" | "administrator" | "securityAuditor" }
      : { customRoleId: rule.role.customRoleId };
  if (rule.target === "instance") {
    return { target: "instance", group, role: role ?? { builtIn: "administrator" } };
  }
  return {
    target: "organization",
    group,
    organizationId: rule.organization?.id ?? "",
    role,
    synchronizedGroup: rule.synchronizedGroup !== null,
    homeOrganization: rule.homeOrganization,
  };
}

export function MappingTab({ provider, canManage }: { provider: IdentityProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const rules = useQuery({ ...mappingRulesQuery(provider.id), throwOnError: false });
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<MappingRule | "new" | null>(null);
  const { toast } = useToast();
  const refresh = () => queryClient.invalidateQueries({ queryKey: mappingKeys.rules(provider.id) });
  const list = rules.data ?? [];
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? list.filter((rule) =>
        [rule.group.id, rule.group.name ?? "", rule.organization?.name ?? ""].some((value) =>
          value.toLowerCase().includes(needle),
        ),
      )
    : list;

  const move = async (rule: MappingRule, offset: -1 | 1) => {
    const ids = list.map((entry) => entry.id);
    const index = ids.indexOf(rule.id);
    const other = index + offset;
    if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other] ?? rule.id, rule.id];
    try {
      await orderMappingRules(provider.id, ids);
      await refresh();
    } catch (failure) {
      showFailure(t("failures.orderMappingRules"), failure);
    }
  };

  const remove = async (rule: MappingRule) => {
    const order = list.map((entry) => entry.id);
    try {
      await removeMappingRule(provider.id, rule.id);
      await refresh();
    } catch (failure) {
      showFailure(t("failures.removeMappingRule"), failure);
      return;
    }
    const restore = async () => {
      const created = await createMappingRule(provider.id, ruleInputOf(rule));
      const current = (await queryClient.fetchQuery({ ...mappingRulesQuery(provider.id), staleTime: 0 })).map(
        (entry) => entry.id,
      );
      const wanted = order
        .map((id) => (id === rule.id ? created.id : id))
        .filter((id) => current.includes(id));
      const rest = current.filter((id) => !wanted.includes(id));
      await orderMappingRules(provider.id, [...wanted, ...rest]);
      await refresh();
    };
    toast({
      title: t("identityProviders.mapping.removed", { name: rule.group.name ?? rule.group.id }),
      undo: {
        onUndo: () => {
          restore().catch((failure: unknown) => showFailure(t("failures.saveMappingRule"), failure));
        },
      },
    });
  };

  if (rules.isError) {
    return (
      <LoadError what={t("failures.loadMappingRules")} error={rules.error} onRetry={() => rules.refetch()} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {provider.capabilities.groupsByName ? (
        <Notice variant="warning" title={t("identityProviders.mapping.byNameTitle")}>
          {t("identityProviders.mapping.byName", { provider: provider.name })}
        </Notice>
      ) : null}
      <TableToolbar
        search={{
          value: search,
          onChange: setSearch,
          label: t("identityProviders.mapping.search"),
          placeholder: t("identityProviders.mapping.search"),
        }}
        actions={
          canManage ? (
            <Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>
              {t("identityProviders.mapping.add")}
            </Button>
          ) : undefined
        }
      />
      <Table
        caption={t("identityProviders.mapping.caption")}
        rows={shown}
        rowKey={(rule) => rule.id}
        loading={rules.isPending}
        empty={needle ? t("identityProviders.mapping.noMatches") : t("identityProviders.mapping.empty")}
        {...(canManage ? { onRowClick: (rule: MappingRule) => setEditing(rule) } : {})}
        rowLabel={(rule) => t("identityProviders.mapping.edit", { name: rule.group.name ?? rule.group.id })}
        columns={[
          {
            key: "group",
            header: t("identityProviders.mapping.group", { provider: provider.name }),
            cell: (rule) => (
              <div className="flex flex-col gap-1">
                <span className="font-medium">{rule.group.name ?? rule.group.id}</span>
                <span className="font-mono text-text-muted text-xs">{rule.group.id}</span>
                {rule.group.missing ? (
                  <Badge variant="danger" icon={TriangleAlert}>
                    {t("identityProviders.mapping.missing")}
                  </Badge>
                ) : null}
              </div>
            ),
          },
          {
            key: "grants",
            header: t("identityProviders.mapping.grants"),
            cell: (rule) => (
              <span className="flex flex-wrap items-center gap-2">
                {rule.target === "instance" ? (
                  <Badge variant="accent" icon={Shield}>
                    {t("identityProviders.mapping.instanceRole")}
                  </Badge>
                ) : null}
                <span className="whitespace-nowrap">{grantsText(t, rule)}</span>
              </span>
            ),
          },
          {
            key: "in",
            header: t("identityProviders.mapping.in"),
            cell: (rule) => rule.organization?.name ?? t("identityProviders.mapping.instance"),
          },
          {
            key: "people",
            header: t("identityProviders.mapping.people"),
            align: "end",
            cell: (rule) => <span className="tabular-nums">{rule.accounts}</span>,
          },
          {
            key: "actions",
            sticky: true,
            header: <span className="sr-only">{t("settings.actions")}</span>,
            align: "end",
            cell: (rule) =>
              canManage ? (
                <Menu
                  trigger={
                    <IconButton
                      label={t("identityProviders.mapping.moreFor", {
                        name: rule.group.name ?? rule.group.id,
                      })}
                      icon={MoreHorizontal}
                    />
                  }
                  items={[
                    {
                      label: t("identityProviders.mapping.editAction"),
                      icon: Pencil,
                      onSelect: () => setEditing(rule),
                    },
                    {
                      label: t("identityProviders.mapping.moveUp"),
                      icon: ArrowUp,
                      disabled: list[0]?.id === rule.id,
                      onSelect: () => void move(rule, -1),
                    },
                    {
                      label: t("identityProviders.mapping.moveDown"),
                      icon: ArrowDown,
                      disabled: list.at(-1)?.id === rule.id,
                      onSelect: () => void move(rule, 1),
                    },
                    { type: "separator" },
                    {
                      label: t("identityProviders.mapping.remove"),
                      icon: Trash2,
                      danger: true,
                      onSelect: () => void remove(rule),
                    },
                  ]}
                />
              ) : null,
          },
        ]}
      />
      <p className="text-sm text-text-muted">
        {t("identityProviders.mapping.hint", { provider: provider.name })}
      </p>
      {editing ? (
        <RuleDialog
          provider={provider}
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function organizationItems(page: { items: { id: string; name: string; slug: string }[] }): ComboboxItem[] {
  return page.items.map((organization) => ({
    value: organization.id,
    label: organization.name,
    description: organization.slug,
  }));
}

function RuleDialog({
  provider,
  rule,
  onClose,
  onSaved,
}: {
  provider: IdentityProvider;
  rule: MappingRule | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [group, setGroup] = useState<ComboboxItem | null>(
    rule ? { value: rule.group.id, label: rule.group.name ?? rule.group.id } : null,
  );
  const [target, setTarget] = useState<Target>(rule?.target ?? "organization");
  const [organization, setOrganization] = useState<ComboboxItem | null>(
    rule?.organization ? { value: rule.organization.id, label: rule.organization.name } : null,
  );
  const [role, setRole] = useState<RoleValue>(rule ? roleValue(rule.role) : MEMBER);
  const [instanceRole, setInstanceRole] = useState<RoleValue>(
    rule && rule.target === "instance" ? roleValue(rule.role) : `${BUILT_IN}administrator`,
  );
  const [synchronizedGroup, setSynchronizedGroup] = useState(rule ? rule.synchronizedGroup !== null : false);
  const [homeOrganization, setHomeOrganization] = useState(rule?.homeOrganization ?? false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const organizationRoles = useQuery({
    ...rolesQuery(organization?.value ?? ""),
    enabled: target === "organization" && organization !== null,
    retry: false,
    throwOnError: false,
  });
  const instanceRoles = useQuery({
    ...instanceRolesQuery,
    enabled: target === "instance",
    retry: false,
    throwOnError: false,
  });
  const preview = useQuery({
    ...groupPreviewQuery(provider.id, group?.value ?? ""),
    enabled: group !== null,
    throwOnError: false,
  });

  const organizationRoleOptions: SelectOption[] = [
    { value: MEMBER, label: t("roles.builtIn.member") },
    { value: `${BUILT_IN}administrator`, label: t("roles.builtIn.administrator") },
    { value: `${BUILT_IN}owner`, label: t("roles.builtIn.owner") },
    ...(organizationRoles.data ?? []).map((custom) => ({
      value: `${CUSTOM}${custom.id}`,
      label: custom.name,
    })),
  ];
  const instanceRoleOptions: SelectOption[] = [
    { value: `${BUILT_IN}administrator`, label: t("roles.builtIn.administrator") },
    { value: `${BUILT_IN}securityAuditor`, label: t("roles.builtIn.securityAuditor") },
    ...(instanceRoles.data ?? []).map((custom) => ({ value: `${CUSTOM}${custom.id}`, label: custom.name })),
  ];

  const directory = provider.capabilities.directorySync;
  const [missing, setMissing] = useState(false);
  const groupInput = group
    ? { id: group.value, name: group.label === group.value ? null : group.label }
    : null;

  const save = async () => {
    if (!groupInput || (target === "organization" && organization === null)) {
      setMissing(true);
      focusFirstInvalidSoon();
      return;
    }
    const body: MappingRuleInput =
      target === "instance"
        ? {
            target: "instance",
            group: groupInput,
            role: roleInput(instanceRole) ?? { builtIn: "administrator" },
          }
        : {
            target: "organization",
            group: groupInput,
            organizationId: organization?.value ?? "",
            role: roleInput(role),
            synchronizedGroup,
            homeOrganization,
          };
    setSaving(true);
    setError(null);
    try {
      if (rule) await updateMappingRule(provider.id, rule.id, body);
      else await createMappingRule(provider.id, body);
      await onSaved();
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  };

  const gainsWhat = () => {
    const data = preview.data;
    if (!data) return "";
    const people = data.members ?? data.accounts;
    const where =
      target === "instance"
        ? translateKey(
            t,
            `roles.builtIn.${(roleInput(instanceRole) as { builtIn?: string } | null)?.builtIn ?? "administrator"}`,
          )
        : (organization?.label ?? "");
    return [
      target === "instance"
        ? t("identityProviders.mapping.previewInstance", { count: people, role: where })
        : t("identityProviders.mapping.previewOrganization", { count: people, organization: where }),
      data.withoutAccount === null
        ? t("identityProviders.mapping.previewAccounts", { count: data.accounts })
        : t("identityProviders.mapping.previewSplit", {
            accounts: data.accounts,
            later: data.withoutAccount,
          }),
    ].join(" ");
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={rule ? t("identityProviders.mapping.editTitle") : t("identityProviders.mapping.addTitle")}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            {rule ? t("common.save") : t("identityProviders.mapping.add")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <FailureNotice what={t("failures.saveMappingRule")} error={error} /> : null}
        {provider.capabilities.groupsByName ? (
          <Notice variant="warning" title={t("identityProviders.mapping.byNameTitle")}>
            {t("identityProviders.mapping.byName", { provider: provider.name })}
          </Notice>
        ) : null}
        <Field
          label={t("identityProviders.mapping.group", { provider: provider.name })}
          hint={
            directory
              ? t("identityProviders.mapping.groupHintDirectory", { provider: provider.name })
              : t("identityProviders.mapping.groupHint", { provider: provider.name })
          }
          {...(missing && group === null ? { error: t("identityProviders.mapping.chooseGroup") } : {})}
        >
          <Combobox
            value={group?.value ?? null}
            selectedItem={group}
            onValueChange={(_value, item) => setGroup(item)}
            placeholder={
              directory
                ? t("identityProviders.mapping.groupPlaceholderDirectory")
                : t("identityProviders.mapping.groupPlaceholder")
            }
            emptyText={
              directory
                ? t("identityProviders.mapping.noGroupsDirectory")
                : t("identityProviders.mapping.noGroups")
            }
            load={async (query) => {
              const found = await searchProviderGroups(provider.id, query.trim());
              const items: ComboboxItem[] = found.map((entry) => ({
                value: entry.id,
                label: entry.name ?? entry.id,
                description: [
                  entry.members === null
                    ? t("identityProviders.mapping.accounts", { count: entry.accounts })
                    : t("identityProviders.mapping.members", { count: entry.members }),
                  entry.mapped ? t("identityProviders.mapping.alreadyMapped") : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
                keywords: [entry.id],
              }));
              const typed = query.trim();
              if (!directory && typed && !items.some((item) => item.value === typed)) {
                items.push({
                  value: typed,
                  label: typed,
                  description: t("identityProviders.mapping.useAsId"),
                });
              }
              return { items, nextCursor: null };
            }}
          />
        </Field>
        <Field label={t("identityProviders.mapping.grants")}>
          <SegmentedControl
            label={t("identityProviders.mapping.grants")}
            value={target}
            onValueChange={(next) => setTarget(next as Target)}
            options={[
              { value: "organization", label: t("identityProviders.mapping.organizationAccess") },
              { value: "instance", label: t("identityProviders.mapping.instanceRole") },
            ]}
          />
        </Field>
        {target === "organization" ? (
          <>
            <div className="flex flex-col gap-4">
              <Field
                label={t("identityProviders.mapping.organization")}
                {...(missing && organization === null
                  ? { error: t("identityProviders.mapping.chooseOrganization") }
                  : {})}
              >
                <Combobox
                  value={organization?.value ?? null}
                  selectedItem={organization}
                  onValueChange={(_value, item) => setOrganization(item)}
                  placeholder={t("identityProviders.mapping.organizationPlaceholder")}
                  load={async (query, cursor) => {
                    const page = await request(() =>
                      api.GET("/api/v1/instance/organizations", {
                        params: {
                          query: {
                            limit: 20,
                            ...(query.trim() ? { q: query.trim() } : {}),
                            ...(cursor ? { cursor } : {}),
                          },
                        },
                      }),
                    );
                    return { items: organizationItems(page), nextCursor: page.nextCursor };
                  }}
                />
              </Field>
              <Field label={t("identityProviders.mapping.role")}>
                <Select value={role} onValueChange={setRole} options={organizationRoleOptions} />
              </Field>
            </div>
            <Checkbox
              checked={synchronizedGroup}
              onCheckedChange={setSynchronizedGroup}
              label={t("identityProviders.mapping.synchronizedGroup")}
              description={t("identityProviders.mapping.synchronizedGroupHint")}
            />
            <Checkbox
              checked={homeOrganization}
              onCheckedChange={setHomeOrganization}
              label={t("identityProviders.mapping.makeHome")}
              description={t("identityProviders.mapping.makeHomeHint")}
            />
          </>
        ) : (
          <>
            <Field label={t("identityProviders.mapping.instanceRole")}>
              <Select value={instanceRole} onValueChange={setInstanceRole} options={instanceRoleOptions} />
            </Field>
            <p className="text-sm text-text-muted">{t("identityProviders.mapping.instanceRoleNote")}</p>
          </>
        )}
        {group && (target === "instance" || organization !== null) ? (
          preview.isError ? (
            <FailureNotice
              what={t("failures.loadGroupPreview")}
              error={preview.error}
              onRetry={() => void preview.refetch()}
            />
          ) : preview.data ? (
            <AccessImpact
              change="gains"
              people={preview.data.sample.map((person) => person.name)}
              what={gainsWhat()}
            />
          ) : null
        ) : null}
      </div>
    </Dialog>
  );
}
