import { Dialog, type MenuItem } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { Flag, Tag, UserRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArticleTypeControl } from "../knowledge-bases/article-type-control.js";
import { ArticlePortalLink } from "../knowledge-bases/portal-link.js";
import { isKnowledgeBase } from "../knowledge-bases/queries.js";
import { TranslationsControl } from "../knowledge-bases/translations-control.js";
import { OwnerChip, TransferOwnerDialog } from "./ownership/owner-line.js";
import { pageStatusesQuery, statusName } from "./ownership/ownership-queries.js";
import { StatusBadge, StatusChoices } from "./ownership/page-status.js";
import { AddLabelDialog, LabelChips } from "./page-labels.js";
import { useSpace } from "./space-context.js";
import type { ItemDetails } from "./space-queries.js";

function Separator() {
  return (
    <span aria-hidden="true" className="text-text-muted">
      ·
    </span>
  );
}

export function usePageMeta({ page, writable }: { page: ItemDetails; writable: boolean }): {
  line: ReactNode;
  menuItems: MenuItem[];
  dialogs: ReactNode;
} {
  const { t } = useTranslation();
  const { space } = useSpace();
  const knowledgeBase = isKnowledgeBase(space);
  const statuses = useQuery({ ...pageStatusesQuery(space.id), enabled: writable, throwOnError: false });
  const statusEditable = writable && statuses.data?.enabled === true;
  const [choosingStatus, setChoosingStatus] = useState(false);
  const [addingLabel, setAddingLabel] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const menuItems: MenuItem[] = [
    ...(writable ? [{ label: t("labels.add"), icon: Tag, onSelect: () => setAddingLabel(true) }] : []),
    ...(statusEditable
      ? [{ label: t("pageStatus.change"), icon: Flag, onSelect: () => setChoosingStatus(true) }]
      : []),
    ...(page.ownershipTransferable
      ? [
          {
            label: page.owner ? t("ownership.transfer") : t("ownership.assign"),
            icon: UserRound,
            onSelect: () => setTransferring(true),
          },
        ]
      : []),
  ];

  const line = (
    <div
      data-page-meta=""
      className="group/meta flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted"
    >
      {page.status ? (
        <>
          {statusEditable ? (
            <button
              type="button"
              onClick={() => setChoosingStatus(true)}
              className="inline-flex rounded-sm focus-visible:focus-ring"
              aria-label={t("pageStatus.changeFrom", { status: statusName(t, page.status) })}
            >
              <StatusBadge status={page.status} />
            </button>
          ) : (
            <StatusBadge status={page.status} />
          )}
          <Separator />
        </>
      ) : null}
      <OwnerChip owner={page.owner} />
      {knowledgeBase ? (
        <>
          <Separator />
          <ArticleTypeControl
            itemId={page.id}
            spaceId={space.id}
            type={page.articleType}
            editable={writable}
          />
          <TranslationsControl itemId={page.id} spaceId={space.id} spaceKey={space.key} editable={writable} />
          <ArticlePortalLink itemId={page.id} />
        </>
      ) : null}
      <LabelChips pageId={page.id} editable={writable} onAdd={() => setAddingLabel(true)} />
    </div>
  );

  const dialogs = (
    <>
      {addingLabel ? <AddLabelDialog pageId={page.id} open onOpenChange={setAddingLabel} /> : null}
      {choosingStatus ? (
        <Dialog open onOpenChange={setChoosingStatus} title={t("pageStatus.change")} size="sm">
          <StatusChoices
            itemId={page.id}
            spaceId={space.id}
            status={page.status}
            onDone={() => setChoosingStatus(false)}
            heading={false}
          />
        </Dialog>
      ) : null}
      {transferring ? (
        <TransferOwnerDialog
          item={{ id: page.id, spaceId: space.id, title: page.title }}
          currentOwner={page.owner}
          onClose={() => setTransferring(false)}
        />
      ) : null}
    </>
  );

  return { line, menuItems, dialogs };
}
