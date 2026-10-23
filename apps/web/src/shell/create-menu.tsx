import { Button, Combobox, type ComboboxLoader, Dialog, Field, Menu, type MenuItem } from "@lunedo/ui";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarDays,
  FileText,
  Folder,
  Layers,
  Link2,
  Newspaper,
  Plus,
  Presentation,
  UserRound,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { translateKey } from "../i18n/translate.js";
import { OneOnOneDialog } from "../meetings/one-on-one-dialog.js";
import { CreateSpaceDialog } from "../spaces/create-space-dialog.js";
import { type CreateKind, useShell } from "./shell.js";
import { useCan } from "./shell-context.js";

const CONTENT_KINDS = [
  "page",
  "blogPost",
  "whiteboard",
  "folder",
  "link",
] as const satisfies readonly CreateKind[];
const KNOWLEDGE_BASE_KINDS: readonly CreateKind[] = ["page", "folder"];

const ICONS = {
  page: FileText,
  blogPost: Newspaper,
  whiteboard: Presentation,
  folder: Folder,
  link: Link2,
  meeting: CalendarDays,
} as const satisfies Record<CreateKind, typeof FileText>;

export function createKindLabelKey(kind: CreateKind, knowledgeBase: boolean): string {
  if (knowledgeBase && kind === "page") return "create.article";
  if (knowledgeBase && kind === "folder") return "create.category";
  return `create.${kind}`;
}

function spaceLoader(kind: CreateKind): ComboboxLoader {
  return async (search, cursor) => {
    const page = await request(() =>
      api.GET("/api/v1/spaces", {
        params: {
          query: {
            limit: 30,
            role: "editor",
            archived: "false",
            ...(KNOWLEDGE_BASE_KINDS.includes(kind) ? {} : { type: "standard" as const }),
            ...(search.trim() ? { q: search.trim() } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    );
    return {
      items: page.items.map((space) => ({
        value: space.key,
        label: space.name || space.ownerName || space.key,
        description: space.key,
      })),
      nextCursor: page.nextCursor,
    };
  };
}

function ChooseSpaceDialog({ kind, onClose }: { kind: CreateKind | null; onClose: () => void }) {
  const { t } = useTranslation();
  const shell = useShell();
  const navigate = useNavigate();
  const [spaceKey, setSpaceKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const close = () => {
    setSpaceKey(null);
    setError(null);
    onClose();
  };
  const confirm = () => {
    if (!kind) return;
    if (!spaceKey) {
      setError(t("create.chooseSpace.required"));
      field.current?.querySelector<HTMLElement>("input, button")?.focus();
      return;
    }
    shell.requestCreate(spaceKey, kind);
    close();
    void navigate({ to: "/spaces/$spaceKey", params: { spaceKey } });
  };
  return (
    <Dialog
      open={kind !== null}
      onOpenChange={(open) => !open && close()}
      title={t("create.chooseSpace.title", { kind: kind ? t(`create.${kind}`) : "" })}
      description={t("create.chooseSpace.description")}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t("create.chooseSpace.cancel")}
          </Button>
          <Button variant="primary" onClick={confirm}>
            {t("create.chooseSpace.continue")}
          </Button>
        </>
      }
    >
      <div ref={field}>
        <Field label={t("create.chooseSpace.label")} required {...(error ? { error } : {})}>
          {kind ? (
            <Combobox
              value={spaceKey}
              onValueChange={(value) => {
                setSpaceKey(value);
                setError(null);
              }}
              load={spaceLoader(kind)}
              placeholder={t("create.chooseSpace.placeholder")}
              emptyText={t("create.chooseSpace.empty")}
              invalid={error !== null}
            />
          ) : null}
        </Field>
      </div>
    </Dialog>
  );
}

export function CreateMenu() {
  const { t } = useTranslation();
  const shell = useShell();
  const canCreateSpace = useCan("organization.spaces.create");
  const [choosing, setChoosing] = useState<CreateKind | null>(null);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [creatingOneOnOne, setCreatingOneOnOne] = useState(false);
  const target = shell.spaceCreateTarget;
  const knowledgeBase = target?.knowledgeBase ?? false;
  const contentKinds = target ? CONTENT_KINDS.filter((kind) => target.kinds.includes(kind)) : CONTENT_KINDS;
  const meeting = target ? target.kinds.includes("meeting") : true;
  const select = (kind: CreateKind) => (target ? target.create(kind) : setChoosing(kind));
  const items: MenuItem[] = [];
  if (contentKinds.length > 0) {
    items.push(
      { type: "label", label: target ? t("create.inSpace", { space: target.name }) : t("create.inASpace") },
      ...contentKinds.map((kind) => ({
        label: translateKey(t, createKindLabelKey(kind, knowledgeBase)),
        icon: ICONS[kind],
        onSelect: () => select(kind),
      })),
      { type: "separator" },
    );
  }
  if (meeting)
    items.push({ label: t("create.meeting"), icon: ICONS.meeting, onSelect: () => select("meeting") });
  items.push({
    label: t("meetings.oneOnOne.new"),
    icon: UserRound,
    onSelect: () => setCreatingOneOnOne(true),
  });
  if (canCreateSpace) {
    items.push(
      { type: "separator" },
      { label: t("create.space"), icon: Layers, onSelect: () => setCreatingSpace(true) },
    );
  }
  return (
    <>
      <Menu
        align="end"
        trigger={
          <Button variant="primary" icon={Plus} aria-label={t("create.button")}>
            <span className="hidden sm:inline">{t("create.button")}</span>
          </Button>
        }
        items={items}
      />
      <ChooseSpaceDialog kind={choosing} onClose={() => setChoosing(null)} />
      <CreateSpaceDialog open={creatingSpace} onOpenChange={setCreatingSpace} />
      <OneOnOneDialog open={creatingOneOnOne} onOpenChange={setCreatingOneOnOne} />
    </>
  );
}
