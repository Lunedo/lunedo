import { classNames, focusMainHeading, IconButton, useToast } from "@lunedo/ui";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { problemMessage } from "../errors/problem-message.js";
import { useOrganizationState } from "./shell-context.js";

const MAX_TIMER_MS = 2_147_483_647;

export const announcementKeys = { shown: ["announcements", "shown"] as const };

export interface BannerAnnouncement {
  id: string;
  scope: "instance" | "organization";
  organizationId: string | null;
  version: string;
  severity: "information" | "warning";
  text: string;
  link: { url: string; label: string } | null;
  startsAt: string;
  endsAt: string;
  dismissed: boolean;
}

export function announcementsChanged(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: announcementKeys.shown });
}

export function visibleAnnouncements(
  announcements: readonly BannerAnnouncement[],
  organizationId: string | null,
  now: number,
): BannerAnnouncement[] {
  const active = announcements.filter(
    (announcement) =>
      (announcement.scope === "instance" || announcement.organizationId === organizationId) &&
      Date.parse(announcement.startsAt) <= now &&
      now < Date.parse(announcement.endsAt) &&
      !(announcement.severity === "information" && announcement.dismissed),
  );
  return [
    ...active.filter((announcement) => announcement.scope === "instance").slice(0, 1),
    ...active.filter((announcement) => announcement.scope === "organization").slice(0, 1),
  ];
}

export function nextAnnouncementChange(
  announcements: readonly BannerAnnouncement[],
  now: number,
): number | null {
  const upcoming = announcements
    .flatMap((announcement) => [Date.parse(announcement.startsAt), Date.parse(announcement.endsAt)])
    .filter((moment) => moment > now);
  return upcoming.length > 0 ? Math.min(...upcoming) : null;
}

function useNow(announcements: readonly BannerAnnouncement[]): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const next = nextAnnouncementChange(announcements, now);
    if (next === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(next - now + 50, MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [announcements, now]);
  return now;
}

export function AnnouncementBanner({
  announcement,
  source,
  onDismiss,
}: {
  announcement: Pick<BannerAnnouncement, "scope" | "severity" | "text" | "link">;
  source: string;
  onDismiss?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const warning = announcement.severity === "warning";
  const Glyph = warning ? TriangleAlert : Megaphone;
  return (
    <section
      aria-label={
        announcement.scope === "instance"
          ? t("announcements.instanceRegion")
          : t("announcements.organizationRegion")
      }
      className={classNames(
        "flex items-center gap-3 border-b border-border px-4 py-2",
        warning ? "bg-warning-soft" : "bg-info-soft",
      )}
    >
      <Glyph
        aria-hidden
        className={classNames("size-icon shrink-0", warning ? "text-warning" : "text-info")}
      />
      <p className="min-w-0 flex-1 text-sm wrap-anywhere text-text">
        {warning ? <span className="sr-only">{t("announcements.warningLabel")} </span> : null}
        {announcement.text}
        {announcement.link ? (
          <>
            {" "}
            <a
              href={announcement.link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline focus-visible:focus-ring"
            >
              {announcement.link.label}
              <span className="sr-only"> {t("common.opensInNewTab")}</span>
            </a>
          </>
        ) : null}
        <span className="text-text-muted"> · {source}</span>
      </p>
      {onDismiss ? (
        <IconButton label={t("announcements.dismiss")} icon={X} size="sm" onClick={onDismiss} />
      ) : null}
    </section>
  );
}

export function AnnouncementBanners() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const organization = useOrganizationState();
  const shown = useQuery({
    queryKey: announcementKeys.shown,
    throwOnError: false,
    staleTime: 60_000,
    queryFn: () => request(() => api.GET("/api/v1/announcements")),
  });
  const announcements = shown.data ?? [];
  const now = useNow(announcements);
  const dismiss = useMutation({
    mutationFn: (announcement: BannerAnnouncement) =>
      request(() =>
        api.POST("/api/v1/announcements/{announcementId}/dismiss", {
          params: { path: { announcementId: announcement.id } },
          body: { version: announcement.version },
        }),
      ),
    onMutate: (announcement) => {
      queryClient.setQueryData<BannerAnnouncement[]>(announcementKeys.shown, (current) =>
        current?.map((entry) =>
          entry.id === announcement.id && entry.version === announcement.version
            ? { ...entry, dismissed: true }
            : entry,
        ),
      );
    },
    onError: (error) =>
      toast({
        variant: "error",
        title: t("announcements.dismissFailed"),
        description: problemMessage(t, error),
      }),
    onSettled: () => announcementsChanged(queryClient),
  });
  const visible = visibleAnnouncements(announcements, organization.organizationId, now);
  if (visible.length === 0) return null;
  return (
    <div>
      {visible.map((announcement) => (
        <AnnouncementBanner
          key={announcement.id}
          announcement={announcement}
          source={
            announcement.scope === "instance"
              ? t("announcements.fromInstance")
              : (organization.organization?.name ?? t("announcements.fromOrganization"))
          }
          onDismiss={
            announcement.severity === "information"
              ? () => {
                  dismiss.mutate(announcement);
                  focusMainHeading();
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}
