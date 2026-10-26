import { Button, EmptyState, Field, Input, Spinner } from "@lunedo/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { ExternalLink, Link2Off } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/request.js";
import { problemMessage } from "../errors/problem-message.js";
import { blogPostPath, pagePath } from "../spaces/space-queries.js";
import { looksLikeConfluenceLink, type ResolvedLink, resolveConfluenceLink } from "./reimport-api.js";

export function linkTarget(link: ResolvedLink): string {
  return link.kind === "blogPost"
    ? blogPostPath(link.spaceKey, link.number, link.slug)
    : pagePath(link.spaceKey, link.number, link.slug);
}

export function useConfluenceLink() {
  const navigate = useNavigate();
  return async (url: string, options: { replace?: boolean } = {}) => {
    const link = await resolveConfluenceLink(url);
    await navigate({ to: linkTarget(link), ...(options.replace ? { replace: true } : {}) });
  };
}

export function ConfluenceLinkField() {
  const { t } = useTranslation();
  const open = useConfluenceLink();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!looksLikeConfluenceLink(value)) {
      setError(t("imports.links.invalid"));
      input.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      await open(value);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === "notFound"
          ? t("imports.links.notFound")
          : t("imports.links.failed", { cause: problemMessage(t, caught) }),
      );
      input.current?.focus();
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2" noValidate>
      <Field
        label={t("imports.links.label")}
        hint={t("imports.links.hint")}
        error={error ?? undefined}
        id={id}
      >
        <div className="flex flex-wrap gap-2">
          <Input
            ref={input}
            id={id}
            className="min-w-0 flex-1"
            value={value}
            invalid={error !== null}
            placeholder={t("imports.links.placeholder")}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
          />
          <Button type="submit" variant="secondary" icon={ExternalLink} loading={pending}>
            {t("imports.links.open")}
          </Button>
        </div>
      </Field>
    </form>
  );
}

export function ConfluenceRedirectScreen() {
  const { t } = useTranslation();
  const open = useConfluenceLink();
  const [failed, setFailed] = useState<"notFound" | "error" | null>(null);
  const started = useRef(false);
  const address = `${window.location.pathname.replace(/^\/confluence/, "")}${window.location.search}`;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    open(address, { replace: true }).catch((caught: unknown) => {
      setFailed(caught instanceof ApiError && caught.code === "notFound" ? "notFound" : "error");
    });
  }, [address, open]);

  if (!failed) {
    return (
      <div className="flex items-center justify-center gap-3 py-10 text-text-muted">
        <Spinner label={t("imports.links.redirecting")} />
        <span>{t("imports.links.redirecting")}</span>
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-content flex-col gap-4 px-4 py-10">
      <EmptyState
        icon={Link2Off}
        title={t(failed === "notFound" ? "imports.links.notFoundTitle" : "imports.links.failedTitle")}
        description={t(
          failed === "notFound" ? "imports.links.notFoundDescription" : "imports.links.failedDescription",
        )}
        action={
          <Link
            to="/"
            className="inline-flex h-control-md items-center rounded-md border border-control-border px-3 font-medium hover:bg-hover focus-visible:focus-ring"
          >
            {t("imports.links.home")}
          </Link>
        }
      />
    </div>
  );
}
