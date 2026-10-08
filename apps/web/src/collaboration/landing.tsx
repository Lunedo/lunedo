import { Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { usePreferences } from "../preferences/preferences-provider.js";
import { useOrganizationState } from "../shell/shell-context.js";
import { itemHref } from "../spaces/item-paths.js";
import { Redirect } from "../spaces/redirect.js";
import { organizationHomePageQuery } from "./queries.js";

export function Landing() {
  const preferences = usePreferences();
  const { organizationId } = useOrganizationState();
  const wantsOrganization = preferences.startPage === "organizationHome" && organizationId !== null;
  const homePage = useQuery({
    ...organizationHomePageQuery(organizationId ?? ""),
    enabled: wantsOrganization,
    throwOnError: false,
  });
  if (wantsOrganization && homePage.isPending) return <Skeleton className="m-6 h-field" />;
  const page = wantsOrganization ? homePage.data?.page : null;
  const href = page
    ? itemHref({ id: page.id, kind: page.kind, title: page.title, link: null }, page.spaceKey)
    : null;
  return <Redirect to={href ?? "/home"} />;
}
