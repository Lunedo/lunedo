import { Button, EmptyState, List, ListRow, PageHeader, Section, Skeleton } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { BookOpen, ExternalLink, LifeBuoy, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { SessionsSection, SignInSection, TwoFactorSection } from "../screens/account/security-screen.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { signedOut } from "../session/sign-out.js";
import { useSession } from "../shell/shell-context.js";

export const portalsQuery = {
  queryKey: ["account", "portals"] as const,
  queryFn: () => request(() => api.GET("/api/v1/account/portals")),
};

export function PortalAccountHome() {
  const { t } = useTranslation();
  const session = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const portals = useQuery({ ...portalsQuery, throwOnError: false });
  useDocumentTitle(t("portalAccounts.home.title"));
  const signOut = () => {
    void request(() => api.POST("/api/v1/auth/sign-out"), { sessionHandling: false })
      .catch(() => undefined)
      .then(async () => {
        signedOut();
        queryClient.clear();
        await router.navigate({ to: "/sign-in", search: { reason: "signedOut" } });
      });
  };
  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
      <PageHeader
        title={t("portalAccounts.home.title")}
        description={t("portalAccounts.home.description", { name: session.account?.name ?? "" })}
        icon={LifeBuoy}
        actions={
          <Button variant="secondary" icon={LogOut} onClick={signOut}>
            {t("portalAccounts.home.signOut")}
          </Button>
        }
      />
      <Section title={t("portalAccounts.home.portals")} icon={BookOpen}>
        {portals.isPending ? <Skeleton className="h-12 w-full" /> : null}
        {portals.isError ? (
          <LoadError
            what={t("portalAccounts.home.loadFailed")}
            error={portals.error}
            onRetry={() => portals.refetch()}
          />
        ) : null}
        {portals.data?.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={t("portalAccounts.home.emptyTitle")}
            description={t("portalAccounts.home.emptyDescription")}
          />
        ) : null}
        {portals.data && portals.data.length > 0 ? (
          <List label={t("portalAccounts.home.portals")}>
            {portals.data.map((portal) => (
              <ListRow
                key={portal.spaceId}
                icon={BookOpen}
                title={portal.name}
                description={portal.url}
                actions={
                  <a
                    href={portal.url}
                    className="inline-flex min-h-hit items-center gap-1 rounded-sm px-2 text-accent hover:underline focus-visible:focus-ring"
                  >
                    <ExternalLink aria-hidden="true" className="size-icon-sm" />
                    {t("portalAccounts.home.open")}
                  </a>
                }
              />
            ))}
          </List>
        ) : null}
      </Section>
      <SignInSection />
      <TwoFactorSection />
      <SessionsSection />
    </main>
  );
}
