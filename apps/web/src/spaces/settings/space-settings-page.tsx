import { FieldLayoutProvider, PageHeader } from "@lunedo/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentTitle } from "../../screens/settings/settings-page.js";
import { spaceDisplayName } from "../space-badge.js";
import { useSpace } from "../space-context.js";

export function SpaceSettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { space } = useSpace();
  useDocumentTitle(`${title} · ${spaceDisplayName(t, space)}`);
  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-8 px-4 pt-6 pb-12 md:px-8">
      <PageHeader variant="settings" title={title} description={description} />
      <FieldLayoutProvider layout="row">{children}</FieldLayoutProvider>
    </div>
  );
}
