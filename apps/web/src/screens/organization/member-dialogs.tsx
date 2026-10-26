import { Button, Checkbox, Dialog, Input, Notice, Select, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { groupsQuery, type MemberDetails, organizationKeys } from "../../api/organization-queries.js";
import { fetchAllPages } from "../../api/queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { useFailureToast } from "../../errors/failure.js";
import { translateKey } from "../../i18n/translate.js";
import { useOrganizationState } from "../../shell/shell-context.js";

const SPACE_ROLES = ["reader", "commenter", "editor", "admin"] as const;
type SpaceRole = (typeof SPACE_ROLES)[number];

function matches(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle.trim().toLowerCase());
}

function SearchField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-icon-sm -translate-y-1/2 text-text-muted"
      />
      <Input
        type="search"
        value={value}
        aria-label={label}
        placeholder={label}
        className="w-full pl-10"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function AddGroupsDialog({
  open,
  onOpenChange,
  organizationId,
  member,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  member: MemberDetails;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const groups = useQuery({ ...groupsQuery(organizationId), enabled: open, throwOnError: false });
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const current = new Set(member.groupDetails.map((group) => group.id));
  const all = groups.data ?? [];
  const shown = all.filter((group) => matches(group.name, search));
  const selected = all.filter((group) => chosen.has(group.id));
  const spaces = selected.reduce((sum, group) => sum + (group.spaceCount ?? 0), 0);
  const close = (next: boolean) => {
    if (!next) {
      setChosen(new Set());
      setSearch("");
      setConfirming(false);
      setProblem(null);
    }
    onOpenChange(next);
  };
  const add = async () => {
    setSaving(true);
    const failed: string[] = [];
    let lastFailure: unknown = null;
    for (const group of selected) {
      try {
        await request(() =>
          api.POST("/api/v1/groups/{groupId}/members", {
            params: { path: { groupId: group.id } },
            body: { accountId: member.accountId },
          }),
        );
      } catch (failure) {
        failed.push(group.name);
        lastFailure = failure;
      }
    }
    setSaving(false);
    await queryClient.invalidateQueries({ queryKey: organizationKeys.members(organizationId) });
    await queryClient.invalidateQueries({ queryKey: organizationKeys.groups(organizationId) });
    if (failed.length > 0) {
      showFailure(t("members.page.groupsFailed", { groups: failed.join(", ") }), lastFailure);
      return;
    }
    toast({
      variant: "success",
      title: t("members.page.groupsAdded", { count: selected.length, name: member.name }),
    });
    close(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      title={t("members.page.addToGroupsTitle", { name: member.name })}
      description={t("members.page.addToGroupsDescription")}
      footer={
        confirming ? (
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t("common.back")}
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void add()}>
              {t("common.add")}
            </Button>
          </>
        ) : (
          <>
            <span className="mr-auto self-center text-sm text-text-muted">
              {selected.length === 0
                ? t("members.page.noGroupChosen")
                : t("members.page.groupsChosen", {
                    count: selected.length,
                    names: selected.map((group) => group.name).join(", "),
                  })}
            </span>
            <Button variant="secondary" onClick={() => close(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (selected.length === 0) {
                  setProblem(t("members.page.chooseGroup"));
                  list.current
                    ?.querySelector<HTMLElement>("button[role='checkbox']:not([disabled])")
                    ?.focus();
                  return;
                }
                setConfirming(true);
              }}
            >
              {t("common.next")}
            </Button>
          </>
        )
      }
    >
      {confirming ? (
        <AccessImpact
          change="gains"
          people={[member.name]}
          what={
            spaces > 0
              ? t("members.page.groupsImpactSpaces", {
                  groups: selected.map((group) => group.name).join(", "),
                  count: spaces,
                })
              : t("members.page.groupsImpact", { groups: selected.map((group) => group.name).join(", ") })
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <SearchField value={search} onChange={setSearch} label={t("members.page.searchGroups")} />
          {problem ? (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          ) : null}
          <div
            ref={list}
            className="flex max-h-sidebar flex-col overflow-y-auto rounded-md border border-border p-1"
          >
            {shown.length === 0 ? (
              <p className="p-3 text-sm text-text-muted">
                {groups.isPending ? t("common.loading") : t("groups.noMatch")}
              </p>
            ) : (
              shown.map((group) => {
                const member = current.has(group.id);
                const synchronized = Boolean(group.managedBy);
                return (
                  <div
                    key={group.id}
                    className="flex min-h-row shrink-0 items-center gap-3 rounded-sm px-2 py-2 hover:bg-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <Checkbox
                        checked={member || chosen.has(group.id)}
                        disabled={member || synchronized}
                        label={group.name}
                        onCheckedChange={(checked) => {
                          setProblem(null);
                          setChosen((previous) => {
                            const next = new Set(previous);
                            if (checked) next.add(group.id);
                            else next.delete(group.id);
                            return next;
                          });
                        }}
                      />
                    </div>
                    <span className="shrink-0 text-right text-sm text-text-muted">
                      {member
                        ? t("members.page.alreadyMember")
                        : synchronized
                          ? t("members.page.synchronizedFrom", {
                              provider: group.managedBy?.providerName ?? "",
                            })
                          : (group.spaceCount ?? 0) > 0
                            ? t("members.page.givesSpaces", { count: group.spaceCount ?? 0 })
                            : t("members.page.noSpaceRoles")}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

interface OfferedSpace {
  id: string;
  name: string;
}

export function AddSpacesDialog({
  open,
  onOpenChange,
  organizationId,
  member,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  member: MemberDetails;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const state = useOrganizationState();
  const organizationAdministrator = state.can("organization.spaces.manage");
  const organizationSpaces = useQuery({
    queryKey: ["organization", organizationId, "member-dialog-spaces"],
    enabled: open && organizationAdministrator,
    throwOnError: false,
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/organizations/{organizationId}/spaces", {
            params: {
              path: { organizationId },
              query: { limit: 200, state: "active", ...(cursor ? { cursor } : {}) },
            },
          }),
        ),
      ),
  });
  const ownSpaces = useQuery({
    queryKey: ["spaces", "administered", organizationId],
    enabled: open,
    throwOnError: false,
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/spaces", {
            params: { query: { organizationId, role: "admin", limit: 200, ...(cursor ? { cursor } : {}) } },
          }),
        ),
      ),
  });
  const offered = useMemo(() => {
    const spaces = new Map<string, OfferedSpace>();
    for (const space of organizationSpaces.data ?? []) {
      if (!space.confidential && space.name) spaces.set(space.id, { id: space.id, name: space.name });
    }
    for (const space of ownSpaces.data ?? []) {
      if (!space.confidential && !space.personal) spaces.set(space.id, { id: space.id, name: space.name });
    }
    return [...spaces.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [organizationSpaces.data, ownSpaces.data]);
  const existing = new Map((member.spaces ?? []).map((space) => [space.id, space]));
  const [search, setSearch] = useState("");
  const [roles, setRoles] = useState<Map<string, SpaceRole>>(new Map());
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const roleOf = (id: string): SpaceRole => roles.get(id) ?? "reader";
  const selected = offered.filter((space) => chosen.has(space.id));
  const administered = new Set((ownSpaces.data ?? []).map((space) => space.id));
  const rolesFor = (spaceId: string | null) =>
    SPACE_ROLES.filter((role) => role !== "admin" || (spaceId !== null && administered.has(spaceId))).map(
      (role) => ({ value: role, label: translateKey(t, `spaces.roles.${role}`) }),
    );
  const close = (next: boolean) => {
    if (!next) {
      setChosen(new Set());
      setRoles(new Map());
      setSearch("");
      setConfirming(false);
      setProblem(null);
    }
    onOpenChange(next);
  };
  const add = async () => {
    setSaving(true);
    try {
      await request(() =>
        api.POST("/api/v1/organizations/{organizationId}/members/{accountId}/spaces", {
          params: { path: { organizationId, accountId: member.accountId } },
          body: { spaces: selected.map((space) => ({ spaceId: space.id, role: roleOf(space.id) })) },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: organizationKeys.members(organizationId) });
      toast({
        variant: "success",
        title: t("members.page.spacesAdded", { count: selected.length, name: member.name }),
      });
      close(false);
    } catch (failure) {
      showFailure(t("members.page.spacesFailed"), failure, () => void add());
    } finally {
      setSaving(false);
    }
  };
  const summary = selected.map(
    (space) => `${space.name} (${translateKey(t, `spaces.roles.${roleOf(space.id)}`)})`,
  );
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      title={t("members.page.addToSpacesTitle", { name: member.name })}
      description={t("members.page.addToSpacesDescription")}
      footer={
        confirming ? (
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t("common.back")}
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void add()}>
              {t("common.add")}
            </Button>
          </>
        ) : (
          <>
            <span className="mr-auto self-center text-sm text-text-muted">
              {selected.length === 0 ? t("members.page.noSpaceChosen") : summary.join(", ")}
            </span>
            <Button variant="secondary" onClick={() => close(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (selected.length === 0) {
                  setProblem(t("members.page.chooseSpace"));
                  list.current
                    ?.querySelector<HTMLElement>("button[role='checkbox']:not([disabled])")
                    ?.focus();
                  return;
                }
                setConfirming(true);
              }}
            >
              {t("common.next")}
            </Button>
          </>
        )
      }
    >
      {confirming ? (
        <div className="flex flex-col gap-3">
          <AccessImpact
            change="gains"
            people={[member.name]}
            what={t("members.page.spacesImpact", { spaces: summary.join(", ") })}
          />
          {organizationAdministrator ? (
            <Notice variant="info">{t("members.page.administratorNotice")}</Notice>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <SearchField value={search} onChange={setSearch} label={t("members.page.searchSpaces")} />
            </div>
            <Select
              aria-label={t("members.page.roleForAll")}
              className="w-auto"
              value=""
              placeholder={t("members.page.roleForAll")}
              options={rolesFor(null)}
              onValueChange={(value) =>
                setRoles(new Map(offered.map((space) => [space.id, value as SpaceRole])))
              }
            />
          </div>
          {problem ? (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          ) : null}
          <div
            ref={list}
            className="flex max-h-sidebar flex-col overflow-y-auto rounded-md border border-border p-1"
          >
            {offered.filter((space) => matches(space.name, search)).length === 0 ? (
              <p className="p-3 text-sm text-text-muted">
                {organizationSpaces.isPending && ownSpaces.isPending
                  ? t("common.loading")
                  : t("members.page.noSpacesOffered")}
              </p>
            ) : (
              offered
                .filter((space) => matches(space.name, search))
                .map((space) => {
                  const held = existing.get(space.id);
                  return (
                    <div
                      key={space.id}
                      className="flex min-h-row shrink-0 flex-wrap items-center gap-3 rounded-sm px-2 py-2 hover:bg-hover"
                    >
                      <div className="min-w-0 flex-1">
                        <Checkbox
                          checked={Boolean(held) || chosen.has(space.id)}
                          disabled={Boolean(held)}
                          label={space.name}
                          onCheckedChange={(checked) => {
                            setProblem(null);
                            setChosen((previous) => {
                              const next = new Set(previous);
                              if (checked) next.add(space.id);
                              else next.delete(space.id);
                              return next;
                            });
                          }}
                        />
                      </div>
                      {held ? (
                        <span className="text-sm text-text-muted">
                          {t("members.page.alreadyIn", {
                            role: translateKey(t, `spaces.roles.${held.role}`),
                          })}
                        </span>
                      ) : (
                        <Select
                          aria-label={t("members.page.roleIn", { space: space.name })}
                          className="w-auto"
                          value={roleOf(space.id)}
                          options={rolesFor(space.id)}
                          onValueChange={(value) =>
                            setRoles((previous) => new Map(previous).set(space.id, value as SpaceRole))
                          }
                        />
                      )}
                    </div>
                  );
                })
            )}
          </div>
          <p className="text-sm text-text-muted">
            {organizationAdministrator
              ? t("members.page.administratorNotice")
              : t("members.page.protectedSpaces")}
          </p>
        </div>
      )}
    </Dialog>
  );
}
