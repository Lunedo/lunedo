import { Button, Notice, Spinner } from "@pagehall/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { isApiError, request } from "../api/request.js";
import { problemMessage } from "../errors/problem-message.js";
import { spaceKeys } from "./space-queries.js";

export function PersonalSpaceScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const open = useMutation({
    mutationFn: () =>
      request(() =>
        api.POST("/api/v1/account/personal-space", {
          body: { overviewTitle: t("spaces.personal.overviewTitle") },
        }),
      ),
    onSuccess: async (space) => {
      await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
      await navigate({ to: "/spaces/$spaceKey", params: { spaceKey: space.key }, replace: true });
    },
  });
  const { mutate } = open;
  useEffect(() => {
    mutate();
  }, [mutate]);
  return (
    <main id="main" tabIndex={-1} className="flex flex-1 items-start justify-center p-6 outline-none">
      {open.isError ? (
        <div className="w-full max-w-page">
          {isApiError(open.error, "forbidden") ? (
            <Notice variant="info" title={t("spaces.personal.unavailableTitle")}>
              <p>{t("spaces.personal.unavailable")}</p>
              <p className="mt-2">
                <Link to="/spaces" className="text-accent underline">
                  {t("spaces.notFound.back")}
                </Link>
              </p>
            </Notice>
          ) : (
            <Notice variant="danger" title={t("spaces.personal.failed")}>
              <p>{problemMessage(t, open.error)}</p>
              <Button className="mt-2" variant="secondary" onClick={() => open.mutate()}>
                {t("ui.retry")}
              </Button>
            </Notice>
          )}
        </div>
      ) : (
        <Spinner label={t("spaces.personal.opening")} />
      )}
    </main>
  );
}
