import { instanceUrlSchema } from "@lunedo/shared";
import { Button, ConfirmDialog, Icon, Input, SettingRow } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { instanceAddressQuery } from "../../api/instance-queries.js";
import { request } from "../../api/request.js";
import { useFailureToast } from "../../errors/failure.js";
import { translateKey } from "../../i18n/translate.js";
import { settingDescriptionKey, settingLabelKey } from "../../settings/setting-fields.js";

export function cleanAddress(value: string): string | null {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.pathname !== "/" || url.search || url.hash) return null;
    const parsed = instanceUrlSchema.safeParse(url.origin);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function InstanceAddressRow({
  canManage,
  navigate = (url) => globalThis.location.assign(url),
}: {
  canManage: boolean;
  navigate?: (url: string) => void;
}) {
  const { t } = useTranslation();
  const showFailure = useFailureToast();
  const address = useQuery({ ...instanceAddressQuery, throwOnError: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<"invalid" | "unchanged" | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = address.data?.url ?? "";
  const fromEnvironment = address.data?.source === "environment";
  const value = draft ?? current;
  const dirty = draft !== null && draft !== current;
  const label = translateKey(t, settingLabelKey("instance.url"));
  const describedBy = problem ? "instance-address-error" : undefined;

  const save = () => {
    const cleaned = cleanAddress(value);
    const next = cleaned === null ? "invalid" : cleaned === current ? "unchanged" : null;
    setProblem(next);
    if (next || !cleaned) {
      inputRef.current?.focus();
      return;
    }
    setConfirming(cleaned);
  };

  const control =
    fromEnvironment || !canManage ? (
      <span className="font-mono text-sm break-all">{current || t("settings.notSet")}</span>
    ) : (
      <div className="flex w-full flex-col gap-2">
        <Input
          ref={inputRef}
          type="url"
          aria-label={label}
          value={value}
          invalid={problem !== null}
          {...(describedBy ? { "aria-describedby": describedBy } : {})}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setDraft(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
            if (event.key === "Escape") setDraft(null);
          }}
        />
        {dirty ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              onClick={() => {
                setDraft(null);
                setProblem(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="primary" onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        ) : null}
      </div>
    );

  return (
    <>
      <SettingRow
        label={label}
        description={
          fromEnvironment
            ? t("instance.general.addressFromEnvironment")
            : translateKey(t, settingDescriptionKey("instance.url"))
        }
        control={control}
        {...(problem
          ? {
              status: (
                <p id="instance-address-error" className="text-sm text-danger">
                  <Icon icon={CircleAlert} size="sm" className="mr-1 inline align-text-bottom" />
                  {problem === "invalid"
                    ? t("instance.general.addressInvalid")
                    : t("instance.general.addressUnchanged")}
                </p>
              ),
            }
          : {})}
      />
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={t("instance.general.addressConfirmTitle", { url: confirming ?? "" })}
        description={t("instance.general.addressConfirmIntro")}
        confirmLabel={t("instance.general.addressMove")}
        cancelLabel={t("instance.general.addressKeep")}
        destructive
        onConfirm={async () => {
          if (!confirming) return;
          try {
            const moved = await request(() =>
              api.PUT("/api/v1/instance/address", { body: { url: confirming } }),
            );
            navigate(`${moved.url}/sign-in`);
          } catch (failure) {
            showFailure(t("failures.changeAddress"), failure);
            throw failure;
          }
        }}
      >
        <ul
          aria-label={t("instance.general.addressConfirmIntro")}
          className="flex list-disc flex-col gap-2 ps-5"
        >
          <li>{t("instance.general.addressEffectPasskeys")}</li>
          <li>{t("instance.general.addressEffectProviders")}</li>
          <li>{t("instance.general.addressEffectSessions")}</li>
        </ul>
      </ConfirmDialog>
    </>
  );
}
