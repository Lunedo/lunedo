import { Badge, Button, Field, Input, Notice, PasswordInput, RadioGroup } from "@lunedo/ui";
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  FileUp,
  LoaderCircle,
} from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isApiError } from "../../../api/request.js";
import { FailureNotice } from "../../../errors/failure.js";
import { problemMessage } from "../../../errors/problem-message.js";
import { useFormat } from "../../../preferences/preferences-provider.js";
import { SetupFrame, type SetupProgress } from "../setup-frame.js";
import {
  type BackupEntry,
  listBucketBackups,
  listServerBackups,
  openUpload,
  type RestoreStart,
  type RestoreStatus,
  restoreStatus,
  type S3Input,
  startRestore,
  uploadFile,
} from "./restore-api.js";

export const RESTORE_PAGES = ["upload", "s3", "server", "keys", "progress"] as const;
export type RestorePage = (typeof RESTORE_PAGES)[number];
type SourcePage = "upload" | "s3" | "server";

type Source = RestoreStart["source"];

interface RestoreDraft {
  source: Source | null;
  sourcePage: SourcePage | null;
  backupUrl: string | null;
  setSource: (source: Source | null, page: SourcePage, backupUrl?: string | null) => void;
}

const RestoreDraftContext = createContext<RestoreDraft | null>(null);

export function RestoreDraftProvider({ children }: { children: ReactNode }) {
  const [source, setSourceState] = useState<Source | null>(null);
  const [sourcePage, setSourcePage] = useState<SourcePage | null>(null);
  const [backupUrl, setBackupUrl] = useState<string | null>(null);
  return (
    <RestoreDraftContext.Provider
      value={{
        source,
        sourcePage,
        backupUrl,
        setSource: (next, page, url = null) => {
          setSourceState(next);
          setSourcePage(page);
          setBackupUrl(url);
        },
      }}
    >
      {children}
    </RestoreDraftContext.Provider>
  );
}

function useRestoreDraft(): RestoreDraft {
  const draft = useContext(RestoreDraftContext);
  if (!draft) throw new Error("useRestoreDraft needs a RestoreDraftProvider");
  return draft;
}

export function RestoreFlow({
  page,
  goTo,
  onWelcome,
}: {
  page: RestorePage;
  goTo: (page: RestorePage) => void;
  onWelcome: () => void;
}) {
  const { t } = useTranslation();
  const draft = useRestoreDraft();
  const sourcePage: SourcePage =
    page === "upload" || page === "s3" || page === "server" ? page : (draft.sourcePage ?? "server");
  const current = page === "keys" ? 2 : page === "progress" ? 3 : 1;
  const progress: SetupProgress = {
    steps: [
      { id: "welcome", name: t("setup.steps.welcome"), done: true, reachable: page !== "progress" },
      {
        id: sourcePage,
        name: t("setup.restore.steps.backup"),
        done: draft.source !== null,
        reachable: page !== "progress",
      },
      {
        id: "keys",
        name: t("setup.restore.steps.keys"),
        done: page === "progress",
        reachable: draft.source !== null && page !== "progress",
      },
      { id: "progress", name: t("setup.restore.steps.restore"), done: false, reachable: false },
    ],
    current,
    onSelect: (id) => (id === "welcome" ? onWelcome() : goTo(id as RestorePage)),
  };
  const back = (target: () => void) => (
    <Button variant="secondary" icon={ArrowLeft} onClick={target}>
      {t("setup.back")}
    </Button>
  );
  if (page === "keys" && draft.source) {
    return (
      <SetupFrame
        title={t("setup.restore.keys.title")}
        description={t("setup.restore.keys.description")}
        progress={progress}
      >
        <KeysPage
          source={draft.source}
          backupUrl={draft.backupUrl}
          back={back(() => goTo(sourcePage))}
          onStarted={() => goTo("progress")}
        />
      </SetupFrame>
    );
  }
  if (page === "progress") {
    return (
      <SetupFrame
        title={t("setup.restore.progress.title")}
        description={t("setup.restore.progress.description")}
        progress={progress}
      >
        <ProgressPage onKeys={() => goTo("keys")} onSource={() => goTo(sourcePage)} />
      </SetupFrame>
    );
  }
  const next = () => goTo("keys");
  return (
    <SetupFrame
      title={t(`setup.restore.${sourcePage}.title`)}
      description={t(`setup.restore.${sourcePage}.description`)}
      progress={progress}
    >
      {sourcePage === "upload" ? <UploadPage back={back(onWelcome)} onNext={next} /> : null}
      {sourcePage === "s3" ? <BucketPage back={back(onWelcome)} onNext={next} /> : null}
      {sourcePage === "server" ? <ServerPage back={back(onWelcome)} onNext={next} /> : null}
    </SetupFrame>
  );
}

