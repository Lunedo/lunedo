import { accountNameSchema, emailSchema, JOB_TITLE_MAX_LENGTH, jobTitleSchema } from "@lunedo/shared";
import {
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  Notice,
  Section,
  SettingRow,
  Skeleton,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageUp, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { securityQuery } from "../../api/account-queries.js";
import { api } from "../../api/client.js";
import { queryKeys } from "../../api/queries.js";
import { request } from "../../api/request.js";
import { AutoSaveTextRow } from "../../components/auto-save.js";
import { IMAGE_TYPES, isUploadableImage, toBase64 } from "../../components/image-upload.js";
import { OwnIdentities } from "../../components/linked-identities.js";
import { PersonAvatar } from "../../components/person-avatar.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { useInlineReauthentication } from "../../session/reauthentication.js";
import { useSession } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const profileKey = ["account", "profile"] as const;

function useProfile() {
  return useQuery({
    queryKey: profileKey,
    queryFn: () => request(() => api.GET("/api/v1/account/profile")),
  });
}

export function ProfileScreen() {
  const { t } = useTranslation();
  const profile = useProfile();
  return (
    <SettingsPage title={t("profile.title")} description={t("profile.description")}>
      <Section title={t("profile.details")}>
        {profile.isError ? (
          <LoadError
            what={t("failures.loadProfile")}
            error={profile.error}
            onRetry={() => void profile.refetch()}
          />
        ) : profile.data ? (
          <ProfileRows profile={profile.data} />
        ) : (
          <Skeleton className="h-12 w-full" />
        )}
        <EmailRow />
      </Section>
      <Section title={t("identities.title")}>
        <OwnIdentities />
      </Section>
    </SettingsPage>
  );
}

type Profile = {
  name: string;
  jobTitle: string | null;
  pictureRef: string | null;
  nameProvider: string | null;
};

function ProfileRows({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const save = async (body: { name?: string; jobTitle?: string | null }) => {
    const updated = await request(() => api.PATCH("/api/v1/account/profile", { body }));
    queryClient.setQueryData(profileKey, updated);
    await queryClient.invalidateQueries({ queryKey: queryKeys.session });
  };
  return (
    <>
      <PictureRow profile={profile} />
      <AutoSaveTextRow
        label={t("profile.displayName")}
        value={profile.name}
        schema={accountNameSchema}
        disabled={profile.nameProvider !== null}
        {...(profile.nameProvider
          ? { hint: t("profile.displayNameFrom", { provider: profile.nameProvider }) }
          : {})}
        onSave={(name) => save({ name })}
      />
      <AutoSaveTextRow
        label={t("profile.jobTitle")}
        hint={t("profile.jobTitleHint")}
        help={t("profile.jobTitleHelp")}
        value={profile.jobTitle ?? ""}
        schema={jobTitleSchema}
        maxLength={JOB_TITLE_MAX_LENGTH}
        onSave={(jobTitle) => save({ jobTitle: jobTitle === "" ? null : jobTitle })}
      />
    </>
  );
}

function PictureRow({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const session = useSession();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const accountId = session.account?.id ?? null;
  const applied = async (updated: Profile) => {
    queryClient.setQueryData(profileKey, updated);
    await queryClient.invalidateQueries({ queryKey: queryKeys.session });
  };

  const upload = async (file: File) => {
    if (!isUploadableImage(file)) {
      toast({
        title: t("failures.uploadPicture"),
        description: t("problems.invalidPicture"),
        variant: "error",
      });
      return;
    }
    setBusy(true);
    try {
      const data = await toBase64(file);
      await applied(
        await request(() =>
          api.PUT("/api/v1/account/profile/picture", { body: { contentType: file.type, data } }),
        ),
      );
      toast({ title: t("profile.pictureUploaded"), variant: "success" });
    } catch (failure) {
      showFailure(t("failures.uploadPicture"), failure, () => void upload(file));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <SettingRow
      label={t("profile.picture")}
      description={t("profile.pictureHint")}
      help={t("profile.pictureHelp")}
      control={
        <div className="flex flex-wrap items-center gap-3">
          <PersonAvatar id={accountId} name={profile.name} pictureRef={profile.pictureRef} size="lg" />
          <input
            ref={input}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            className="sr-only"
            aria-label={t("profile.uploadPicture")}
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button variant="outline" icon={ImageUp} loading={busy} onClick={() => input.current?.click()}>
            {profile.pictureRef ? t("profile.replacePicture") : t("profile.uploadPicture")}
          </Button>
          {profile.pictureRef ? (
            <Button variant="danger" icon={Trash2} onClick={() => setRemoving(true)}>
              {t("profile.removePicture")}
            </Button>
          ) : null}
          <ConfirmDialog
            open={removing}
            onOpenChange={setRemoving}
            title={t("profile.removePictureTitle")}
            description={t("profile.removePictureDescription")}
            confirmLabel={t("profile.removePicture")}
            cancelLabel={t("common.cancel")}
            destructive
            onConfirm={async () => {
              try {
                await applied(await request(() => api.DELETE("/api/v1/account/profile/picture")));
                setRemoving(false);
                toast({ title: t("profile.pictureRemoved"), variant: "success" });
              } catch (failure) {
                showFailure(t("failures.removePicture"), failure);
              }
            }}
          />
        </div>
      }
    />
  );
}

export function EmailRow() {
  const { t } = useTranslation();
  const session = useSession();
  const security = useQuery({ ...securityQuery, throwOnError: false });
  const [open, setOpen] = useState(false);
  const managedBy = security.data?.managedBy ?? null;
  return (
    <>
      <SettingRow
        label={t("auth.email")}
        description={session.account?.email ?? ""}
        control={
          security.isPending ? (
            <Skeleton className="h-control-md w-full" />
          ) : managedBy ? (
            <span className="text-sm text-text-muted">
              {t("security.managed.emailFrom", { provider: managedBy.providerName })}
            </span>
          ) : (
            <Button variant="outline" onClick={() => setOpen(true)}>
              {t("security.changeEmail")}
            </Button>
          )
        }
      />
      <ChangeEmailDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

const emailForm = z.object({ email: emailSchema });

function ChangeEmailDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const reauthentication = useInlineReauthentication(open);
  const form = useSchemaForm(emailForm, { defaultValues: { email: "" } });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(() => api.POST("/api/v1/account/email", { body: values }));
      toast({ title: t("security.emailConfirmationSent"), variant: "success" });
      form.reset();
      onOpenChange(false);
    } catch (failure) {
      if (!applyServerFieldErrors(form, t, failure)) setError(problemMessage(t, failure));
    }
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("security.changeEmail")}
      description={t("security.changeEmailDescription")}
      size="sm"
    >
      {reauthentication.panel}
      <form
        className="flex flex-col gap-4"
        noValidate
        hidden={reauthentication.active}
        onSubmit={submitWith(submit)}
      >
        {error ? (
          <Notice variant="danger" title={t("failures.changeEmail")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("security.newEmail")} error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...form.register("email")} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            {t("security.sendConfirmation")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
