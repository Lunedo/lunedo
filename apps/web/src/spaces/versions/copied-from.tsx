import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { itemHref } from "../item-paths.js";
import { itemQuery } from "../space-queries.js";

export function CopiedFrom({ source }: { source: { itemId: string | null; title: string } | null }) {
  const { t } = useTranslation();
  const original = useQuery({ ...itemQuery(source?.itemId ?? ""), enabled: Boolean(source?.itemId) });
  const href = original.data ? itemHref(original.data, original.data.spaceKey) : null;
  if (!source || !href) return null;
  return (
    <Link to={href} className="px-3 text-sm text-accent underline focus-visible:focus-ring">
      {t("versions.openOriginal", { title: source.title })}
    </Link>
  );
}
