import { type SetupStepId, setupCodeSchema } from "@lunedo/shared";
import { Button, CodeBlock, Field, Input, Notice } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { OrDivider } from "../auth/auth-layout.js";
import { RestoreDraftProvider, RestoreFlow } from "./restore/restore-flow.js";
import { setupStateQuery, setupStepsQuery } from "./setup-api.js";
import { SetupDraftsProvider } from "./setup-drafts.js";
import { SetupFrame, type SetupProgress } from "./setup-frame.js";
import { InstanceStep } from "./steps/instance-step.js";
import { KeyBackupStep } from "./steps/key-backup-step.js";
import { OrganizationStep } from "./steps/organization-step.js";
import { OwnerStep } from "./steps/owner-step.js";
import { ReadyScreen } from "./steps/ready-screen.js";
import { SummaryStep } from "./steps/summary-step.js";
import { SystemCheckStep } from "./steps/system-check-step.js";

const SETUP_CODE_COMMAND = 'docker compose logs lunedo | grep "Setup link"';

export const SETUP_PAGES = [
  "welcome",
  "instance",
  "systemCheck",
  "owner",
  "keyBackup",
  "organization",
  "summary",
] as const;
export type SetupPage = (typeof SETUP_PAGES)[number];

const STEP_ORDER: SetupStepId[] = ["instance", "systemCheck", "owner", "keyBackup", "organization"];

const route = getRouteApi("/setup");

type Finished = { organizationId: string | null; mailConfigured: boolean };

export function SetupScreen() {
  const router = useRouter();
  const state = useQuery(setupStateQuery);
  const [linkedCode] = useState(() => codeFromFragment(window.location.hash));
  const [finished, setFinished] = useState<Finished | null>(null);
  useEffect(() => {
    if (window.location.hash) router.history.replace(`${window.location.pathname}${window.location.search}`);
  }, [router]);
  if (finished) return <ReadyScreen {...finished} />;
  if (state.isPending) return <SetupFrame title="" loading />;
  return (
    <RestoreDraftProvider>
      {state.data?.session ? <WithSession onFinished={setFinished} /> : <Welcome linkedCode={linkedCode} />}
    </RestoreDraftProvider>
  );
}

function WithSession({ onFinished }: { onFinished: (finished: Finished) => void }) {
  const navigate = useNavigate();
  const search = route.useSearch();
  if (search.restore) {
    return (
      <RestoreFlow
        page={search.restore}
        goTo={(page) => void navigate({ to: "/setup", search: { restore: page } })}
        onWelcome={() => void navigate({ to: "/setup", search: { step: "welcome" } })}
      />
    );
  }
  return (
    <SetupDraftsProvider>
      <SetupSteps onFinished={onFinished} />
    </SetupDraftsProvider>
  );
}

