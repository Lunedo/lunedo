import type { ContentLanguage } from "@pagehall/shared";
import { Button, Combobox, Dialog, Field } from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { SaveIndicator, useSaveState } from "../components/auto-save.js";
import { contentLanguageItems, contentLanguageLabel } from "../search/content-language.js";
import { type ItemDetails, spaceKeys } from "./space-queries.js";

const INHERITED = "inherited";

export function ContentLanguageDialog({
  page,
  open,
  onOpenChange,
}: {
  page: ItemDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const tracker = useSaveState();
  const inherited = page.contentLanguage === null;
  const spaceLanguage = contentLanguageLabel(t, page.spaceContentLanguage, i18n.language);

  const save = (language: ContentLanguage | null) =>
    tracker.run(async () => {
      await request(() =>
        api.PUT("/api/v1/pages/{pageId}/content-language", {
          params: { path: { pageId: page.id } },
          body: { language },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: spaceKeys.item(page.id) });
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("contentLanguage.title", { title: page.title })}
      description={t("contentLanguage.description")}
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {t("ui.close")}
        </Button>
      }
    >
      <Field
        label={t("contentLanguage.label")}
        hint={
          inherited
            ? t("contentLanguage.inheritedFromSpace", { language: spaceLanguage })
            : t("contentLanguage.setForPage")
        }
      >
        <Combobox
          aria-label={t("contentLanguage.label")}
          value={page.contentLanguage ?? INHERITED}
          items={[
            { value: INHERITED, label: t("contentLanguage.space", { language: spaceLanguage }) },
            ...contentLanguageItems(t, i18n.language),
          ]}
          muted={inherited}
          onValueChange={(next) => {
            if (next === null || next === (page.contentLanguage ?? INHERITED)) return;
            void save(next === INHERITED ? null : (next as ContentLanguage));
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        {inherited ? null : (
          <Button variant="outline" size="sm" icon={RotateCcw} onClick={() => void save(null)}>
            {t("contentLanguage.useSpace")}
          </Button>
        )}
        <SaveIndicator tracker={tracker} />
      </div>
    </Dialog>
  );
}
