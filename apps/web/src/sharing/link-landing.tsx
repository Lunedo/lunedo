import { Button, buttonClassName, Field, Notice, PasswordInput, Skeleton, useToast } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { FileText, Link2Off, LockKeyhole, LogIn, Paperclip } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { instanceInfoQuery } from "../api/queries.js";
import { ApiError, networkError, request, toApiError } from "../api/request.js";
import { PageReadView } from "../editor/read-view.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import type { ImageSize } from "../files/attachments-api.js";
import { typeLabel } from "../files/file-preview.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { LunedoMark } from "../shell/lunedo-mark.js";
import { Redirect } from "../spaces/redirect.js";
import { sharedPath } from "../spaces/space-queries.js";

const route = getRouteApi("/s/$token");

const NO_REFERENCES = { people: {}, pages: {} };

type State =
  | { kind: "opening" }
  | { kind: "account"; itemId: string }
  | { kind: "anonymous"; unlock: string | null }
  | { kind: "password"; error: string | null }
  | { kind: "failed"; error: unknown };

function attachmentHref(
  token: string,
  attachmentId: string,
  options: { download?: boolean; size?: ImageSize } = {},
): string {
  const query = new URLSearchParams();
  if (options.download) query.set("download", "true");
  if (options.size) query.set("size", options.size);
  const suffix = query.toString();
  return `/api/v1/share-links/${encodeURIComponent(token)}/attachments/${attachmentId}/content${suffix ? `?${suffix}` : ""}`;
}

async function attachmentBlob(
  token: string,
  attachmentId: string,
  unlock: string,
  size?: ImageSize,
): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(attachmentHref(token, attachmentId, size ? { size } : {}), {
      headers: { "x-lunedo-unlock": unlock },
    });
  } catch {
    throw networkError();
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw toApiError(response, body);
  }
  return response.blob();
}

function useImageUrls(token: string, unlock: string | null, images: readonly string[]) {
  const blobs = useQuery({
    queryKey: ["shareLinkImages", token, unlock, images],
    enabled: unlock !== null && images.length > 0,
    throwOnError: false,
    gcTime: 0,
    queryFn: async () =>
      new Map(
        await Promise.all(
          images.map(
            async (id) =>
              [id, URL.createObjectURL(await attachmentBlob(token, id, unlock ?? "", "display"))] as const,
          ),
        ),
      ),
  });
  useEffect(() => {
    const urls = blobs.data;
    return () => {
      for (const url of urls?.values() ?? []) URL.revokeObjectURL(url);
    };
  }, [blobs.data]);
  return (id: string, _version?: number, size?: ImageSize) =>
    unlock === null ? attachmentHref(token, id, size ? { size } : {}) : (blobs.data?.get(id) ?? "");
}

