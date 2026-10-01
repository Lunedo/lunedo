import { Button, EmptyState } from "@pagehall/ui";
import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import { CircleAlert, Compass, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isApiError } from "../api/request.js";
import { problemMessage } from "./problem-message.js";

export function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <EmptyState
        icon={Compass}
        title={t("errors.notFoundTitle")}
        description={t("errors.notFoundDescription")}
        action={
          <Button variant="primary" asChild>
            <Link to="/">{t("errors.backHome")}</Link>
          </Button>
        }
      />
    </main>
  );
}

export function RouteErrorScreen({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  if (isApiError(error, "notFound")) return <NotFoundScreen />;
  const forbidden = isApiError(error, "forbidden");
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <EmptyState
        icon={forbidden ? Lock : CircleAlert}
        title={forbidden ? t("errors.forbiddenTitle") : t("errors.failedTitle")}
        description={forbidden ? t("errors.forbiddenDescription") : problemMessage(t, error)}
        action={
          <Button
            variant="primary"
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            {t("errors.retry")}
          </Button>
        }
      />
    </main>
  );
}
