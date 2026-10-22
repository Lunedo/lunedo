import { Button, Notice } from "@pagehall/ui";
import { AlertTriangle, Check, CloudOff, LoaderCircle, PencilLine } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { translateKey } from "../i18n/translate.js";
import type { CollaborationProblem } from "./collaboration.js";
import type { SaveState } from "./save-state.js";

const ICONS = {
  editing: PencilLine,
  saving: LoaderCircle,
  saved: Check,
  offline: CloudOff,
  error: AlertTriangle,
} as const;

export function SaveStateIndicator({ state, draft = false }: { state: SaveState; draft?: boolean }) {
  const { t } = useTranslation();
  const Icon = ICONS[state];
  return (
    <span
      role="status"
      aria-live="polite"
      data-state={state}
      className="ph-save-state inline-flex items-center gap-1 text-sm whitespace-nowrap"
    >
      <Icon
        aria-hidden="true"
        className={
          state === "saving" ? "size-icon-sm animate-spin motion-reduce:animate-none" : "size-icon-sm"
        }
      />
      {translateKey(t, draft && state === "saved" ? "editor.save.savedDraft" : `editor.save.${state}`)}
    </span>
  );
}

export function useUnsavedChangesWarning(hasUnsavedChanges: () => boolean): void {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    globalThis.addEventListener("beforeunload", onBeforeUnload);
    return () => globalThis.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);
}

const SIGN_IN_PROBLEMS = new Set<CollaborationProblem>(["notSignedIn", "sessionEnded"]);

export function CollaborationProblemNotice({ problem }: { problem: CollaborationProblem }) {
  const { t } = useTranslation();
  const action = SIGN_IN_PROBLEMS.has(problem) ? (
    <Button
      size="sm"
      onClick={() => globalThis.location.assign(`/sign-in?redirect=${encodeURIComponent(location.pathname)}`)}
    >
      {t("editor.problems.signIn")}
    </Button>
  ) : problem === "noEditPermission" ||
    problem === "permissionRevoked" ||
    problem === "pageNotFound" ||
    problem === "maintenance" ? null : (
    <Button size="sm" variant="outline" onClick={() => globalThis.location.reload()}>
      {t("editor.problems.reload")}
    </Button>
  );
  return (
    <Notice
      variant={
        problem === "permissionRevoked" || problem === "noEditPermission" || problem === "maintenance"
          ? "warning"
          : "danger"
      }
      title={translateKey(t, `editor.problems.${problem}.title`)}
      action={action}
    >
      {translateKey(t, `editor.problems.${problem}.description`)}
    </Notice>
  );
}
