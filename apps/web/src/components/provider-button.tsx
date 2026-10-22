import { Button } from "@lunedo/ui";
import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { providerLogoUrl, type SignInProvider } from "../api/identity-queries.js";
import "../assets/brands/brands.css";
import googleLogo from "../assets/brands/google-logo.svg";
import microsoftLogo from "../assets/brands/microsoft-logo.svg";

export function ProviderButton({
  provider,
  busy,
  onClick,
}: {
  provider: Pick<SignInProvider, "id" | "name" | "preset" | "logoRef">;
  busy: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  if (provider.preset === "entraId" || provider.preset === "google") {
    const microsoft = provider.preset === "entraId";
    return (
      <button
        type="button"
        className={`brand-sign-in ${microsoft ? "brand-sign-in-microsoft" : "brand-sign-in-google"}`}
        disabled={busy}
        aria-busy={busy}
        onClick={onClick}
      >
        <img src={microsoft ? microsoftLogo : googleLogo} alt="" />
        <span>
          {microsoft ? t("auth.providers.signInWithMicrosoft") : t("auth.providers.signInWithGoogle")}
        </span>
      </button>
    );
  }
  const logo = providerLogoUrl(provider);
  return (
    <Button
      variant="outline"
      size="lg"
      block
      loading={busy}
      {...(logo ? {} : { icon: KeyRound })}
      onClick={onClick}
    >
      {logo ? <img src={logo} alt="" className="size-icon-md" /> : null}
      {t("auth.providers.continueWith", { name: provider.name })}
    </Button>
  );
}
