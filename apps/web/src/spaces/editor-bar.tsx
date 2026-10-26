import { Badge, type Breadcrumb, Button, IconButton, Menu, type MenuItem } from "@lunedo/ui";
import { Eye, MoreHorizontal, PanelLeft } from "lucide-react";
import { type ReactNode, type Ref, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CoEditors } from "../editor/co-editors.js";
import type { PresenceUser } from "../editor/presence.js";
import { SaveStateIndicator } from "../editor/save-indicator.js";
import type { SaveState } from "../editor/save-state.js";
import { useShell } from "../shell/shell.js";
import { Breadcrumbs } from "./page-bar.js";

export function EditorBar({
  breadcrumbs,
  draft,
  saveState,
  others,
  previewing,
  onPreview,
  onClose,
  primary,
  extra,
  menuItems,
  dangerItems,
  toolbarRef,
}: {
  breadcrumbs: Breadcrumb[];
  draft: boolean;
  saveState: SaveState;
  others: PresenceUser[];
  previewing: boolean;
  onPreview: () => void;
  onClose: () => void;
  primary: ReactNode;
  extra?: ReactNode;
  menuItems: MenuItem[];
  dangerItems: MenuItem[];
  toolbarRef: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const shell = useShell();
  const { setEditMode } = shell;
  useEffect(() => {
    setEditMode(true);
    return () => setEditMode(false);
  }, [setEditMode]);
  const items: MenuItem[] = [
    ...menuItems,
    {
      label: shell.sidebarCollapsed ? t("editor.showSidebar") : t("editor.hideSidebar"),
      icon: PanelLeft,
      onSelect: shell.toggleSidebar,
    },
    ...dangerItems,
  ];
  return (
    <div data-editor-bar="" className="sticky top-0 z-20 flex flex-col border-b border-border bg-bg">
      <div className="flex min-h-hit flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <Breadcrumbs breadcrumbs={breadcrumbs} className="min-w-0" />
          {draft ? <Badge variant="warning">{t("versions.draftBadge")}</Badge> : null}
          <SaveStateIndicator state={saveState} draft={draft} />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <CoEditors others={others} />
          <Button variant="ghost" icon={Eye} aria-pressed={previewing} onClick={onPreview}>
            {previewing ? t("editor.preview.stop") : t("editor.preview.start")}
          </Button>
          <Button variant={primary ? "outline" : "primary"} onClick={onClose}>
            {t("editor.close")}
          </Button>
          {primary}
          {extra}
          <Menu trigger={<IconButton label={t("editor.more")} icon={MoreHorizontal} />} items={items} />
        </div>
      </div>
      <div ref={toolbarRef} hidden={previewing} />
    </div>
  );
}
