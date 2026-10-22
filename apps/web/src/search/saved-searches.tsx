import { Button, Dialog, Field, focusFirstInvalidSoon, IconButton, Input, Menu, useToast } from "@lunedo/ui";
import { Link, useRouter } from "@tanstack/react-router";
import { Bookmark, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isApiError } from "../api/request.js";
import { ActionFailure } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { serverFieldErrors } from "../forms/use-schema-form.js";
import {
  filtersOf,
  type SavedSearch,
  useDeleteSavedSearch,
  useRenameSavedSearch,
  useSavedSearches,
  useSaveSearch,
} from "./search-api.js";
import { type SearchFilters, toSearchParams } from "./search-params.js";

const MAX_NAME = 100;

function NameDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initialName,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initialName: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setFailure(null);
    if (!name.trim()) {
      setError(t("search.saved.nameRequired"));
      focusFirstInvalidSoon();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(name.trim());
      onOpenChange(false);
    } catch (caught) {
      const field = serverFieldErrors(t, caught).name;
      if (field) {
        setError(field);
        focusFirstInvalidSoon();
      } else {
        setFailure(
          isApiError(caught, "tooManySavedSearches") ? t("search.saved.tooMany") : problemMessage(t, caught),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} size="sm">
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {failure ? <ActionFailure title={t("search.saved.failed")} message={failure} /> : null}
        <Field label={t("search.saved.name")} hint={t("search.saved.nameHint")} {...(error ? { error } : {})}>
          <Input
            autoFocus
            value={name}
            maxLength={MAX_NAME}
            placeholder={t("search.saved.namePlaceholder")}
            onChange={(event) => {
              setName(event.target.value);
              if (error && event.target.value.trim()) setError(null);
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SaveSearchButton({
  organizationId,
  query,
  filters,
}: {
  organizationId: string;
  query: string;
  filters: SearchFilters;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const save = useSaveSearch(organizationId);
  return (
    <>
      <Button icon={Bookmark} onClick={() => setOpen(true)}>
        {t("search.saved.save")}
      </Button>
      {open ? (
        <NameDialog
          open
          onOpenChange={setOpen}
          title={t("search.saved.saveTitle")}
          submitLabel={t("search.saved.save")}
          initialName={query.trim().slice(0, MAX_NAME)}
          onSubmit={async (name) => {
            await save.mutateAsync({ name, query, filters });
            toast({ title: t("search.saved.saved"), variant: "success" });
          }}
        />
      ) : null}
    </>
  );
}

function SavedSearchEntry({ organizationId, entry }: { organizationId: string; entry: SavedSearch }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const rename = useRenameSavedSearch(organizationId);
  const remove = useDeleteSavedSearch(organizationId);
  const restore = useSaveSearch(organizationId);
  const filters = filtersOf(entry.filters);
  const href = router.buildLocation({ to: "/search", search: toSearchParams(entry.query, filters) }).href;

  const deleteEntry = () => {
    remove.mutate(entry.id, {
      onSuccess: () =>
        toast({
          title: t("search.saved.deleted", { name: entry.name }),
          undo: {
            onUndo: () =>
              restore.mutate(
                { name: entry.name, query: entry.query, filters },
                {
                  onError: (error) =>
                    toast({
                      title: t("search.saved.restoreFailed", { name: entry.name }),
                      description: problemMessage(t, error),
                      variant: "error",
                    }),
                },
              ),
          },
        }),
      onError: (error) =>
        toast({
          title: t("search.saved.deleteFailed", { name: entry.name }),
          description: problemMessage(t, error),
          variant: "error",
          action: { label: t("ui.retry"), onSelect: deleteEntry },
        }),
    });
  };

  return (
    <li className="flex items-center gap-1">
      <Link
        to={href}
        className="flex min-h-hit min-w-0 flex-1 items-center gap-2 rounded-sm px-1 text-accent hover:underline focus-visible:focus-ring"
      >
        <Bookmark aria-hidden="true" className="size-icon shrink-0" />
        <span className="truncate" title={entry.name}>
          {entry.name}
        </span>
      </Link>
      <Menu
        trigger={
          <IconButton
            label={t("search.saved.actions", { name: entry.name })}
            icon={MoreHorizontal}
            size="sm"
          />
        }
        align="end"
        items={[
          { label: t("search.saved.rename"), icon: Pencil, onSelect: () => setRenaming(true) },
          { type: "separator" },
          { label: t("search.saved.delete"), icon: Trash2, danger: true, onSelect: deleteEntry },
        ]}
      />
      {renaming ? (
        <NameDialog
          open
          onOpenChange={setRenaming}
          title={t("search.saved.renameTitle")}
          submitLabel={t("search.saved.rename")}
          initialName={entry.name}
          onSubmit={async (name) => {
            await rename.mutateAsync({ searchId: entry.id, name });
          }}
        />
      ) : null}
    </li>
  );
}

export function SavedSearchList({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation();
  const saved = useSavedSearches(organizationId);
  return (
    <section aria-labelledby="saved-searches" className="flex flex-col gap-1">
      <h2 id="saved-searches" className="text-xs font-semibold text-text-muted uppercase">
        {t("search.savedSearches")}
      </h2>
      {saved.isError ? (
        <p className="text-sm text-text-muted">
          {t("search.saved.loadFailed")}{" "}
          <Button variant="outline" size="sm" onClick={() => void saved.refetch()}>
            {t("ui.retry")}
          </Button>
        </p>
      ) : saved.data && saved.data.length === 0 ? (
        <p className="text-sm text-text-muted">{t("search.saved.none")}</p>
      ) : (
        <ul className="flex flex-col">
          {(saved.data ?? []).map((entry) => (
            <SavedSearchEntry key={entry.id} organizationId={organizationId} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}
