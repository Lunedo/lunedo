import { type SaveState, SaveStatus, Section, Select, SettingRow, Skeleton } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { SpaceSettingsPage } from "../../spaces/settings/space-settings-page.js";
import { useSpace } from "../../spaces/space-context.js";
import { type ReviewSettings, reviewKeys, reviewSettingsQuery } from "./queries.js";

type Field = "intervalMonths" | "leadDays" | "recipients";
type Change = Partial<Pick<ReviewSettings, Field>>;

const INTERVALS = ["off", "3", "6", "12"] as const;
const LEAD_DAYS = ["0", "7", "14", "30"] as const;

function useFieldSaver(spaceId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [states, setStates] = useState<Partial<Record<Field, SaveState>>>({});
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const save = async (field: Field, change: Change) => {
    setStates((current) => ({ ...current, [field]: "saving" }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    try {
      const next = await request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/knowledge-base/reviews", {
          params: { path: { spaceId } },
          body: change,
        }),
      );
      queryClient.setQueryData(reviewKeys.settings(spaceId), next);
      await queryClient.invalidateQueries({ queryKey: reviewKeys.lists(spaceId) });
      setStates((current) => ({ ...current, [field]: "saved" }));
    } catch (failure) {
      setErrors((current) => ({ ...current, [field]: problemMessage(t, failure) }));
      setStates((current) => ({ ...current, [field]: "error" }));
    }
  };
  const status = (field: Field, retry: Change) => {
    const error = errors[field];
    return (
      <SaveStatus
        state={states[field] ?? "idle"}
        {...(error ? { error, onRetry: () => void save(field, retry) } : {})}
      />
    );
  };
  return { save, status };
}

export function ReviewSettingsScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const settings = useQuery({ ...reviewSettingsQuery(space.id), throwOnError: false });
  const editable = space.role === "admin" && !space.archived;
  const { save, status } = useFieldSaver(space.id);
  const value = settings.data;
  return (
    <SpaceSettingsPage title={t("reviews.settings.title")} description={t("reviews.settings.description")}>
      <div className="flex flex-col gap-6">
        {settings.isPending ? <Skeleton className="h-field w-full" /> : null}
        {settings.isError ? (
          <LoadError
            what={t("reviews.settings.loadFailed")}
            error={settings.error}
            onRetry={() => settings.refetch()}
          />
        ) : null}
        {value ? (
          <Section title={t("reviews.settings.section")} icon={CalendarCheck}>
            <div className="flex flex-col divide-y divide-border">
              <SettingRow
                label={t("reviews.settings.interval")}
                description={t("reviews.settings.intervalDescription")}
                control={
                  <Select
                    aria-label={t("reviews.settings.interval")}
                    className="w-full"
                    disabled={!editable}
                    value={value.intervalMonths === null ? "off" : String(value.intervalMonths)}
                    options={INTERVALS.map((option) => ({
                      value: option,
                      label:
                        option === "off"
                          ? t("reviews.interval.off")
                          : t("reviews.interval.months", { count: Number(option) }),
                    }))}
                    onValueChange={(next) => {
                      const intervalMonths = next === "off" ? null : (Number(next) as 3 | 6 | 12);
                      void save("intervalMonths", { intervalMonths });
                    }}
                  />
                }
                status={status("intervalMonths", { intervalMonths: value.intervalMonths })}
              />
              <SettingRow
                label={t("reviews.settings.lead")}
                description={t("reviews.settings.leadDescription")}
                control={
                  <Select
                    aria-label={t("reviews.settings.lead")}
                    className="w-full"
                    disabled={!editable}
                    value={String(value.leadDays)}
                    options={LEAD_DAYS.map((option) => ({
                      value: option,
                      label:
                        option === "0"
                          ? t("reviews.settings.leadNone")
                          : t("reviews.settings.leadDays", { count: Number(option) }),
                    }))}
                    onValueChange={(next) =>
                      void save("leadDays", { leadDays: Number(next) as ReviewSettings["leadDays"] })
                    }
                  />
                }
                status={status("leadDays", { leadDays: value.leadDays })}
              />
              <SettingRow
                label={t("reviews.settings.recipients")}
                description={t("reviews.settings.recipientsDescription")}
                control={
                  <Select
                    aria-label={t("reviews.settings.recipients")}
                    className="w-full"
                    disabled={!editable}
                    value={value.recipients}
                    options={[
                      { value: "owner", label: t("reviews.settings.recipientsOwner") },
                      {
                        value: "ownerAndAdministrators",
                        label: t("reviews.settings.recipientsOwnerAndAdministrators"),
                      },
                    ]}
                    onValueChange={(next) =>
                      void save("recipients", { recipients: next as ReviewSettings["recipients"] })
                    }
                  />
                }
                status={status("recipients", { recipients: value.recipients })}
              />
              <SettingRow
                label={t("reviews.settings.sources")}
                description={t("reviews.settings.sourcesDescription")}
                control={
                  <span className="text-sm text-text-muted">{t("reviews.settings.sourcesAlways")}</span>
                }
              />
            </div>
          </Section>
        ) : null}
        {editable ? null : <p className="text-sm text-text-muted">{t("reviews.settings.adminsOnly")}</p>}
      </div>
    </SpaceSettingsPage>
  );
}
