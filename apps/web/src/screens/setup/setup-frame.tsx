import { Menu, type MenuItem, Skeleton } from "@lunedo/ui";
import { Check, ChevronDown, Circle, CircleDot } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LunedoMark } from "../../shell/lunedo-mark.js";
import { CornerControls } from "../auth/corner-controls.js";

export interface SetupProgress {
  steps: { id: string; name: string; done: boolean; reachable: boolean }[];
  current: number;
  onSelect: (id: string) => void;
}

export function SetupFrame({
  title,
  description,
  progress,
  children,
  loading = false,
}: {
  title: string;
  description?: ReactNode;
  progress?: SetupProgress;
  children?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="relative flex min-h-full flex-col bg-sidebar">
      <CornerControls languageLabelKey="setup.language" />
      <main className="mx-auto flex w-full max-w-column flex-col px-4 pt-12 pb-12">
        <div className="mb-8 flex items-center gap-2 font-semibold">
          <LunedoMark className="size-control-md" />
          <BrandName />
        </div>
        {progress ? <StepMenu progress={progress} /> : null}
        <h1 className="font-bold text-display tracking-heading">{title}</h1>
        {description ? <p className="mt-2 text-content text-text-muted">{description}</p> : null}
        <div className="mt-6 flex flex-col gap-4">
          {loading ? <Skeleton className="h-12 w-full" /> : children}
        </div>
      </main>
    </div>
  );
}

function BrandName() {
  const { t } = useTranslation();
  return <span>{t("brand.name")}</span>;
}

function StepMenu({ progress }: { progress: SetupProgress }) {
  const { t } = useTranslation();
  const { steps, current } = progress;
  const active = steps[current];
  const items: MenuItem[] = steps.map((step, index) => ({
    label: step.name,
    icon: index === current ? CircleDot : step.done ? Check : Circle,
    disabled: index === current || !step.reachable,
    onSelect: () => progress.onSelect(step.id),
  }));
  const label = t("setup.progress", { step: current + 1, total: steps.length, name: active?.name ?? "" });
  return (
    <div className="mb-8 flex flex-col gap-2">
      <div>
        <Menu
          align="start"
          trigger={
            <button
              type="button"
              className="-mx-1 inline-flex min-h-hit items-center gap-1 rounded-sm px-1 text-sm text-text-muted hover:text-text focus-visible:focus-ring"
            >
              {label}
              <ChevronDown aria-hidden="true" className="size-icon-sm" />
            </button>
          }
          items={items}
        />
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={current + 1}
        className="h-1 w-full overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.round(((current + 1) / steps.length) * 100)}%` }}
        />
      </div>
    </div>
  );
}
