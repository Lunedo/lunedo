import { Button, Field, Input, Notice, RadioGroup, Switch, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { AutoSaveTextField, SaveIndicator, useSaveState } from "../../components/auto-save.js";
import { problemMessage } from "../../errors/problem-message.js";
import { isKnowledgeBase } from "../../knowledge-bases/queries.js";
import { ImpactConfirmDialog } from "../access/impact.js";
import { useSpace } from "../space-context.js";
import { type SpaceVisibility, spaceKeys } from "../space-queries.js";
import { Panel } from "./panel.js";
import { SpaceSettingsPage } from "./space-settings-page.js";

const VISIBILITIES: SpaceVisibility[] = ["private", "organization", "instance"];

export function SpaceGeneralScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: spaceKeys.all });
  const editable = space.role === "admin";

  const update = async (changes: { name?: string; description?: string }) => {
    await request(() =>
      api.PATCH("/api/v1/spaces/{spaceId}", { params: { path: { spaceId: space.id } }, body: changes }),
    );
    await refresh();
  };

  return (
    <SpaceSettingsPage
      title={t("spaces.settings.general")}
      description={t("spaces.settings.generalDescription")}
    >
      <div className="flex flex-col gap-8">
        <Panel title={t("spaces.settings.about")}>
          <div className="flex flex-col gap-4">
            <AutoSaveTextField
              label={t("spaces.settings.name")}
              {...(space.personal ? { hint: t("spaces.settings.personalNameHint") } : {})}
              value={space.name}
              disabled={!editable}
              schema={space.personal ? z.string().max(100) : z.string().min(1).max(100)}
              onSave={(name) => update({ name })}
            />
            <AutoSaveTextField
              label={t("spaces.settings.description")}
              hint={t("spaces.create.descriptionHint")}
              value={space.description}
              multiline
              disabled={!editable}
              schema={z.string().max(1000)}
              onSave={(description) => update({ description })}
            />
          </div>
        </Panel>
        {space.confidential ? (
          <Panel title={t("confidential.settingsTitle")} description={t("confidential.explanation")}>
            <Notice variant="info" title={t("confidential.limitTitle")}>
              {t("confidential.limit")}
            </Notice>
          </Panel>
        ) : null}
        <KeySection />
        {isKnowledgeBase(space) ? (
          <Panel
            title={t("knowledgeBase.settings.typeTitle")}
            description={t("knowledgeBase.settings.typeDescription")}
          >
            <p className="text-sm">
              <Link
                to="/spaces/$spaceKey/settings/visibility"
                params={{ spaceKey: space.key }}
                className="font-medium text-accent underline focus-visible:focus-ring"
              >
                {t("knowledgeBase.settings.toVisibility")}
              </Link>
            </p>
          </Panel>
        ) : space.confidential ? null : (
          <VisibilitySection />
        )}
      </div>
    </SpaceSettingsPage>
  );
}

function KeySection() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(space.key);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = draft !== space.key;

  const save = async () => {
    const key = draft.trim().toUpperCase();
    setError(null);
    if (!/^[A-Z0-9]{2,10}$/.test(key)) {
      setError(t("spaces.create.keyInvalid"));
      return;
    }
    setSaving(true);
    try {
      const check = await request(() =>
        api.GET("/api/v1/spaces/{spaceId}/keys/{key}", { params: { path: { spaceId: space.id, key } } }),
      );
      if (!check.available) {
        setError(t("spaces.create.keyTaken", { key }));
        return;
      }
      const updated = await request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/key", { params: { path: { spaceId: space.id } }, body: { key } }),
      );
      await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
      toast({ title: t("spaces.settings.keyChanged", { key: updated.key }), variant: "success" });
      await navigate({
        to: "/spaces/$spaceKey/settings/general",
        params: { spaceKey: updated.key },
        replace: true,
      });
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title={t("spaces.settings.key")} description={t("spaces.settings.keyDescription")}>
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field
          label={t("spaces.settings.key")}
          hint={t("spaces.create.keyHint")}
          {...(error ? { error } : {})}
        >
          <Input
            value={draft}
            maxLength={10}
            disabled={space.role !== "admin"}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          />
        </Field>
        {changed ? (
          <>
            <Notice variant="info" title={t("spaces.settings.keyRedirectTitle")}>
              {t("spaces.settings.keyRedirect", { old: space.key })}
            </Notice>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={saving}>
                {t("spaces.settings.saveKey")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft(space.key);
                  setError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </>
        ) : null}
      </form>
    </Panel>
  );
}

