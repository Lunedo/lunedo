import { Button, Notice, SegmentedControl } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Fingerprint } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { securityQuery } from "../../api/account-queries.js";
import { api } from "../../api/client.js";
import { queryKeys } from "../../api/queries.js";
import { request } from "../../api/request.js";
import { RecoveryCodes } from "../../components/recovery-codes.js";
import { TotpEnrollment } from "../../components/totp-enrollment.js";
import { problemMessage } from "../../errors/problem-message.js";
import { createPasskey, isPasskeyCancelled, passkeysSupported } from "../../session/passkeys.js";
import { AuthCard } from "./auth-layout.js";

type Method = "totp" | "passkey";

export function SecondFactorSetupScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const security = useQuery({ ...securityQuery, throwOnError: false });
  const requiredBy = security.data?.secondFactorRequiredBy;
  const [method, setMethod] = useState<Method>("totp");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = async (recoveryCodes: string[] | null) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    if (recoveryCodes && recoveryCodes.length > 0) setCodes(recoveryCodes);
    else await navigate({ to: "/" });
  };

  const addPasskey = async () => {
    setError(null);
    setBusy(true);
    try {
      const options = await request(() => api.POST("/api/v1/account/passkeys/registration-options"));
      const response = await createPasskey(options);
      const added = await request(() =>
        api.POST("/api/v1/account/passkeys", {
          body: { response: response as never, name: t("security.defaultPasskeyName") },
        }),
      );
      await done(added.recoveryCodes);
    } catch (failure) {
      setError(isPasskeyCancelled(failure) ? t("auth.passkeyCancelled") : problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <AuthCard title={t("security.recoveryCodes")}>
        <RecoveryCodes codes={codes} />
        <Button variant="primary" block onClick={() => void navigate({ to: "/" })}>
          {t("auth.continue")}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("auth.secondFactorSetupTitle")}
      description={requiredBy ? t(`auth.secondFactorSetupDescription.${requiredBy}`) : undefined}
      wide
    >
      {passkeysSupported() ? (
        <SegmentedControl
          label={t("auth.secondFactorMethod")}
          value={method}
          onValueChange={(value) => setMethod(value as Method)}
          options={[
            { value: "totp", label: t("security.authenticatorApp") },
            { value: "passkey", label: t("security.passkey") },
          ]}
        />
      ) : null}
      {error ? (
        <Notice variant="danger" title={t("failures.setUpSecondFactor")}>
          {error}
        </Notice>
      ) : null}
      {method === "totp" ? (
        <TotpEnrollment
          queryKey={["account", "totp", "enrollment"]}
          begin={() => request(() => api.POST("/api/v1/account/totp"))}
          confirm={async (code) => {
            const result = await request(() => api.POST("/api/v1/account/totp/confirm", { body: { code } }));
            await done(result.recoveryCodes);
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Notice variant="info">{t("auth.passkeyHint")}</Notice>
          <Button variant="primary" icon={Fingerprint} loading={busy} onClick={() => void addPasskey()}>
            {t("security.addPasskey")}
          </Button>
        </div>
      )}
    </AuthCard>
  );
}
