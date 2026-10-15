import {
  Avatar,
  Badge,
  Button,
  Combobox,
  type ComboboxItem,
  type ComboboxLoader,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  Icon,
  Popover,
  useToast,
} from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, UserRoundCog } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { ActionFailure } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { spaceKeys } from "../space-queries.js";
import { ownershipKeys } from "./ownership-queries.js";

export interface OwnerInfo {
  id: string;
  name: string | null;
  email: string | null;
  active: boolean;
}

export function candidateLoader(itemId: string): ComboboxLoader {
  return async (search) => {
    const people = await request(() =>
      api.GET("/api/v1/items/{itemId}/owner-candidates", {
        params: { path: { itemId }, query: search.trim() ? { q: search.trim() } : {} },
      }),
    );
    return {
      items: people.map((person) => ({
        value: person.id,
        label: person.name,
        description: person.email ?? "",
      })),
      nextCursor: null,
    };
  };
}

function PersonCard({ owner }: { owner: OwnerInfo }) {
  const { t } = useTranslation();
  const name = owner.name ?? t("ownership.someone");
  return (
    <Popover
      align="start"
      label={name}
      trigger={
        <button
          type="button"
          className="max-w-full truncate rounded-sm font-medium text-accent hover:underline focus-visible:focus-ring"
          title={name}
        >
          {name}
        </button>
      }
    >
      <div className="flex min-w-field flex-col gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={name} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium" title={name}>
              {name}
            </span>
            {owner.active ? null : (
              <span className="text-sm text-text-muted">{t("ownership.inactiveOwner")}</span>
            )}
          </div>
        </div>
        {owner.email ? (
          <a
            href={`mailto:${owner.email}`}
            className="inline-flex items-center gap-2 rounded-sm text-sm text-accent hover:underline focus-visible:focus-ring"
          >
            <Icon icon={Mail} size="sm" />
            <span className="truncate" title={owner.email}>
              {owner.email}
            </span>
          </a>
        ) : null}
      </div>
    </Popover>
  );
}

export function OwnerLine({
  itemId,
  spaceId,
  title,
  owner,
  transferable,
  children,
}: {
  itemId: string;
  spaceId: string;
  title: string;
  owner: OwnerInfo | null;
  transferable: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [transferring, setTransferring] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
      {children}
      <span className="inline-flex min-w-0 items-center gap-1">
        {t("ownership.owner")}
        {owner ? <PersonCard owner={owner} /> : <span>{t("ownership.noOwner")}</span>}
      </span>
      {owner && !owner.active ? <Badge variant="warning">{t("ownership.ownerLeft")}</Badge> : null}
      {transferable ? (
        <span data-owner-action="" className="inline-flex items-center gap-2 whitespace-nowrap">
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="rounded-sm text-accent hover:underline focus-visible:focus-ring"
            onClick={() => setTransferring(true)}
          >
            {owner ? t("ownership.transfer") : t("ownership.assign")}
          </button>
        </span>
      ) : null}
      {transferring ? (
        <TransferOwnerDialog
          item={{ id: itemId, spaceId, title }}
          currentOwner={owner}
          onClose={() => setTransferring(false)}
        />
      ) : null}
    </div>
  );
}

export function TransferOwnerDialog({
  item,
  currentOwner,
  onClose,
  onDone,
}: {
  item: { id: string; spaceId: string; title: string };
  currentOwner: { name: string | null } | null;
  onClose: () => void;
  onDone?: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const loader = useMemo(() => candidateLoader(item.id), [item.id]);
  const [target, setTarget] = useState<ComboboxItem | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target) {
      setMissing(true);
      focusFirstInvalidSoon();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request(() =>
        api.PUT("/api/v1/items/{itemId}/owner", {
          params: { path: { itemId: item.id } },
          body: { ownerId: target.value },
        }),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: spaceKeys.item(item.id) }),
        queryClient.invalidateQueries({ queryKey: ownershipKeys.activity(item.id) }),
        queryClient.invalidateQueries({ queryKey: ownershipKeys.spaceUnowned(item.spaceId) }),
        queryClient.invalidateQueries({ queryKey: ["organizations"], predicate: unownedQuery }),
      ]);
      await onDone?.();
      toast({
        title: t("ownership.transferred", { title: item.title, name: target.label }),
        variant: "success",
      });
      onClose();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        currentOwner
          ? t("ownership.transferTitle", { title: item.title })
          : t("ownership.assignTitle", { title: item.title })
      }
      description={
        currentOwner
          ? t("ownership.transferDescription", { name: currentOwner.name ?? t("ownership.someone") })
          : t("ownership.assignDescription")
      }
      size="md"
    >
      <div className="flex flex-col gap-4">
        {error ? <ActionFailure title={t("ownership.transferFailed")} message={error} /> : null}
        <Field
          label={t("ownership.newOwner")}
          hint={t("ownership.newOwnerHint")}
          {...(missing && !target ? { error: t("ownership.chooseOwner") } : {})}
        >
          <Combobox
            placeholder={t("ownership.searchPeople")}
            emptyText={t("ownership.noCandidates")}
            value={target?.value ?? null}
            selectedItem={target}
            load={loader}
            onValueChange={(_value, chosen) => setTarget(chosen)}
          />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={UserRoundCog} loading={busy} onClick={() => void submit()}>
            {currentOwner ? t("ownership.transferConfirm") : t("ownership.assignConfirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function unownedQuery(query: { queryKey: readonly unknown[] }): boolean {
  return query.queryKey[2] === "unowned-items";
}
