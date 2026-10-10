import {
  Button,
  Checkbox,
  ErrorState,
  Field,
  focusFirstInvalidSoon,
  Input,
  Notice,
  PasswordInput,
  RadioGroup,
  Section,
} from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { problemMessage } from "../errors/problem-message.js";
import { type ImportView, importKeys, setPeopleSource, setUserList } from "./imports-api.js";
import { UserListField } from "./user-list-field.js";

export type PeopleChoice = "token" | "list" | "skip";

export function PeopleStep({
  entry,
  choice,
  onChoice,
  error,
}: {
  entry: ImportView;
  choice: PeopleChoice;
  onChoice: (choice: PeopleChoice) => void;
  error: string | undefined;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const source = entry.peopleSource;
  const store = (updated: ImportView) => queryClient.setQueryData(importKeys.detail(entry.id), updated);
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState<unknown>(null);

  const listResult =
    source?.kind === "list"
      ? t("imports.people.listResult", { people: source.people ?? 0, withEmail: source.withEmail ?? 0 })
      : null;

  return (
    <>
      <Notice variant="info">{t("imports.people.intro")}</Notice>
      <Section title={t("imports.people.title")}>
        <div className="flex flex-col gap-3 p-4">
          <RadioGroup
            label={t("imports.people.title")}
            variant="card"
            value={choice}
            onValueChange={(value) => onChoice(value as PeopleChoice)}
            options={(["token", "list", "skip"] as const).map((value) => ({
              value,
              label: t(`imports.people.${value}.label`),
              description: t(`imports.people.${value}.description`),
            }))}
          />
          {error ? (
            <p role="alert" className="text-sm text-danger" data-invalid="">
              {error}
            </p>
          ) : null}
          {choice === "token" ? <TokenForm entry={entry} onSaved={store} /> : null}
          {choice === "list" ? (
            <UserListField
              result={listResult}
              onRead={async (text) => {
                store(await setUserList(entry.id, text));
              }}
            />
          ) : null}
          {choice === "skip" ? (
            <div className="flex flex-col gap-2">
              <Checkbox
                checked={source?.kind === "skip"}
                onCheckedChange={(checked) => {
                  if (!checked || skipping || source?.kind === "skip") return;
                  setSkipping(true);
                  setSkipError(null);
                  setPeopleSource(entry.id, { kind: "skip", confirmed: true })
                    .then(store)
                    .catch((failure: unknown) => setSkipError(failure))
                    .finally(() => setSkipping(false));
                }}
                label={t("imports.people.skip.confirm")}
              />
              {skipError ? (
                <ErrorState title={t("imports.people.saveFailed")} cause={problemMessage(t, skipError)} />
              ) : null}
            </div>
          ) : null}
        </div>
      </Section>
    </>
  );
}

function TokenForm({ entry, onSaved }: { entry: ImportView; onSaved: (entry: ImportView) => void }) {
  const { t } = useTranslation();
  const connected = entry.peopleSource?.kind === "token" ? entry.peopleSource : null;
  const [editing, setEditing] = useState(connected === null);
  const [site, setSite] = useState(connected?.site ?? "");
  const [email, setEmail] = useState(connected?.email ?? "");
  const [token, setToken] = useState("");
  const [errors, setErrors] = useState<{ site?: string; email?: string; token?: string }>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    const next: typeof errors = {};
    if (!site.trim()) next.site = t("imports.people.token.siteRequired");
    if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) next.email = t("imports.people.token.emailInvalid");
    if (!token.trim()) next.token = t("imports.people.token.tokenRequired");
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0) {
      focusFirstInvalidSoon();
      return;
    }
    setChecking(true);
    try {
      onSaved(
        await setPeopleSource(entry.id, {
          kind: "token",
          site: site.trim(),
          email: email.trim(),
          token: token.trim(),
        }),
      );
      setToken("");
      setEditing(false);
    } catch (error) {
      setFailure(error);
    } finally {
      setChecking(false);
    }
  };

  if (connected && !editing) {
    return (
      <Notice
        variant="success"
        title={t("imports.people.token.connected", { site: connected.site ?? "" })}
        action={
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t("imports.people.token.replace")}
          </Button>
        }
      >
        {connected.people === null
          ? t("imports.people.token.connectedPlain")
          : t("imports.people.token.found", {
              people: connected.people,
              withEmail: connected.withEmail ?? 0,
            })}
      </Notice>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void check();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label={t("imports.people.token.site")}
          hint={t("imports.people.token.siteHint")}
          {...(errors.site ? { error: errors.site } : {})}
        >
          <Input
            value={site}
            spellCheck={false}
            autoComplete="off"
            placeholder={t("imports.people.token.sitePlaceholder")}
            onChange={(event) => setSite(event.target.value)}
          />
        </Field>
        <Field label={t("imports.people.token.email")} {...(errors.email ? { error: errors.email } : {})}>
          <Input
            type="email"
            value={email}
            autoComplete="off"
            placeholder={t("imports.people.token.emailPlaceholder")}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
      </div>
      <Field
        label={t("imports.people.token.token")}
        hint={t("imports.people.token.tokenHint")}
        {...(errors.token ? { error: errors.token } : {})}
      >
        <PasswordInput
          value={token}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          onChange={(event) => setToken(event.target.value)}
        />
      </Field>
      {failure ? (
        <ErrorState
          title={t("imports.people.token.checkFailed")}
          cause={problemMessage(t, failure)}
          action={t("imports.people.token.checkFailedAction")}
        />
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {connected ? (
          <Button
            variant="secondary"
            onClick={() => {
              setEditing(false);
              setToken("");
              setErrors({});
              setFailure(null);
            }}
          >
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button type="submit" variant="secondary" loading={checking}>
          {t("imports.people.token.check")}
        </Button>
      </div>
    </form>
  );
}
