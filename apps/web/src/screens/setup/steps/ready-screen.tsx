import { Button } from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../../api/queries.js";
import { SetupFrame } from "../setup-frame.js";

type Target = { href: string };

export function ReadyScreen({ organizationId }: { organizationId: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const open = async ({ href }: Target) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.instanceInfo });
    await navigate({ href });
  };
  const next: { key: "invite" | "space" | "provider"; href: string }[] = [
    ...(organizationId
      ? [{ key: "invite" as const, href: `/settings/organizations/${organizationId}/members` }]
      : []),
    { key: "space", href: "/spaces" },
    { key: "provider", href: "/settings/instance/sign-in-providers" },
  ];
  return (
    <SetupFrame title={t("setup.ready.title")} description={t("setup.ready.description")}>
      <ol className="flex flex-col">
        {next.map((item, index) => (
          <li key={item.key} className="flex items-center gap-3 border-border border-t py-3">
            <span
              aria-hidden="true"
              className="inline-flex size-control-md shrink-0 items-center justify-center rounded-md bg-accent-soft font-bold text-accent"
            >
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">{t(`setup.ready.${item.key}.title`)}</span>
              <span className="text-sm text-text-muted">{t(`setup.ready.${item.key}.description`)}</span>
            </div>
            <Button variant="outline" onClick={() => void open(item)}>
              {t(`setup.ready.${item.key}.action`)}
            </Button>
          </li>
        ))}
      </ol>
      <div>
        <Button variant="primary" size="lg" onClick={() => void open({ href: "/" })}>
          {t("setup.ready.forYou")}
        </Button>
      </div>
    </SetupFrame>
  );
}
