import {
  Button,
  Combobox,
  Dialog,
  EmptyState,
  Field,
  focusFirstInvalidSoon,
  Notice,
  Skeleton,
  Table,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserRound, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { instanceSettingsQuery } from "../../api/instance-queries.js";
import { request } from "../../api/request.js";
import { SettingsList } from "../../components/settings-list.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { SettingsPage } from "../../screens/settings/settings-page.js";
import { useInstanceSettingMutation } from "../../settings/setting-mutations.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { spaceKeys } from "../space-queries.js";
import { Panel } from "./panel.js";

interface ReviewEntry {
  spaceId: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerState: string | null;
  pages: number;
  lastChangedAt: string;
}

export function InstancePersonalSpacesScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const state = useOrganizationState();
  const settings = useQuery(instanceSettingsQuery);
  const mutation = useInstanceSettingMutation();
  const review = useQuery({
    queryKey: spaceKeys.personalReview,
    queryFn: () =>
      request(() => api.GET("/api/v1/instance/personal-spaces", { params: { query: { limit: 200 } } })),
  });
  const [transferring, setTransferring] = useState<ReviewEntry | null>(null);
  const canManage = state.can("instance.personalSpaces.manage");
  return (
    <SettingsPage
      width="wide"
      title={t("spaces.instance.title")}
      description={t("spaces.instance.description")}
      icon={UserRound}
    >
      <Panel title={t("spaces.instance.availability")}>
        <SettingsList
          settings={settings.data}
          keys={["spaces.personalSpaces"]}
          level="instance"
          canManage={() => state.can("instance.settings.manage")}
          onChange={async (key, change) => {
            await mutation.mutateAsync({ key, change });
          }}
        />
      </Panel>
      <Panel title={t("spaces.instance.review")} description={t("spaces.instance.reviewDescription")}>
        {review.isError ? (
          <LoadError
            what={t("spaces.instance.reviewFailed")}
            error={review.error}
            onRetry={() => review.refetch()}
          />
        ) : null}
        {review.isPending ? <Skeleton className="h-12 w-full" /> : null}
        {review.data && review.data.items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("spaces.instance.none")}
            description={t("spaces.instance.noneDescription")}
          />
        ) : null}
        {review.data && review.data.items.length > 0 ? (
          <Table
            caption={t("spaces.instance.review")}
            rowKey={(entry) => entry.spaceId}
            rows={review.data.items}
            columns={[
              {
                key: "owner",
                header: t("spaces.instance.owner"),
                cell: (entry) => (
                  <span className="font-medium">{entry.ownerName ?? t("spaces.instance.formerOwner")}</span>
                ),
              },
              {
                key: "state",
                header: t("spaces.instance.ownerState"),
                hideBelow: "sm",
                cell: (entry) =>
                  t(
                    `spaces.instance.states.${entry.ownerState === "anonymized" ? "anonymized" : "deactivated"}`,
                  ),
              },
              {
                key: "pages",
                header: t("spaces.instance.pages"),
                align: "end",
                cell: (entry) => format.number(entry.pages),
              },
              {
                key: "changed",
                header: t("spaces.instance.lastChange"),
                hideBelow: "md",
                cell: (entry) => format.dateTime(entry.lastChangedAt),
              },
              {
                key: "actions",
                header: t("spaces.instance.actions"),
                cell: (entry) =>
                  canManage ? (
                    <Button variant="secondary" size="sm" onClick={() => setTransferring(entry)}>
                      {t("spaces.instance.transfer")}
                    </Button>
                  ) : null,
              },
            ]}
          />
        ) : null}
      </Panel>
      <TransferDialog entry={transferring} onOpenChange={(open) => !open && setTransferring(null)} />
    </SettingsPage>
  );
}

function TransferDialog({
  entry,
  onOpenChange,
}: {
  entry: ReviewEntry | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [account, setAccount] = useState<{ value: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const owner = entry?.ownerName ?? t("spaces.instance.formerOwner");
  const submit = async () => {
    if (!entry) return;
    if (!account) {
      setError(t("spaces.instance.chooseAccount"));
      focusFirstInvalidSoon();
      return;
    }
    setError(null);
    setFailure(null);
    setSaving(true);
    try {
      await request(() =>
        api.POST("/api/v1/instance/personal-spaces/{spaceId}/transfer", {
          params: { path: { spaceId: entry.spaceId } },
          body: { accountId: account.value },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: spaceKeys.personalReview });
      toast({
        title: t("spaces.instance.transferred", { owner, account: account.label }),
        variant: "success",
      });
      setAccount(null);
      onOpenChange(false);
    } catch (problem) {
      setFailure(problemMessage(t, problem));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={entry !== null}
      onOpenChange={onOpenChange}
      title={t("spaces.instance.transferTitle", { owner })}
      size="sm"
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {failure ? (
          <Notice variant="danger" title={t("spaces.instance.transferFailed")}>
            {failure}
          </Notice>
        ) : null}
        <Field
          label={t("spaces.instance.newOwner")}
          hint={t("spaces.instance.newOwnerHint")}
          {...(error ? { error } : {})}
        >
          <Combobox
            aria-label={t("spaces.instance.newOwner")}
            value={account?.value ?? null}
            selectedItem={account}
            emptyText={t("spaces.holders.noMatch")}
            load={async (query) => {
              const found = await request(() =>
                api.GET("/api/v1/instance/accounts", {
                  params: { query: { limit: 20, ...(query ? { q: query } : {}) } },
                }),
              );
              return {
                items: found.items
                  .filter((candidate) => candidate.type === "standard" && candidate.state === "active")
                  .map((candidate) => ({
                    value: candidate.id,
                    label: candidate.name,
                    ...(candidate.email ? { description: candidate.email } : {}),
                  })),
              };
            }}
            onValueChange={(value, item) => setAccount(value && item ? { value, label: item.label } : null)}
          />
        </Field>
        <Notice variant="warning" title={t("spaces.instance.transferEffectTitle")}>
          {t("spaces.instance.transferEffect", { owner })}
        </Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {t("spaces.instance.transferSubmit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
