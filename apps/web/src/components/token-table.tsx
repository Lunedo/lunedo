import { Dialog, IconButton, Menu, type MenuItem, Table, TableToolbar, TruncatedText } from "@lunedo/ui";
import { Info, KeyRound, MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiToken } from "../api/account-queries.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { usePaged, useSorted } from "./table-state.js";
import { contentSummary } from "./token-content-access.js";

const CONTENT_AREA = "spaces";

export interface TokenRight {
  area: string;
  level: string;
}

export function tokenRights(
  t: Parameters<typeof translateKey>[0],
  token: Pick<ApiToken, "scopes" | "contentLevel" | "knowledgeBaseIds">,
  names?: ReadonlyMap<string, string>,
): TokenRight[] {
  const content = contentSummary(t, token, names);
  return [
    ...(content ? [{ area: t("tokens.content.title"), level: content }] : []),
    ...Object.entries(token.scopes.organization ?? {})
      .filter(([area]) => area !== CONTENT_AREA)
      .map(([area, level]) => ({
        area: translateKey(t, `areas.organization.${area}`),
        level: translateKey(t, `areas.levels.${String(level)}`),
      })),
    ...Object.entries(token.scopes.instance ?? {}).map(([area, level]) => ({
      area: translateKey(t, `areas.instance.${area}`),
      level: translateKey(t, `areas.levels.${String(level)}`),
    })),
  ];
}

export function shortRights(t: Parameters<typeof translateKey>[0], rights: readonly TokenRight[]): string {
  if (rights.length === 0) return t("tokens.noRights");
  const shown = rights
    .slice(0, 2)
    .map((right) => t("tokens.right", { area: right.area, level: right.level }));
  const rest = rights.length - shown.length;
  return [...shown, ...(rest > 0 ? [t("tokens.moreRights", { count: rest })] : [])].join(" · ");
}

export function TokenTable({
  tokens,
  loading,
  caption,
  knowledgeBaseNames,
  owner,
  canManage,
  onChangeContent,
  onRevoke,
}: {
  tokens: readonly ApiToken[];
  loading: boolean;
  caption: string;
  knowledgeBaseNames: ReadonlyMap<string, string>;
  owner?: (token: ApiToken) => string;
  canManage: boolean;
  onChangeContent?: (token: ApiToken) => void;
  onRevoke: (token: ApiToken) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [search, setSearch] = useState("");
  const [details, setDetails] = useState<ApiToken | null>(null);
  const needle = search.trim().toLowerCase();
  const filtered = tokens.filter(
    (token) =>
      !needle ||
      token.name.toLowerCase().includes(needle) ||
      (owner?.(token) ?? "").toLowerCase().includes(needle),
  );
  const sorted = useSorted(filtered, { key: "name", direction: "asc" }, (token, key) =>
    key === "expires"
      ? (token.expiresAt ?? "9999")
      : key === "used"
        ? (token.lastUsedAt ?? "")
        : key === "owner"
          ? (owner?.(token) ?? "").toLowerCase()
          : token.name.toLowerCase(),
  );
  const paged = usePaged(sorted.rows);
  const rights = (token: ApiToken) => tokenRights(t, token, knowledgeBaseNames);

  const menu = (token: ApiToken): MenuItem[] => [
    { label: t("tokens.showRights"), icon: Info, onSelect: () => setDetails(token) },
    ...(canManage && onChangeContent && token.scopes.organization?.spaces
      ? [{ label: t("tokens.changeRights"), icon: PencilLine, onSelect: () => onChangeContent(token) }]
      : []),
    ...(canManage
      ? [
          { type: "separator" as const },
          { label: t("tokens.revoke"), icon: Trash2, danger: true, onSelect: () => onRevoke(token) },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      {tokens.length > 0 ? (
        <TableToolbar
          search={{
            value: search,
            onChange: (value) => {
              setSearch(value);
              paged.reset();
            },
            label: t("tokens.search"),
            placeholder: t("tokens.search"),
          }}
          pagination={paged.pagination}
        />
      ) : null}
      <Table
        caption={caption}
        rowKey={(token) => token.id}
        rows={paged.rows}
        loading={loading}
        sort={sorted.sort}
        onSortChange={sorted.setSort}
        pagination={paged.pagination}
        onRowClick={(token) => setDetails(token)}
        rowLabel={(token) => t("tokens.showRightsFor", { name: token.name })}
        empty={<p className="text-text-muted">{needle ? t("tokens.noMatch") : t("tokens.none")}</p>}
        columns={[
          {
            key: "name",
            header: t("tokens.name"),
            sortable: true,
            grow: true,
            cell: (token) => (
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <KeyRound aria-hidden="true" className="size-icon-sm shrink-0 text-text-muted" />
                  <TruncatedText text={token.name} />
                </span>
                <TruncatedText text={shortRights(t, rights(token))} className="text-xs text-text-muted" />
              </div>
            ),
          },
          ...(owner
            ? [
                {
                  key: "owner",
                  header: t("tokens.owner"),
                  sortable: true,
                  hideBelow: "sm" as const,
                  cell: (token: ApiToken) => <TruncatedText text={owner(token)} className="max-w-field" />,
                },
              ]
            : []),
          {
            key: "expires",
            header: t("tokens.expires"),
            sortable: true,
            hideBelow: "md",
            cell: (token) => (
              <span className="whitespace-nowrap">
                {token.expiresAt ? format.date(token.expiresAt) : t("tokens.noExpiry")}
              </span>
            ),
          },
          {
            key: "used",
            header: t("tokens.lastUsedColumn"),
            sortable: true,
            hideBelow: "md",
            cell: (token) => (
              <span className="whitespace-nowrap text-text-muted">
                {token.lastUsedAt ? format.relative(token.lastUsedAt) : t("tokens.neverUsed")}
              </span>
            ),
          },
          {
            key: "actions",
            sticky: true,
            header: <span className="sr-only">{t("settings.actions")}</span>,
            align: "end",
            cell: (token) => (
              <Menu
                align="end"
                trigger={
                  <IconButton label={t("tokens.actionsFor", { name: token.name })} icon={MoreHorizontal} />
                }
                items={menu(token)}
              />
            ),
          },
        ]}
      />
      <Dialog
        open={details !== null}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
        title={details?.name ?? ""}
        size="md"
      >
        {details ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {rights(details).map((right) => (
                <div key={right.area} className="contents">
                  <dt className="text-text-muted">{right.area}</dt>
                  <dd>{right.level}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-text-muted">
              {[
                details.expiresAt
                  ? t("tokens.expiresOn", { date: format.date(details.expiresAt) })
                  : t("tokens.noExpiry"),
                details.lastUsedAt
                  ? t("tokens.lastUsed", { when: format.relative(details.lastUsedAt) })
                  : t("tokens.neverUsed"),
              ].join(" · ")}
            </p>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
