import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function CopiedFrom({ source }: { source: { title: string | null; path: string | null } | null }) {
  const { t } = useTranslation();
  if (!source?.path || !source.title) return null;
  return (
    <Link to={source.path} className="px-3 text-sm text-accent underline focus-visible:focus-ring">
      {t("versions.openOriginal", { title: source.title })}
    </Link>
  );
}
