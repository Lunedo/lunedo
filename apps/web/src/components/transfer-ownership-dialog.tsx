import { Button, Combobox, type ComboboxItem, Dialog, Field, Notice } from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { instanceKeys } from "../api/instance-queries.js";
import { request } from "../api/request.js";
import { problemMessage } from "../errors/problem-message.js";
import { AccessImpact } from "./access-impact.js";
import { accountLoader } from "./pickers.js";

export function TransferOwnershipDialog({
  ownerId,
  candidate,
  onClose,
}: {
  ownerId: string;
  candidate?: ComboboxItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<ComboboxItem | null>(candidate ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loader = useMemo(() => accountLoader({ exclude: [ownerId] }), [ownerId]);

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await request(() => api.POST("/api/v1/instance/ownership", { body: { accountId: target.value } }));
      await queryClient.invalidateQueries({ queryKey: instanceKeys.assignments });
      await queryClient.invalidateQueries({ queryKey: instanceKeys.accounts });
      await queryClient.invalidateQueries({ queryKey: ["account", "permissions"] });
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
      title={t("roles.transferOwnership")}
      description={t("instance.accounts.transferDescription")}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <Notice variant="danger" title={t("failures.changeAccount")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("instance.accounts.newOwner")}>
          <Combobox
            aria-label={t("instance.accounts.newOwner")}
            placeholder={t("roles.choosePeople")}
            value={target?.value ?? null}
            selectedItem={target}
            load={loader}
            onValueChange={(_value, item) => setTarget(item)}
          />
        </Field>
        {target ? (
          <AccessImpact change="gains" people={[target.label]} what={t("instance.accounts.transferImpact")} />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={!target} onClick={() => void submit()}>
            {t("instance.accounts.transferOwnership")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