function Actions({
  back,
  next,
  busy = false,
  nextLabel,
}: {
  back: ReactNode;
  next: () => void;
  busy?: boolean;
  nextLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex justify-between gap-2">
      {back}
      <Button variant="primary" loading={busy} onClick={next}>
        {nextLabel ?? t("setup.continue")}
      </Button>
    </div>
  );
}

function BackupList({
  backups,
  where,
  value,
  onChange,
  error,
}: {
  backups: BackupEntry[];
  where: string;
  value: string | null;
  onChange: (name: string) => void;
  error?: string | undefined;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  if (backups.length === 0) {
    return <Notice variant="info">{t("setup.restore.noBackups", { where })}</Notice>;
  }
  return (
    <div className="flex flex-col gap-2" id="restore-backups">
      <p className="text-sm text-text-muted">{t("setup.restore.found", { where })}</p>
      <RadioGroup
        label={t("setup.restore.chooseBackup")}
        value={value ?? ""}
        onValueChange={onChange}
        options={backups.map((backup) => ({
          value: backup.name,
          label: backup.name,
          description: backup.readable
            ? [
                backup.createdAt ? format.dateTime(backup.createdAt) : "",
                format.bytes(backup.size),
                t("setup.restore.version", { version: backup.lunedoVersion ?? "" }),
                backup.scope === "database" ? t("setup.restore.scopeDatabase") : t("setup.restore.scopeAll"),
              ].join(" · ")
            : t("setup.restore.unreadable", { size: format.bytes(backup.size) }),
          disabled: !backup.readable,
        }))}
      />
      {error ? (
        <p className="flex items-center gap-1 text-danger text-sm" role="alert">
          <CircleAlert aria-hidden="true" className="size-icon-sm" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ServerPage({ back, onNext }: { back: ReactNode; onNext: () => void }) {
  const { t } = useTranslation();
  const draft = useRestoreDraft();
  const [directory, setDirectory] = useState<string | undefined>(
    draft.source?.type === "directory" ? draft.source.directory : undefined,
  );
  const [typed, setTyped] = useState(directory ?? "");
  const [other, setOther] = useState(directory !== undefined);
  const [listing, setListing] = useState<{ directory: string; backups: BackupEntry[] } | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [chosen, setChosen] = useState<string | null>(
    draft.source?.type === "directory" ? draft.source.name : null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (target: string | undefined) => {
    setLoading(true);
    setFailure(null);
    try {
      const result = await listServerBackups(target);
      setListing(result);
      setDirectory(target);
    } catch (error) {
      setFailure(error);
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once for the directory the page opens with
  useEffect(() => {
    void load(directory);
  }, []);

  const next = () => {
    if (!chosen) {
      setProblem(t("setup.restore.chooseFirst"));
      document.querySelector<HTMLElement>("#restore-backups [role=radio]")?.focus();
      return;
    }
    draft.setSource(
      { type: "directory", name: chosen, ...(directory ? { directory } : {}) },
      "server",
      listing?.backups.find((backup) => backup.name === chosen)?.instanceUrl ?? null,
    );
    onNext();
  };

  return (
    <>
      {failure ? (
        <FailureNotice
          what={t("setup.restore.server.loadFailed")}
          error={failure}
          onRetry={() => void load(directory)}
        />
      ) : null}
      {listing ? (
        <BackupList
          backups={listing.backups}
          where={listing.directory}
          value={chosen}
          onChange={(name) => {
            setChosen(name);
            setProblem(null);
          }}
          error={problem ?? undefined}
        />
      ) : null}
      {other ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void load(typed.trim() || undefined);
          }}
        >
          <Field label={t("setup.restore.server.directory")} hint={t("setup.restore.server.directoryHint")}>
            <Input value={typed} onChange={(event) => setTyped(event.target.value)} className="font-mono" />
          </Field>
          <Button type="submit" variant="outline" loading={loading}>
            {t("setup.restore.server.load")}
          </Button>
        </form>
      ) : (
        <div>
          <button
            type="button"
            className="inline-flex min-h-hit items-center rounded-sm font-medium text-accent text-sm hover:underline focus-visible:focus-ring"
            onClick={() => setOther(true)}
          >
            {t("setup.restore.server.otherDirectory")}
          </button>
        </div>
      )}
      <Actions back={back} next={next} />
    </>
  );
}

const emptyBucket: S3Input = {
  endpoint: null,
  region: "us-east-1",
  bucket: "",
  prefix: "",
  forcePathStyle: true,
  accessKeyId: "",
  secretAccessKey: "",
};

function BucketPage({ back, onNext }: { back: ReactNode; onNext: () => void }) {
  const { t } = useTranslation();
  const draft = useRestoreDraft();
  const earlier = draft.source?.type === "s3" ? draft.source : null;
  const [input, setInput] = useState<S3Input>(earlier ? { ...emptyBucket, ...earlier } : emptyBucket);
  const [endpoint, setEndpoint] = useState(earlier?.endpoint ?? "");
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(earlier?.name ?? null);
  const [failure, setFailure] = useState<unknown>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fields = {
    bucket: useRef<HTMLInputElement>(null),
    accessKeyId: useRef<HTMLInputElement>(null),
    secretAccessKey: useRef<HTMLInputElement>(null),
  };
  const connectButton = useRef<HTMLButtonElement>(null);
  const set = (key: keyof S3Input) => (event: { target: { value: string } }) =>
    setInput((current) => ({ ...current, [key]: event.target.value }));
  const target = (): S3Input => ({
    ...input,
    endpoint: endpoint.trim() || null,
    prefix: (input.prefix ?? "").trim(),
  });

  const connect = async () => {
    const missing: Record<string, string> = {};
    for (const key of ["bucket", "accessKeyId", "secretAccessKey"] as const) {
      if (!input[key].trim()) missing[key] = t("setup.restore.s3.required");
    }
    setErrors(missing);
    const first = (["bucket", "accessKeyId", "secretAccessKey"] as const).find((key) => missing[key]);
    if (first) {
      fields[first].current?.focus();
      return;
    }
    setLoading(true);
    setFailure(null);
    try {
      setBackups((await listBucketBackups(target())).backups);
    } catch (error) {
      setFailure(error);
      setBackups(null);
    } finally {
      setLoading(false);
    }
  };

  const next = () => {
    if (!backups || !chosen) {
      setProblem(t("setup.restore.chooseFirst"));
      if (!backups) connectButton.current?.focus();
      else document.querySelector<HTMLElement>("#restore-backups [role=radio]")?.focus();
      return;
    }
    draft.setSource(
      { type: "s3", name: chosen, ...target() },
      "s3",
      backups.find((backup) => backup.name === chosen)?.instanceUrl ?? null,
    );
    onNext();
  };

  return (
    <>
      <Field label={t("setup.restore.s3.endpoint")} hint={t("setup.restore.s3.endpointHint")}>
        <Input type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
      </Field>
      <div className="flex flex-col gap-4">
        <Field label={t("setup.restore.s3.bucket")} error={errors.bucket}>
          <Input ref={fields.bucket} value={input.bucket} onChange={set("bucket")} />
        </Field>
        <Field label={t("setup.restore.s3.prefix")}>
          <Input value={input.prefix} onChange={set("prefix")} />
        </Field>
        <Field label={t("setup.restore.s3.accessKey")} error={errors.accessKeyId}>
          <Input
            ref={fields.accessKeyId}
            autoComplete="off"
            value={input.accessKeyId}
            onChange={set("accessKeyId")}
          />
        </Field>
        <Field label={t("setup.restore.s3.secretKey")} error={errors.secretAccessKey}>
          <PasswordInput
            ref={fields.secretAccessKey}
            autoComplete="off"
            value={input.secretAccessKey}
            onChange={set("secretAccessKey")}
          />
        </Field>
        <Field label={t("setup.restore.s3.region")}>
          <Input value={input.region} onChange={set("region")} />
        </Field>
      </div>
      <p className="text-sm text-text-muted">{t("setup.restore.s3.notStored")}</p>
      <div>
        <Button ref={connectButton} variant="outline" loading={loading} onClick={() => void connect()}>
          {t("setup.restore.s3.connect")}
        </Button>
      </div>
      {failure ? (
        <FailureNotice what={t("setup.restore.s3.failed")} error={failure} onRetry={() => void connect()} />
      ) : null}
      {problem && !backups ? <p className="text-danger text-sm">{problem}</p> : null}
      {backups ? (
        <BackupList
          backups={backups}
          where={input.bucket}
          value={chosen}
          onChange={(name) => {
            setChosen(name);
            setProblem(null);
          }}
          error={problem ?? undefined}
        />
      ) : null}
      <Actions back={back} next={next} />
    </>
  );
}

function UploadPage({ back, onNext }: { back: ReactNode; onNext: () => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  const draft = useRestoreDraft();
  const input = useRef<HTMLInputElement>(null);
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [received, setReceived] = useState(0);
  const [started, setStarted] = useState<{ at: number; from: number } | null>(null);
  const [done, setDone] = useState<string | null>(draft.source?.type === "upload" ? draft.source.name : null);
  const [failure, setFailure] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    listServerBackups().then(
      (listing) => setFreeBytes(listing.freeBytes),
      () => setFreeBytes(null),
    );
    return () => abort.current?.abort();
  }, []);

  const send = async (chosen: File) => {
    setFile(chosen);
    setFailure(null);
    setProblem(null);
    setDone(null);
    if (!chosen.name.toLowerCase().endsWith(".ldbak")) {
      setProblem(t("setup.restore.upload.wrongType"));
      return;
    }
    if (freeBytes !== null && chosen.size > freeBytes) {
      setProblem(t("setup.restore.upload.tooLarge", { free: format.bytes(freeBytes) }));
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    try {
      const upload = await openUpload(chosen);
      setStarted({ at: Date.now(), from: upload.received });
      const result = await uploadFile({
        file: chosen,
        upload,
        signal: controller.signal,
        onProgress: setReceived,
      });
      setDone(result.file);
      const listed = await listServerBackups().catch(() => null);
      draft.setSource(
        { type: "upload", name: result.file ?? "" },
        "upload",
        listed?.backups.find((backup) => backup.name === result.file)?.instanceUrl ?? null,
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setFailure(error);
    } finally {
      abort.current = null;
    }
  };

  const remaining = (() => {
    if (!file || !started || received <= started.from) return null;
    const rate = (received - started.from) / Math.max(1, Date.now() - started.at);
    return Math.ceil((file.size - received) / rate / 60_000);
  })();
  const uploading = file !== null && done === null && failure === null && problem === null;

  const next = () => {
    if (!done) {
      setProblem(uploading ? t("setup.restore.upload.wait") : t("setup.restore.upload.chooseFirst"));
      input.current?.focus();
      return;
    }
    onNext();
  };

  return (
    <>
      <label
        className={`flex flex-col items-center gap-1 rounded-lg border-2 border-dashed px-6 py-8 text-center text-text-muted ${dragging ? "border-accent bg-accent-soft" : "border-control-border"}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = event.dataTransfer.files[0];
          if (dropped) void send(dropped);
        }}
      >
        <FileUp aria-hidden="true" className="size-icon-lg" />
        <span>
          {t("setup.restore.upload.drop")}{" "}
          <span className="font-medium text-accent underline">{t("setup.restore.upload.choose")}</span>
        </span>
        <span className="text-xs">
          {freeBytes === null
            ? t("setup.restore.upload.limitUnknown")
            : t("setup.restore.upload.limit", { free: format.bytes(freeBytes) })}
        </span>
        <input
          ref={input}
          type="file"
          accept=".ldbak"
          className="sr-only"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) void send(chosen);
            event.target.value = "";
          }}
        />
      </label>
      {problem ? (
        <p className="flex items-center gap-1 text-danger text-sm" role="alert">
          <CircleAlert aria-hidden="true" className="size-icon-sm" />
          {problem}
        </p>
      ) : null}
      {file || done ? (
        <div className="flex items-center gap-3 border-border border-t pt-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate font-mono text-sm" title={file?.name ?? done ?? ""}>
              {file?.name ?? done}
            </span>
            <span className="text-text-muted text-xs">
              {done
                ? [t("setup.restore.upload.done"), file ? format.bytes(file.size) : null]
                    .filter(Boolean)
                    .join(" · ")
                : file
                  ? [
                      t("setup.restore.upload.received", {
                        received: format.bytes(received),
                        total: format.bytes(file.size),
                      }),
                      remaining !== null ? t("setup.restore.upload.remaining", { count: remaining }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : null}
            </span>
            {file && !done ? (
              <div
                role="progressbar"
                aria-label={t("setup.restore.upload.progress")}
                aria-valuemin={0}
                aria-valuemax={file.size}
                aria-valuenow={received}
                className="h-1 overflow-hidden rounded-full bg-border"
              >
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.round((received / file.size) * 100)}%` }}
                />
              </div>
            ) : null}
          </div>
          {uploading ? (
            <Button variant="secondary" onClick={() => abort.current?.abort()}>
              {t("setup.restore.upload.cancel")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {failure && file ? (
        <FailureNotice
          what={
            isApiError(failure, "notEnoughSpace")
              ? t("setup.restore.upload.noSpace")
              : t("setup.restore.upload.failed")
          }
          error={failure}
          onRetry={() => void send(file)}
        />
      ) : null}
      <Actions back={back} next={next} />
    </>
  );
}

function readKeyFile(file: File): Promise<string> {
  return file.text();
}

function backupKeyFrom(text: string): string | null {
  const line = text.split(/\r?\n/).find((entry) => entry.trim().startsWith("LUNEDO_BACKUP_KEY="));
  return line ? line.trim().slice("LUNEDO_BACKUP_KEY=".length) : null;
}

function sameAddress(left: string, right: string): boolean {
  return left.replace(/\/+$/, "").toLowerCase() === right.replace(/\/+$/, "").toLowerCase();
}

function AddressChoice({
  backupUrl,
  current,
  adopt,
  onChange,
}: {
  backupUrl: string | null;
  current: string;
  adopt: boolean;
  onChange: (adopt: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="restore-address"
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <h3 id="restore-address" className="font-semibold">
        {t("setup.restore.address.title")}
      </h3>
      <p className="text-sm">
        {backupUrl
          ? t("setup.restore.address.differs", { backup: backupUrl, current })
          : t("setup.restore.address.unknown", { current })}
      </p>
      <RadioGroup
        label={t("setup.restore.address.title")}
        value={adopt ? "adopt" : "keep"}
        onValueChange={(value) => onChange(value === "adopt")}
        options={[
          {
            value: "adopt",
            label: t("setup.restore.address.adopt"),
            description: t("setup.restore.address.adoptHint", { current }),
          },
          {
            value: "keep",
            label: t("setup.restore.address.keep"),
            description: backupUrl
              ? t("setup.restore.address.keepHint", { backup: backupUrl })
              : t("setup.restore.address.keepUnknownHint"),
          },
        ]}
      />
    </section>
  );
}

function KeysPage({
  source,
  backupUrl,
  back,
  onStarted,
}: {
  source: Source;
  backupUrl: string | null;
  back: ReactNode;
  onStarted: () => void;
}) {
  const { t } = useTranslation();
  const current = globalThis.location.origin;
  const differs = backupUrl === null || !sameAddress(backupUrl, current);
  const [adopt, setAdopt] = useState(true);
  const [backupKey, setBackupKey] = useState("");
  const [keyFile, setKeyFile] = useState<{ name: string; text: string } | null>(null);
  const [errors, setErrors] = useState<{ backupKey?: string; masterKeys?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const fileButton = useRef<HTMLButtonElement>(null);

  const start = async () => {
    const found = {
      ...(backupKey.trim() ? {} : { backupKey: t("setup.restore.keys.backupKeyMissing") }),
      ...(keyFile ? {} : { masterKeys: t("setup.restore.keys.masterKeysMissing") }),
    };
    setErrors(found);
    if (found.backupKey) {
      keyInput.current?.focus();
      return;
    }
    if (found.masterKeys || !keyFile) {
      fileButton.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await startRestore({
        source,
        backupKey: backupKey.trim(),
        masterKeys: keyFile.text,
        instanceUrl: differs && adopt ? current : null,
      });
      onStarted();
    } catch (error) {
      setFailure(problemMessage(t, error));
      if (isApiError(error, "invalidKeys")) keyInput.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {failure ? (
        <Notice variant="danger" title={t("setup.restore.keys.failed")}>
          {failure}
        </Notice>
      ) : null}
      <Field
        label={t("setup.restore.keys.backupKey")}
        hint={t("setup.restore.keys.backupKeyHint")}
        error={errors.backupKey}
      >
        <PasswordInput
          ref={keyInput}
          autoComplete="off"
          value={backupKey}
          onChange={(event) => setBackupKey(event.target.value)}
        />
      </Field>
      <div className="flex flex-col gap-2">
        <span className="font-medium text-sm">{t("setup.restore.keys.masterKeys")}</span>
        <div className="flex flex-wrap items-center gap-3">
          <Button ref={fileButton} variant="outline" icon={FileUp} onClick={() => fileInput.current?.click()}>
            {t("setup.restore.keys.chooseFile")}
          </Button>
          {keyFile ? <span className="truncate font-mono text-sm">{keyFile.name}</span> : null}
        </div>
        <input
          ref={fileInput}
          type="file"
          className="sr-only"
          aria-label={t("setup.restore.keys.masterKeys")}
          aria-invalid={errors.masterKeys ? true : undefined}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (!chosen) return;
            void readKeyFile(chosen).then((text) => {
              setKeyFile({ name: chosen.name, text });
              setErrors((current) => ({ ...current, masterKeys: undefined }));
              const fromFile = backupKeyFrom(text);
              if (fromFile && !backupKey.trim()) setBackupKey(fromFile);
            });
          }}
        />
        <p className="text-sm text-text-muted">{t("setup.restore.keys.masterKeysHint")}</p>
        {errors.masterKeys ? <p className="text-danger text-sm">{errors.masterKeys}</p> : null}
      </div>
      {differs ? (
        <AddressChoice backupUrl={backupUrl} current={current} adopt={adopt} onChange={setAdopt} />
      ) : null}
      <Notice variant="warning">{t("setup.restore.keys.warning")}</Notice>
      <Actions back={back} next={() => void start()} busy={busy} nextLabel={t("setup.restore.keys.start")} />
    </>
  );
}

const STEP_ICONS = {
  waiting: CircleDashed,
  running: LoaderCircle,
  done: CircleCheck,
  failed: CircleX,
} as const;
const STEP_BADGES = { waiting: "neutral", running: "info", done: "success", failed: "danger" } as const;

function ProgressPage({ onKeys, onSource }: { onKeys: () => void; onSource: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RestoreStatus | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await restoreStatus();
        if (stopped) return;
        setStatus(next);
        setRestarting(false);
        if (next.state !== "running") return;
      } catch (error) {
        if (stopped) return;
        if (isApiError(error, "notFound")) {
          setMissing(true);
          return;
        }
        setRestarting(true);
      }
      timer = setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (missing) {
    return <Notice variant="warning">{t("setup.restore.progress.missing")}</Notice>;
  }
  const failure = status?.failure;
  return (
    <>
      {restarting ? <Notice variant="info">{t("setup.restore.progress.restarting")}</Notice> : null}
      <ul className="flex flex-col">
        {(status?.steps ?? []).map((step) => {
          const StepIcon = STEP_ICONS[step.state];
          return (
            <li key={step.id} className="flex items-center gap-3 border-border border-t py-3">
              <StepIcon
                aria-hidden="true"
                className={`size-icon-md shrink-0 ${step.state === "running" ? "animate-spin motion-reduce:animate-none" : ""}`}
              />
              <span className="min-w-0 flex-1">{t(`setup.restore.progress.steps.${step.id}`)}</span>
              <Badge variant={STEP_BADGES[step.state]}>
                {t(`setup.restore.progress.states.${step.state}`)}
              </Badge>
            </li>
          );
        })}
      </ul>
      {failure ? (
        <Notice variant="danger" title={t("setup.restore.progress.failedTitle")}>
          <span className="flex flex-col gap-2">
            <span>{t(`setup.restore.progress.failures.${failure.code}`)}</span>
            <span className="font-mono text-xs">{failure.message}</span>
          </span>
        </Notice>
      ) : null}
      {status &&
      (status.address.requested ||
        (status.address.backup && !sameAddress(status.address.backup, globalThis.location.origin))) ? (
        <p className="text-sm">
          {status.address.backup
            ? t("setup.restore.address.differs", {
                backup: status.address.backup,
                current: globalThis.location.origin,
              })
            : t("setup.restore.address.unknown", { current: globalThis.location.origin })}{" "}
          {status.state !== "done"
            ? status.address.requested
              ? t("setup.restore.address.willAdopt")
              : t("setup.restore.address.willKeep")
            : status.address.adopted
              ? t("setup.restore.address.adopted")
              : status.address.requested
                ? t("setup.restore.address.configured")
                : t("setup.restore.address.kept")}
        </p>
      ) : null}
      {status?.state === "done" ? (
        <Notice variant="success" title={t("setup.restore.progress.doneTitle")}>
          {t("setup.restore.progress.paused")}
        </Notice>
      ) : (
        <p className="text-sm text-text-muted">{t("setup.restore.progress.paused")}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {failure ? (
          <>
            <Button variant="secondary" onClick={onSource}>
              {t("setup.restore.progress.otherBackup")}
            </Button>
            <Button variant="primary" onClick={onKeys}>
              {t("setup.restore.progress.checkKeys")}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            disabled={status?.state !== "done" || restarting}
            aria-describedby="restore-wait"
            onClick={() => globalThis.location.assign("/sign-in")}
          >
            {t("setup.restore.progress.toSignIn")}
          </Button>
        )}
      </div>
      {(status?.state !== "done" || restarting) && !failure ? (
        <p id="restore-wait" className="text-right text-sm text-text-muted">
          {t("setup.restore.progress.wait")}
        </p>
      ) : null}
    </>
  );
}