function RestoreChoices({ onChoose }: { onChoose: (page: "upload" | "s3" | "server") => void }) {
  const { t } = useTranslation();
  return (
    <section className="mt-4 flex flex-col" aria-labelledby="restore-choices">
      <OrDivider label={t("setup.welcome.orRestore")} id="restore-choices" />
      <ul className="mt-2 flex flex-col">
        {(["upload", "s3", "server"] as const).map((page) => (
          <li key={page} className="border-border border-t">
            <button
              type="button"
              className="flex w-full items-center gap-3 py-3 text-left hover:bg-hover focus-visible:focus-ring"
              onClick={() => onChoose(page)}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{t(`setup.welcome.restore.${page}.title`)}</span>
                <span className="text-sm text-text-muted">
                  {t(`setup.welcome.restore.${page}.description`)}
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const codeForm = z.object({ code: setupCodeSchema });

export function codeFromFragment(hash: string): string {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("code")?.trim() ?? "";
  return setupCodeSchema.safeParse(value).success ? value : "";
}

function WelcomeFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <SetupFrame title={t("setup.welcome.title")} description={t("setup.welcome.description")}>
      {children}
    </SetupFrame>
  );
}

function Welcome({ linkedCode }: { linkedCode: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(codeForm, { defaultValues: { code: linkedCode } });
  const enter = (restore?: "upload" | "s3" | "server") =>
    form.handleSubmit(async (values) => {
      setError(null);
      try {
        await request(() => api.POST("/api/v1/setup/session", { body: values }), { sessionHandling: false });
        if (restore) await navigate({ to: "/setup", search: { restore } });
        await queryClient.invalidateQueries({ queryKey: setupStateQuery.queryKey });
      } catch (failure) {
        setError(problemMessage(t, failure));
      }
    });
  const submit = enter();
  return (
    <WelcomeFrame>
      <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
        {error ? (
          <Notice variant="danger" title={t("failures.enterSetupCode")}>
            {error}
          </Notice>
        ) : null}
        <Field
          label={t("setup.code.label")}
          hint={t("setup.code.where")}
          error={form.formState.errors.code?.message}
        >
          <Input
            autoComplete="off"
            autoFocus
            className="font-mono tracking-label"
            {...form.register("code")}
          />
        </Field>
        <CodeBlock value={SETUP_CODE_COMMAND} copyLabel={t("setup.code.copyCommand")} />
        <div>
          <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting}>
            {t("setup.welcome.newInstance")}
          </Button>
        </div>
      </form>
      <RestoreChoices onChoose={(page) => void enter(page)()} />
    </WelcomeFrame>
  );
}

function SetupSteps({ onFinished }: { onFinished: (finished: Finished) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = route.useSearch();
  const queryClient = useQueryClient();
  const steps = useQuery({ ...setupStepsQuery, throwOnError: false });

  if (steps.isPending) return <SetupFrame title="" loading />;
  if (steps.isError) {
    return (
      <SetupFrame title={t("setup.failed")}>
        <LoadError what={t("failures.loadSetupSteps")} error={steps.error} onRetry={() => steps.refetch()} />
      </SetupFrame>
    );
  }

  const list = steps.data.steps;
  const order = STEP_ORDER.filter((id) => list.some((step) => step.id === id));
  const completed = (id: SetupStepId) => list.find((step) => step.id === id)?.completed ?? false;
  const firstOpen: SetupPage = order.find((id) => !completed(id)) ?? "summary";
  const pages: SetupPage[] = ["welcome", ...order, "summary"];
  const reachable = (page: SetupPage) => {
    if (page === "welcome") return true;
    const index = pages.indexOf(page);
    return (
      index >= 0 && pages.slice(1, index).every((id) => id === "summary" || completed(id as SetupStepId))
    );
  };
  const requested = search.step;
  const active: SetupPage = requested && reachable(requested) ? requested : firstOpen;
  const index = pages.indexOf(active);
  const refresh = () => queryClient.invalidateQueries({ queryKey: setupStepsQuery.queryKey });

  const goTo = (page: SetupPage) => void navigate({ to: "/setup", search: { step: page } });

  const next = async () => {
    await refresh();
    const following = pages[index + 1];
    if (following) goTo(following);
  };

  const progress: SetupProgress = {
    steps: pages.map((page) => ({
      id: page,
      name: t(`setup.steps.${page}`),
      done: page === "welcome" || (page !== "summary" && completed(page)),
      reachable: reachable(page),
    })),
    current: index,
    onSelect: (id) => goTo(id as SetupPage),
  };

  const previous = pages[index - 1];
  const back = previous ? (
    <Button variant="secondary" icon={ArrowLeft} onClick={() => goTo(previous)}>
      {t("setup.back")}
    </Button>
  ) : (
    <span />
  );

  if (active === "welcome") {
    return (
      <WelcomeFrame>
        <div>
          <Button variant="primary" size="lg" onClick={() => goTo(firstOpen)}>
            {t("setup.welcome.newInstance")}
          </Button>
        </div>
        <RestoreChoices onChoose={(page) => void navigate({ to: "/setup", search: { restore: page } })} />
      </WelcomeFrame>
    );
  }

  if (active === "summary") {
    return (
      <SetupFrame
        title={t("setup.summary.title")}
        description={t("setup.summary.description")}
        progress={progress}
      >
        <SummaryStep steps={list} back={back} onChange={goTo} onRecheck={refresh} onFinished={onFinished} />
      </SetupFrame>
    );
  }

  const step = list.find((candidate) => candidate.id === active);
  const common = { back, onDone: next, refresh, completed: step?.completed ?? false };
  return (
    <SetupFrame
      title={t(`setup.${active}.title`)}
      description={t(`setup.${active}.description`)}
      progress={progress}
    >
      {active === "systemCheck" && step ? (
        <SystemCheckStep {...common} details={step.details as never} />
      ) : null}
      {active === "instance" && step ? <InstanceStep {...common} details={step.details as never} /> : null}
      {active === "owner" && step ? <OwnerStep {...common} details={step.details as never} /> : null}
      {active === "keyBackup" && step ? <KeyBackupStep {...common} details={step.details as never} /> : null}
      {active === "organization" && step ? (
        <OrganizationStep {...common} details={step.details as never} />
      ) : null}
    </SetupFrame>
  );
}
