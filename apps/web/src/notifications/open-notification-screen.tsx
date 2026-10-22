import { Button, EmptyState, Spinner } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { BellOff } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { isApiError, request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { notificationTypes } from "./notification-types.js";
import { useMarkRead } from "./notifications-api.js";

export function OpenNotificationScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const markRead = useMarkRead();
  const { notificationId } = useParams({ from: "/app/notifications/$notificationId" });
  const notification = useQuery({
    queryKey: ["notification", notificationId],
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/notifications/{notificationId}", { params: { path: { notificationId } } }),
      ),
    retry: false,
    throwOnError: false,
  });
  const opened = useRef(false);
  const item = notification.data;
  const link = item
    ? (notificationTypes
        .list()
        .find((entry) => entry.id === item.type)
        ?.link(item) ?? null)
    : null;

  useEffect(() => {
    if (!item || opened.current) return;
    opened.current = true;
    if (item.readAt === null) markRead.mutate(item.id);
    if (link) void navigate({ to: link.to as never, params: link.params as never, replace: true });
  }, [item, link, markRead, navigate]);

  const gone = notification.isError && isApiError(notification.error, "notFound");
  if (gone || (item && !link)) {
    return (
      <EmptyState
        icon={BellOff}
        title={t("notifications.open.gone")}
        description={t("notifications.open.goneCause")}
        action={
          <Button variant="secondary" asChild>
            <Link to="/home">{t("notifications.open.toNotifications")}</Link>
          </Button>
        }
      />
    );
  }
  if (notification.isError) {
    return (
      <LoadError
        what={t("failures.openNotification")}
        error={notification.error}
        onRetry={() => notification.refetch()}
      />
    );
  }
  return <Spinner label={t("notifications.open.loading")} />;
}