function DownloadLink({
  token,
  unlock,
  attachment,
}: {
  token: string;
  unlock: string | null;
  attachment: { id: string; name: string };
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const className = "min-h-hit px-2 text-accent underline focus-visible:focus-ring";
  if (unlock === null) {
    return (
      <a
        href={attachmentHref(token, attachment.id, { download: true })}
        download={attachment.name}
        className={className}
      >
        {t("files.download")}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() =>
        void attachmentBlob(token, attachment.id, unlock).then(
          (blob) => {
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = attachment.name;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
          },
          (error: unknown) =>
            toast({
              title: t("sharing.landing.downloadFailed"),
              description: problemMessage(t, error),
              variant: "error",
            }),
        )
      }
    >
      {t("files.download")}
    </button>
  );
}

function AnonymousPage({ token, unlock }: { token: string; unlock: string | null }) {
  const { t } = useTranslation();
  const format = useFormat();
  const page = useQuery({
    queryKey: ["shareLinkPage", token, unlock],
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/share-links/{token}/page", {
          params: { path: { token } },
          ...(unlock ? { headers: { "x-lunedo-unlock": unlock } } : {}),
        }),
      ),
    throwOnError: false,
    retry: false,
  });
  const urlOf = useImageUrls(
    token,
    unlock,
    (page.data?.attachments ?? [])
      .filter((attachment) => attachment.preview === "image" && !attachment.tooLargeForPreview)
      .map((attachment) => attachment.id),
  );
  if (page.isPending) return <Skeleton className="h-card w-full" />;
  if (page.isError) {
    return (
      <LoadError what={t("sharing.landing.pageFailed")} error={page.error} onRetry={() => page.refetch()} />
    );
  }
  const data = page.data;
  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <FileText aria-hidden="true" className="size-icon-lg shrink-0 text-text-muted" />
          {data.title}
        </h1>
        <p className="text-sm text-text-muted">
          {t("sharing.landing.updated", { date: format.date(data.updatedAt) })}
        </p>
      </header>
      <PageReadView
        document={data.document}
        references={{
          ...NO_REFERENCES,
          tooLargeImages: data.attachments
            .filter((attachment) => attachment.tooLargeForPreview)
            .map((attachment) => attachment.id),
        }}
        pageId={data.itemId}
        attachments={{ url: urlOf, onOpen: () => undefined }}
        embedServices={data.embedServices}
      />
      {data.attachments.length > 0 ? (
        <section
          aria-labelledby="link-attachments"
          className="flex flex-col gap-2 border-t border-border pt-4"
        >
          <h2 id="link-attachments" className="flex items-center gap-2 font-semibold">
            <Paperclip aria-hidden="true" className="size-icon-md" />
            {t("files.title")}
          </h2>
          <ul className="flex flex-col divide-y divide-border">
            {data.attachments.map((attachment) => (
              <li key={attachment.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate font-medium" title={attachment.name}>
                  {attachment.name}
                </span>
                <span className="text-sm text-text-muted">
                  {typeLabel(t, attachment)} · {format.bytes(attachment.size)}
                </span>
                <DownloadLink token={token} unlock={unlock} attachment={attachment} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function PasswordForm({
  error,
  onSubmit,
}: {
  error: string | null;
  onSubmit: (password: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (error) input.current?.focus();
  }, [error]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) {
      setMissing(true);
      input.current?.focus();
      return;
    }
    setMissing(false);
    setBusy(true);
    try {
      await onSubmit(password);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <LockKeyhole aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
          {t("sharing.landing.passwordTitle")}
        </h1>
        <p className="text-sm text-text-muted">{t("sharing.landing.password")}</p>
      </div>
      <Field
        label={t("sharing.links.password")}
        error={missing ? t("sharing.landing.passwordMissing") : error}
      >
        <PasswordInput
          ref={input}
          autoComplete="off"
          value={password}
          invalid={missing || error !== null}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" loading={busy} className="self-start">
        {t("sharing.landing.open")}
      </Button>
    </form>
  );
}

function Failure({ error, token, onRetry }: { error: unknown; token: string; onRetry: () => void }) {
  const { t } = useTranslation();
  const code = error instanceof ApiError ? error.code : null;
  if (code === "signInRequired" || code === "linkNotForYou") {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <LogIn aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
          {code === "signInRequired" ? t("sharing.landing.signInTitle") : t("sharing.landing.notForYouTitle")}
        </h1>
        <p className="text-sm text-text-muted">{problemMessage(t, error)}</p>
        {code === "signInRequired" ? (
          <Link
            to="/sign-in"
            search={{ redirect: `/s/${token}` }}
            className={`${buttonClassName({ variant: "primary" })} self-start`}
          >
            {t("sharing.landing.signIn")}
          </Link>
        ) : null}
      </div>
    );
  }
  if (code === "linkNotFound" || code === "notFound") {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Link2Off aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
          {t("sharing.landing.goneTitle")}
        </h1>
        <p className="text-sm text-text-muted">{problemMessage(t, error)}</p>
      </div>
    );
  }
  return (
    <Notice
      variant="danger"
      title={t("sharing.landing.failed")}
      action={
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t("files.retry")}
        </Button>
      }
    >
      {problemMessage(t, error)}
    </Notice>
  );
}

function LandingCard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const info = useQuery({ ...instanceInfoQuery, throwOnError: false });
  return (
    <div className="flex min-h-screen items-start justify-center bg-surface-sunken px-4 pt-12 pb-12">
      <div className="flex w-full max-w-dialog-sm flex-col gap-6 rounded-lg border border-border bg-bg p-6">
        <p className="flex items-center gap-2 text-sm">
          <LunedoMark className="h-6" />
          <span className="font-semibold">{t("brand.name")}</span>
          {info.data?.name ? <span className="text-text-muted">· {info.data.name}</span> : null}
        </p>
        {children}
      </div>
    </div>
  );
}

export function LinkLandingScreen() {
  const { t } = useTranslation();
  const { token } = route.useParams();
  const [state, setState] = useState<State>({ kind: "opening" });
  const open = async (password?: string) => {
    try {
      const opened = await request(() =>
        api.POST("/api/v1/share-links/{token}/open", {
          params: { path: { token } },
          body: password ? { password } : {},
        }),
      );
      setState(
        opened.kind === "account"
          ? { kind: "account", itemId: opened.itemId }
          : { kind: "anonymous", unlock: opened.unlock },
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === "passwordRequired" || error.code === "wrongPassword")
      ) {
        setState({ kind: "password", error: password ? problemMessage(t, error) : null });
        return;
      }
      setState({ kind: "failed", error });
    }
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void open();
  });
  if (state.kind === "account") return <Redirect to={sharedPath(state.itemId, "")} />;
  if (state.kind !== "anonymous") {
    return (
      <main id="main" tabIndex={-1} className="outline-none">
        <LandingCard>
          {state.kind === "opening" ? <Skeleton className="h-field w-full" /> : null}
          {state.kind === "password" ? (
            <PasswordForm error={state.error} onSubmit={(password) => open(password)} />
          ) : null}
          {state.kind === "failed" ? (
            <Failure error={state.error} token={token} onRetry={() => void open()} />
          ) : null}
        </LandingCard>
      </main>
    );
  }
  return (
    <main id="main" tabIndex={-1} className="min-h-screen bg-bg outline-none">
      <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 pt-8 pb-12 md:px-8">
        <p className="text-sm text-text-muted">{t("sharing.landing.banner")}</p>
        <AnonymousPage token={token} unlock={state.unlock} />
      </div>
    </main>
  );
}
