import { Badge, classNames, ErrorState, Icon } from "@pagehall/ui";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";

const MAX_BYTES = 10 * 1024 * 1024;

export function UserListField({
  onRead,
  result,
}: {
  onRead: (text: string) => Promise<void>;
  result: string | null;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const inputId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "failed"; error: unknown }>({
    kind: "idle",
  });

  const run = async (chosen: File) => {
    setFile(chosen);
    if (chosen.size > MAX_BYTES) {
      setState({ kind: "failed", error: null });
      return;
    }
    setState({ kind: "busy" });
    try {
      await onRead(await chosen.text());
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "failed", error });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const chosen = event.dataTransfer.files[0];
          if (chosen) void run(chosen);
        }}
        aria-busy={state.kind === "busy"}
        className={classNames(
          "flex cursor-pointer flex-wrap items-center gap-3 rounded-md border-2 border-dashed bg-surface-sunken p-4 focus-within:focus-ring",
          dragging ? "border-accent bg-accent-soft" : "border-border",
        )}
      >
        <Icon icon={Upload} className="text-text-muted" />
        <span className="flex min-w-0 flex-1 basis-field flex-col">
          <span className="font-medium">{t("imports.people.listDrop")}</span>
          <span id={hintId} className="text-sm text-text-muted">
            {t("imports.people.listHint")}
          </span>
        </span>
        <span className="font-medium text-accent">
          {state.kind === "busy" ? t("imports.people.listReading") : t("imports.people.listChoose")}
        </span>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          aria-describedby={hintId}
          className="sr-only"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (chosen) void run(chosen);
          }}
        />
      </label>
      {state.kind === "failed" ? (
        <ErrorState
          title={t("imports.people.listFailed", { name: file?.name ?? "" })}
          cause={
            state.error === null
              ? t("imports.people.listTooLarge", { size: format.bytes(file?.size ?? 0) })
              : problemMessage(t, state.error)
          }
          action={t("imports.people.listFailedAction")}
          {...(file && state.error !== null
            ? { onRetry: () => void run(file), retryLabel: t("imports.people.listRetry") }
            : {})}
        />
      ) : null}
      {state.kind === "idle" && result ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
          <Icon icon={FileSpreadsheet} className="text-text-muted" />
          <div className="flex min-w-0 flex-1 basis-field flex-col">
            {file ? (
              <span className="truncate font-medium" title={file.name}>
                {file.name}
              </span>
            ) : null}
            <span className="text-sm text-text-muted">{result}</span>
          </div>
          <Badge variant="success">
            <Icon icon={CheckCircle2} size="sm" />
            {t("imports.people.listRead")}
          </Badge>
        </div>
      ) : null}
    </div>
  );
}
