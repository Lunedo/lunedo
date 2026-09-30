import { tokens } from "@pagehall/tokens";
import { Rail, RailButton, useColorMode } from "@pagehall/ui";
import {
  Bell,
  CircleHelp,
  CircleUserRound,
  FolderKanban,
  House,
  LayoutGrid,
  type LucideIcon,
  Plus,
  Search,
  Settings,
  Star,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import markPetrol from "./assets/logo/pagehall-mark-petrol.svg";
import markWhite from "./assets/logo/pagehall-mark-white.svg";

function RailIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden="true" className="size-icon-lg" strokeWidth={tokens.icon.strokeWidth} />;
}

function Logo() {
  const { t } = useTranslation();
  return (
    <a
      href="/"
      aria-label={t("rail.home")}
      className="flex size-10 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-accent"
    >
      <img src={markPetrol} alt="" className="size-8 dark:hidden" />
      <img src={markWhite} alt="" className="hidden size-8 dark:block" />
    </a>
  );
}

export function App() {
  useColorMode("system");
  const { t } = useTranslation();

  return (
    <div className="flex h-full bg-bg text-text">
      <Rail
        label={t("rail.label")}
        logo={<Logo />}
        footer={
          <>
            <RailButton label={t("rail.help")} icon={<RailIcon icon={CircleHelp} />} />
            <RailButton label={t("rail.settings")} icon={<RailIcon icon={Settings} />} />
            <RailButton label={t("rail.account")} icon={<RailIcon icon={CircleUserRound} />} />
          </>
        }
      >
        <RailButton label={t("rail.create")} icon={<RailIcon icon={Plus} />} variant="primary" />
        <RailButton label={t("rail.forYou")} icon={<RailIcon icon={House} />} current />
        <RailButton label={t("rail.search")} icon={<RailIcon icon={Search} />} />
        <RailButton label={t("rail.starred")} icon={<RailIcon icon={Star} />} />
        <RailButton label={t("rail.spaces")} icon={<RailIcon icon={LayoutGrid} />} />
        <RailButton label={t("rail.projects")} icon={<RailIcon icon={FolderKanban} />} />
        <RailButton label={t("rail.notifications")} icon={<RailIcon icon={Bell} />} />
      </Rail>
      <main className="min-w-0 flex-1" />
    </div>
  );
}
