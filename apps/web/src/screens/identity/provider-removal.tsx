import { Button, ConfirmDialog, Dialog, Notice, Skeleton } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type IdentityProvider, removalPreviewQuery, removeProvider } from "../../api/identity-queries.js";
import { isApiError } from "../../api/request.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";

export function useRemovalPreviewLoader() {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState<string | null>(null);
  const load = async (providerId: string) => {
    setLoading(providerId);
    try {
      await queryClient.prefetchQuery(removalPreviewQuery(providerId));
    } finally {
      setLoading(null);
    }
  };
  return { loading, load };
}

function RemovalPreview({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const preview = useQuery({ ...removalPreviewQuery(providerId), throwOnError: false });
  if (preview.isPending) return <Skeleton className="h-12 w-full" />;
  if (preview.isError) {
    return (
      <LoadError
        what={t("failures.loadRemovalPreview")}
        error={preview.error}
        onRetry={() => preview.refetch()}
      />
    );
  }
  const { groups, rules, grants } = preview.data;
  return (
    <ul
      aria-label={t("identityProviders.removal.consequences")}
      className="flex list-disc flex-col gap-1 pl-5"
    >
      <li>{t("identityProviders.removal.grants", { count: grants })}</li>
      <li>{t("identityProviders.removal.rules", { count: rules })}</li>
      <li>{t("identityProviders.removal.groups", { count: groups })}</li>
    </ul>
  );
}

export function RemoveProviderDialog({
  provider,
  open,
  onOpenChange,
  onRemoved,
  onDeactivate,
}: {
  provider: Pick<IdentityProvider, "id" | "name" | "deactivatedAt">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => Promise<void>;
  onDeactivate?: () => void;
}) {
  const { t } = useTranslation();
  const showFailure = useFailureToast();
  const preview = useQuery({ ...removalPreviewQuery(provider.id), enabled: open, throwOnError: false });
  const linked = preview.data?.accounts ?? 0;
  if (linked > 0) {
    const deactivate = onDeactivate && provider.deactivatedAt === null ? onDeactivate : null;
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t("identityProviders.removal.refusedTitle", { name: provider.name })}
        size="sm"
        footer={
          <>
            <Button variant={deactivate ? "secondary" : "primary"} onClick={() => onOpenChange(false)}>
              {t("ui.close")}
            </Button>
            {deactivate ? (
              <Button
                variant="primary"
                onClick={() => {
                  onOpenChange(false);
                  deactivate();
                }}
              >
                {t("identityProviders.status.deactivate")}
              </Button>
            ) : null}
          </>
        }
      >
        <Notice variant="warning">{t("problems.providerHasAccountsCount", { count: linked })}</Notice>
        <p className="text-sm text-text-muted">
          {t("identityProviders.removal.refusedHint", { name: provider.name })}
        </p>
      </Dialog>
    );
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("identityProviders.removeTitle", { name: provider.name })}
      description={t("identityProviders.removeConfirm")}
      confirmLabel={t("identityProviders.remove")}
      cancelLabel={t("common.cancel")}
      destructive
      typedConfirmation={{
        value: provider.name,
        label: t("common.typeToConfirm", { name: provider.name }),
        mismatch: t("common.nameMismatch"),
      }}
      onConfirm={async () => {
        try {
          await removeProvider(provider.id);
          onOpenChange(false);
          await onRemoved();
        } catch (failure) {
          if (isApiError(failure, "providerHasAccounts")) await preview.refetch();
          else showFailure(t("failures.removeProvider"), failure);
        }
      }}
    >
      {open ? <RemovalPreview providerId={provider.id} /> : null}
    </ConfirmDialog>
  );
}
