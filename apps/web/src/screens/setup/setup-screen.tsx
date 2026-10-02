import { type SetupStepId, setupCodeSchema } from "@pagehall/shared";
import { Button, Field, Input, Notice, Skeleton } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { queryKeys } from "../../api/queries.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { AuthCard } from "../auth/auth-layout.js";
import { setupStateQuery, setupStepsQuery } from "./setup-api.js";
import { InstanceStep } from "./steps/instance-step.js";
import { KeyBackupStep } from "./steps/key-backup-step.js";
import { MailStep } from "./steps/mail-step.js";
import { OrganizationStep } from "./steps/organization-step.js";
import { OwnerStep } from "./steps/owner-step.js";
import { SystemCheckStep } from "./steps/system-check-step.js";

const SETUP_CODE_COMMAND = 'docker compose logs pagehall | grep "Setup link"';

const STEP_ORDER: SetupStepId[] = ["systemCheck", "instance", "owner", "keyBackup", "organization", "mail"];

export function SetupScreen() {
  const router = useRouter();
  const state = useQuery(setupStateQuery);
  const [linkedCode] = useState(() => codeFromFragment(window.location.hash));
  useEffect(() => {
    if (window.location.hash) router.history.replace(`${window.location.pathname}${window.location.search}`);
  }, [router]);
  if (state.isPending) return <SetupFrame step={0} total={STEP_ORDER.length + 1} title="" loading />;
  if (state.data?.session) return <SetupSteps />;
  return <SetupCode linkedCode={linkedCode} />;
}

const codeForm = z.object({ code: setupCodeSchema });

export function codeFromFragment(hash: string): string {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("code")?.trim() ?? "";
  return setupCodeSchema.safeParse(value).success ? value : "";
}

function SetupCode({ linkedCode }: { linkedCode: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(codeForm, { defaultValues: { code: linkedCode } });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(() => api.POST("/api/v1/setup/session", { body: values }), { sessionHandling: false });
      await queryClient.invalidateQueries({ queryKey: setupStateQuery.queryKey });
    } catch (failure) {
      setError(problemMessage(t, failure));
    }
  });
  return (
    <SetupFrame
      step={0}
      total={STEP_ORDER.length + 1}
      title={t("setup.code.title")}
      description={t("setup.code.description")}
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
        {error ? (
          <Notice variant="danger" title={t("failures.enterSetupCode")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("setup.code.label")} error={form.formState.errors.code?.message}>
          <Input
            autoComplete="off"
            autoFocus
            className="font-mono tracking-label"
            {...form.register("code")}
          />
        </Field>
        <p className="text-sm text-text-muted">{t("setup.code.where")}</p>
        <pre className="overflow-x-auto rounded-md border border-border bg-surface-sunken p-3 font-mono text-sm">
          {SETUP_CODE_COMMAND}
        </pre>
        <p className="text-sm text-text-muted">{t("setup.code.hint")}</p>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            {t("setup.continue")}
          </Button>
        </div>
      </form>
    </SetupFrame>
  );
}

function SetupSteps() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const steps = useQuery({ ...setupStepsQuery, throwOnError: false });
  const [current, setCurrent] = useState<SetupStepId | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (steps.isPending) return <SetupFrame step={1} total={STEP_ORDER.length + 1} title="" loading />;
  if (steps.isError) {
    return (
      <SetupFrame step={1} total={STEP_ORDER.length + 1} title={t("setup.failed")}>
        <LoadError what={t("failures.loadSetupSteps")} error={steps.error} onRetry={() => steps.refetch()} />
      </SetupFrame>
    );
  }

  const list = steps.data.steps;
  const order = STEP_ORDER.filter((id) => list.some((step) => step.id === id));
  const firstOpen =
    order.find((id) => !list.find((step) => step.id === id)?.completed) ?? order.at(-1) ?? "mail";
  const active = current ?? firstOpen;
  const index = order.indexOf(active);
  const refresh = () => queryClient.invalidateQueries({ queryKey: setupStepsQuery.queryKey });

  const next = async () => {
    await refresh();
    const following = order[index + 1];
    if (following) setCurrent(following);
  };

  const finish = async () => {
    setError(null);
    setFinishing(true);
    try {
      await request(() => api.POST("/api/v1/setup/complete"), { sessionHandling: false });
      await queryClient.invalidateQueries({ queryKey: queryKeys.instanceInfo });
      await navigate({ to: "/sign-in" });
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setFinishing(false);
    }
  };

  const back =
    index > 0 ? (
      <Button variant="secondary" icon={ArrowLeft} onClick={() => setCurrent(order[index - 1] ?? null)}>
        {t("setup.back")}
      </Button>
    ) : (
      <span />
    );

  const step = list.find((candidate) => candidate.id === active);
  const common = { back, onDone: next, refresh };
  return (
    <SetupFrame
      step={index + 1}
      total={order.length + 1}
      stepName={t(`setup.steps.${active}`)}
      title={t(`setup.${active}.title`)}
      description={t(`setup.${active}.description`)}
    >
      {error ? (
        <Notice variant="danger" title={t("failures.finishSetup")}>
          {error}
        </Notice>
      ) : null}
      {active === "systemCheck" && step ? (
        <SystemCheckStep {...common} details={step.details as never} />
      ) : null}
      {active === "instance" && step ? <InstanceStep {...common} details={step.details as never} /> : null}
      {active === "owner" && step ? <OwnerStep {...common} details={step.details as never} /> : null}
      {active === "keyBackup" && step ? <KeyBackupStep {...common} details={step.details as never} /> : null}
      {active === "organization" && step ? (
        <OrganizationStep {...common} details={step.details as never} />
      ) : null}
      {active === "mail" && step ? (
        <MailStep
          {...common}
          details={step.details as never}
          ready={steps.data.ready}
          finishing={finishing}
          onFinish={() => void finish()}
        />
      ) : null}
    </SetupFrame>
  );
}

function SetupFrame({
  step,
  total,
  stepName,
  title,
  description,
  children,
  loading = false,
}: {
  step: number;
  total: number;
  stepName?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-full items-center justify-center bg-sidebar px-4 py-10">
      <AuthCard
        wide
        title={title}
        description={
          <>
            <span className="mb-1 block text-sm">
              {t("setup.progress", { step: step + 1, total: total, name: stepName ?? t("setup.code.name") })}
            </span>
            {description}
          </>
        }
      >
        <div className="flex gap-1" aria-hidden="true">
          {Array.from({ length: total }, (_, position) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: the bars have no identity besides their position
              key={position}
              className={`h-1 min-w-6 flex-1 rounded-full ${position <= step ? "bg-accent" : "bg-border"}`}
            />
          ))}
        </div>
        {loading ? <Skeleton className="h-12 w-full" /> : children}
      </AuthCard>
    </div>
  );
}