function DiscoverableSwitch() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const queryClient = useQueryClient();
  const tracker = useSaveState();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const checked = optimistic ?? space.discoverable;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          checked={checked}
          label={t("spaces.settings.discoverable")}
          disabled={space.role !== "admin" || space.visibility !== "private"}
          {...(space.visibility !== "private"
            ? { disabledReason: t("spaces.settings.discoverableNotPrivate") }
            : {})}
          onCheckedChange={(next) => {
            setOptimistic(next);
            void tracker
              .run(async () => {
                await request(() =>
                  api.PATCH("/api/v1/spaces/{spaceId}", {
                    params: { path: { spaceId: space.id } },
                    body: { discoverable: next },
                  }),
                );
                await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
              })
              .then((saved) => {
                if (!saved) setOptimistic(null);
              });
          }}
        />
        <SaveIndicator tracker={tracker} />
      </div>
      <p className="text-sm text-text-muted">{t("spaces.settings.discoverableHint")}</p>
    </div>
  );
}

function VisibilitySection() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<SpaceVisibility | null>(null);
  const impact = useQuery({
    queryKey: ["spaces", space.id, "visibilityImpact", pending],
    enabled: pending !== null,
    queryFn: () =>
      request(() =>
        api.POST("/api/v1/spaces/{spaceId}/visibility/preview", {
          params: { path: { spaceId: space.id } },
          body: { visibility: pending ?? "private" },
        }),
      ),
  });
  if (space.personal) {
    return (
      <Panel title={t("spaces.settings.visibility")}>
        <Notice variant="info" title={t("spaces.visibility.private.label")}>
          {t("spaces.settings.personalPrivate")}
        </Notice>
      </Panel>
    );
  }
  return (
    <Panel title={t("spaces.settings.visibility")} description={t("spaces.settings.visibilityDescription")}>
      <RadioGroup
        label={t("spaces.settings.visibility")}
        variant="card"
        value={space.visibility}
        onValueChange={(value) => {
          if (space.role === "admin" && value !== space.visibility) setPending(value as SpaceVisibility);
        }}
        options={VISIBILITIES.map((value) => ({
          value,
          label: t(`spaces.visibility.${value}.label`),
          description: t(`spaces.visibility.${value}.description`, {
            organization: space.organizationName ?? "",
          }),
        }))}
      />
      <DiscoverableSwitch />
      <ImpactConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("spaces.settings.visibilityConfirmTitle")}
        description={
          pending
            ? t("spaces.settings.visibilityConfirm", {
                from: t(`spaces.visibility.${space.visibility}.label`),
                to: t(`spaces.visibility.${pending}.label`),
              })
            : undefined
        }
        confirmLabel={t("spaces.settings.changeVisibility")}
        impact={impact}
        onConfirm={async () => {
          if (!pending) return;
          try {
            await request(() =>
              api.PUT("/api/v1/spaces/{spaceId}/visibility", {
                params: { path: { spaceId: space.id } },
                body: { visibility: pending },
              }),
            );
            await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
            toast({ title: t("spaces.settings.visibilityChanged"), variant: "success" });
            setPending(null);
          } catch (failure) {
            toast({
              title: t("spaces.settings.visibilityFailed"),
              description: problemMessage(t, failure),
              variant: "error",
            });
          }
        }}
      />
    </Panel>
  );
}
