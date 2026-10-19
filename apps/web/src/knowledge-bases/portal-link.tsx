import { buttonClassName } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { useSpace } from "../spaces/space-context.js";
import { articlePortalUrl, portalQuery } from "./queries.js";

export function PortalLink({
  compact = false,
  article,
}: {
  compact?: boolean;
  article?: { number: number; slug: string } | null;
}) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const portal = useQuery({ ...portalQuery(space.id), throwOnError: false });
  if (!portal.data) return null;
  const href = article ? articlePortalUrl(portal.data, article) : portal.data.url;
  return (
    <a
      className={buttonClassName({ variant: "secondary", size: compact ? "sm" : "md" })}
      href={href}
      target="_blank"
      rel="noopener"
    >
      <ExternalLink aria-hidden="true" className={compact ? "size-icon-sm" : "size-icon"} />
      {t("knowledgeBase.portal.view")}
    </a>
  );
}

export function ArticlePortalLink({ itemId }: { itemId: string }) {
  const article = useQuery({
    queryKey: ["articles", itemId, "address"],
    queryFn: () => request(() => api.GET("/api/v1/articles/{itemId}", { params: { path: { itemId } } })),
    throwOnError: false,
    retry: false,
  });
  if (!article.data?.published || article.data.number === null) return null;
  return <PortalLink compact article={{ number: article.data.number, slug: article.data.slug }} />;
}
