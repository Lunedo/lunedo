import {
  Button,
  Combobox,
  type ComboboxItem,
  ConfirmDialog,
  Field,
  focusFirstInvalidSoon,
  Notice,
  RadioGroup,
  Skeleton,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { groupLoader } from "../../components/pickers.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { Panel } from "../../spaces/settings/panel.js";
import { SpaceSettingsPage } from "../../spaces/settings/space-settings-page.js";
import { spaceDisplayName } from "../../spaces/space-badge.js";
import { useSpace } from "../../spaces/space-context.js";
import { spaceKeys } from "../../spaces/space-queries.js";
import {
  type Audience,
  type KnowledgeBaseSettings,
  knowledgeBaseKeys,
  knowledgeBaseSettingsQuery,
} from "../queries.js";

const AUDIENCES: Audience[] = ["public", "signedIn", "groups", "portal"];

export function KnowledgeBaseVisibilityScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const settings = useQuery({ ...knowledgeBaseSettingsQuery(space.id), throwOnError: false });
  return (
    <SpaceSettingsPage
      title={t("knowledgeBase.audience.title")}
      description={t("knowledgeBase.audience.description")}
    >
      {settings.isPending ? <Skeleton className="h-field w-full" /> : null}
      {settings.isError ? (
        <LoadError
          what={t("knowledgeBase.audience.loadFailed")}
          error={settings.error}
          onRetry={() => settings.refetch()}
        />
      ) : null}
      {settings.data ? <AudienceForm key={JSON.stringify(settings.data)} settings={settings.data} /> : null}
    </SpaceSettingsPage>
  );
}

export function AudienceForm({ settings }: { settings: KnowledgeBaseSettings }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { space } = useSpace();
  const editable = space.role === "admin" && !space.archived;
  const [audience, setAudience] = useState<Audience>(settings.audience);
  const [groups, setGroups] = useState<ComboboxItem[]>(
    settings.groups.map((group) => ({ value: group.id, label: group.name })),
  );
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ articles: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const groupIds = groups.map((group) => group.value);
  const dirty =
    audience !== settings.audience ||
    (audience === "groups" && groupIds.join() !== settings.groups.map((group) => group.id).join());

  const reset = () => {
    setAudience(settings.audience);
    setGroups(settings.groups.map((group) => ({ value: group.id, label: group.name })));
    setGroupsError(null);
    setFailure(null);
  };

  const apply = async (confirmWidening: boolean) => {
    await request(() =>
      api.PUT("/api/v1/spaces/{spaceId}/knowledge-base/audience", {
        params: { path: { spaceId: space.id } },
        body: { audience, groupIds: audience === "groups" ? groupIds : [], confirmWidening },
      }),
    );
    await queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.all(space.id) });
    await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
    toast({ title: t("knowledgeBase.audience.saved"), variant: "success" });
  };

  const save = async () => {
    setFailure(null);
    if (audience === "groups" && groupIds.length === 0) {
      setGroupsError(t("knowledgeBase.audience.groupsRequired"));
      focusFirstInvalidSoon();
      return;
    }
    setGroupsError(null);
    setSaving(true);
    try {
      const impact = await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/knowledge-base/audience/preview", {
          params: { path: { spaceId: space.id } },
          body: { audience, groupIds: audience === "groups" ? groupIds : [] },
        }),
      );
      if (impact.widening) setConfirming({ articles: impact.articles });
      else await apply(false);
    } catch (error) {
      setFailure(problemMessage(t, error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel title={t("knowledgeBase.audience.label")} description={t("knowledgeBase.audience.narrowHint")}>
        {failure ? (
          <Notice variant="danger" title={t("knowledgeBase.audience.saveFailed")}>
            {failure}
          </Notice>
        ) : null}
        <RadioGroup
          label={t("knowledgeBase.audience.label")}
          variant="card"
          value={audience}
          onValueChange={(value) => {
            if (editable) setAudience(value as Audience);
          }}
          options={AUDIENCES.map((value) => ({
            value,
            label: translateKey(t, `knowledgeBase.audience.${value}.title`),
            description: translateKey(t, `knowledgeBase.audience.${value}.description`),
            ...(editable ? {} : { disabled: true }),
          }))}
        />
        {audience === "groups" ? (
          <Field
            label={t("knowledgeBase.audience.groupsField")}
            {...(groupsError ? { error: groupsError } : {})}
          >
            <Combobox
              multiple
              value={groupIds}
              selectedItems={groups}
              load={space.organizationId ? groupLoader(space.organizationId) : undefined}
              placeholder={t("knowledgeBase.audience.groupsPlaceholder")}
              invalid={groupsError !== null}
              disabled={!editable}
              onValueChange={(_value, items) => setGroups(items)}
            />
          </Field>
        ) : null}
        {audience === "public" ? (
          <Notice variant="info" title={t("knowledgeBase.audience.publicNoteTitle")}>
            {t("knowledgeBase.audience.publicNote")}
          </Notice>
        ) : null}
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              {t("knowledgeBase.audience.save")}
            </Button>
            {dirty ? (
              <>
                <Button variant="secondary" onClick={reset}>
                  {t("common.cancel")}
                </Button>
                <span className="text-sm text-text-muted">{t("knowledgeBase.audience.unsaved")}</span>
              </>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-text-muted">{t("knowledgeBase.audience.adminsOnly")}</p>
        )}
      </Panel>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t("knowledgeBase.audience.confirmTitle", { name: spaceDisplayName(t, space) })}
        description={t("knowledgeBase.audience.confirmDescription", {
          count: confirming?.articles ?? 0,
          audience: translateKey(t, `knowledgeBase.audience.${audience}.title`),
        })}
        confirmLabel={t("knowledgeBase.audience.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={async () => {
          try {
            await apply(true);
          } catch (error) {
            setFailure(problemMessage(t, error));
          }
        }}
      />
    </div>
  );
}
