import { Avatar, Menu, RailButton } from "@lunedo/ui";
import { useNavigate } from "@tanstack/react-router";
import { LockKeyhole, LogOut, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShell } from "./shell.js";
import { useSession } from "./shell-context.js";

export function AccountRailItem() {
  const { t } = useTranslation();
  const session = useSession();
  const shell = useShell();
  const navigate = useNavigate();
  const name = session.account?.name ?? "";
  return (
    <Menu
      align="start"
      trigger={<RailButton label={t("rail.account")} icon={<Avatar name={name} size="sm" />} />}
      items={[
        { type: "label", label: session.account?.email ?? name },
        {
          label: t("navigation.preferences"),
          icon: Palette,
          onSelect: () => void navigate({ to: "/settings/preferences" }),
        },
        {
          label: t("navigation.signInAndSecurity"),
          icon: LockKeyhole,
          onSelect: () => void navigate({ to: "/settings/security" }),
        },
        { type: "separator" },
        { label: t("commands.signOut"), icon: LogOut, onSelect: shell.signOut },
      ]}
    />
  );
}
