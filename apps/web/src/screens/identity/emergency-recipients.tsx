import { Combobox, type ComboboxItem, Field, SettingRow, Skeleton, Switch } from "@lunedo/ui";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import type { paths } from "../../api/generated/schema.js";
import { request } from "../../api/request.js";
import { AutoSaveTextField, SaveIndicator, useSaveStates } from "../../components/auto-save.js";
import { accountLoader } from "../../components/pickers.js";
import { LoadError } from "../../errors/failure.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { parseList } from "./provider-config.js";

type Recipients =
  paths["/api/v1/instance/emergency-sign-in-recipients"]["get"]["responses"]["200"]["content"]["application/json"];

const recipientsQuery = queryOptions({
  queryKey: ["instance", "emergencySignInRecipients"] as const,
  queryFn: () => request(() => api.GET("/api/v1/instance/emergency-sign-in-recipients")),
});

const addressList = z.string().refine((value) => {
  const addresses = parseList(value);
  return addresses.length <= 20 && addresses.every((address) => z.email().safeParse(address).success);
});

export function EmergencyRecipients() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const state = useOrganizationState();
  const canManage = state.can("instance.emergencyRecipients.manage");
  const recipients = useQuery({ ...recipientsQuery, throwOnError: false });
  const tracker = useSaveStates();
  const loader = useMemo(() => accountLoader(), []);
  if (recipients.isPending) return <Skeleton className="h-24 w-full" />;
  if (recipients.isError) {
    return (
      <LoadError
        what={t("failures.loadEmergencyRecipients")}
        error={recipients.error}
        onRetry={() => recipients.refetch()}
      />
    );
  }
  const current = recipients.data;
  const save = async (
    change: Partial<{ instanceAdministrators: boolean; accountIds: string[]; addresses: string[] }>,
  ) => {
    const saved = await request(() =>
      api.PUT("/api/v1/instance/emergency-sign-in-recipients", {
        body: {
          instanceAdministrators: current.instanceAdministrators,
          accountIds: current.accounts.map((account) => account.id),
          addresses: current.addresses,
          ...change,
        },
      }),
    );
    queryClient.setQueryData<Recipients>(recipientsQuery.queryKey, saved);
  };
  const reason = canManage ? undefined : t("emergencyRecipients.ownerOnly");
  const selected: ComboboxItem[] = current.accounts.map((account) => ({
    value: account.id,
    label: account.name,
    description: account.email ?? "",
  }));
  return (
    <>
      <p className="pt-3 text-sm text-text-muted">
        {canManage ? t("emergencyRecipients.description") : t("emergencyRecipients.ownerOnly")}
      </p>
      <SettingRow
        label={t("emergencyRecipients.administrators")}
        description={t("emergencyRecipients.administratorsHint")}
        help={t("emergencyRecipients.administratorsHelp")}
        control={
          <Switch
            label={t("emergencyRecipients.administrators")}
            labelHidden
            checked={current.instanceAdministrators}
            disabled={!canManage}
            {...(reason ? { disabledReason: reason } : {})}
            onCheckedChange={(instanceAdministrators) =>
              void tracker("administrators").run(() => save({ instanceAdministrators }))
            }
          />
        }
        status={<SaveIndicator tracker={tracker("administrators")} />}
      />
      <div className="flex flex-col gap-1 py-3">
        <Field
          label={t("emergencyRecipients.accounts")}
          hint={t("emergencyRecipients.accountsHint")}
          help={t("emergencyRecipients.accountsHelp")}
        >
          <Combobox
            multiple
            aria-label={t("emergencyRecipients.accounts")}
            placeholder={t("emergencyRecipients.choosePeople")}
            value={selected.map((item) => item.value)}
            selectedItems={selected}
            load={loader}
            disabled={!canManage}
            onValueChange={(values) => void tracker("accounts").run(() => save({ accountIds: values }))}
          />
        </Field>
        <SaveIndicator tracker={tracker("accounts")} />
      </div>
      <div className="py-3">
        <AutoSaveTextField
          label={t("emergencyRecipients.addresses")}
          hint={t("emergencyRecipients.addressesHint")}
          help={t("emergencyRecipients.addressesHelp")}
          multiline
          value={current.addresses.join("\n")}
          schema={addressList}
          invalidMessage={t("emergencyRecipients.addressesInvalid")}
          disabled={!canManage}
          onSave={(value) => save({ addresses: parseList(value) })}
        />
      </div>
    </>
  );
}
