import { Button, Notice, Section, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type IdentityProvider,
  providerTestResultQuery,
  startProviderTest,
} from "../../api/identity-queries.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { navigateTo } from "../../session/provider-sign-in.js";

export function StartTestButton({
  provider,
  returnTo,
  variant = "secondary",
}: {
  provider: IdentityProvider;
  returnTo: () => string;
  variant?: "primary" | "secondary";
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant={variant}
        icon={Play}
        loading={busy}
        onClick={() =>
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              const { url } = await startProviderTest(provider.id, returnTo());
              navigateTo(url);
            } catch (failure) {
              setError(problemMessage(t, failure));
              setBusy(false);
            }
          })()
        }
      >
        {t("identityProviders.test.start")}
      </Button>
      {error ? (
        <Notice variant="danger" title={t("failures.startTest")}>
          {error}
        </Notice>
      ) : null}
    </div>
  );
}

export function TestResult({ provider, flowId }: { provider: IdentityProvider; flowId: string }) {
  const { t } = useTranslation();
  const result = useQuery(providerTestResultQuery(provider.id, flowId));
  if (result.isPending) return <Skeleton className="h-24 w-full" />;
  if (result.isError) {
    return (
      <LoadError what={t("failures.loadTestResult")} error={result.error} onRetry={() => result.refetch()} />
    );
  }
  const data = result.data;
  if ("error" in data) {
    return (
      <Notice variant="danger" title={t("identityProviders.test.failed")}>
        <p>{data.error}</p>
        <p>{t("identityProviders.test.failedAction")}</p>
      </Notice>
    );
  }
  const groups = data.groups;
  return (
    <div className="flex flex-col gap-4">
      <Notice variant="success" title={t("identityProviders.test.worked")}>
        {t("identityProviders.test.summary", {
          claims: data.claims.length,
          groups: groups?.length ?? 0,
        })}
      </Notice>
      {!data.emailVerified && data.email ? (
        <Notice variant="warning" title={t("identityProviders.test.unverifiedTitle")}>
          {t("identityProviders.test.unverified", { email: data.email })}
        </Notice>
      ) : null}
      <Section title={t("identityProviders.test.received")}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2">
          <Entry label={t("identityProviders.test.subject")} value={data.subject} mono />
          <Entry label={t("identityProviders.test.email")} value={data.email ?? t("common.unknown")} />
          <Entry
            label={t("identityProviders.test.signInName")}
            value={data.signInName ?? t("common.unknown")}
          />
          <Entry
            label={t("identityProviders.test.displayName")}
            value={data.displayName ?? t("common.unknown")}
          />
          <Entry
            label={t("identityProviders.test.groups")}
            value={
              groups === null
                ? t("identityProviders.test.noGroups")
                : groups.map((group) => group.name ?? group.id).join(", ") ||
                  t("identityProviders.test.noGroups")
            }
          />
        </dl>
      </Section>
      <ReceivedClaims claims={data.claims} title={t("identityProviders.test.claims")} />
    </div>
  );
}

export function ReceivedClaims({
  claims,
  title,
}: {
  claims: { name: string; values: string[] }[];
  title: string;
}) {
  const { t } = useTranslation();
  return (
    <Section title={title}>
      {claims.length === 0 ? (
        <p className="px-4 py-3 text-sm text-text-muted">{t("identityProviders.test.noClaims")}</p>
      ) : (
        <dl className="flex flex-col gap-2 px-4 py-3 text-sm">
          {claims.map((claim) => (
            <div
              key={claim.name}
              className="grid grid-cols-1 gap-x-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
            >
              <dt className="break-all font-mono text-text-muted">{claim.name}</dt>
              <dd className="break-all font-mono">{claim.values.join(", ") || t("common.unknown")}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="px-4 pb-3 text-sm text-text-muted">{t("identityProviders.test.claimsHint")}</p>
    </Section>
  );
}

export function Entry({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-text-muted">{label}</dt>
      <dd className={mono ? "break-all font-mono" : "break-words"}>{value}</dd>
    </div>
  );
}
