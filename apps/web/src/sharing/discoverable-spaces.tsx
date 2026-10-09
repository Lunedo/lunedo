import { Badge, Button, Section } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { DoorOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { RequestAccessForm } from "./access-requests.js";
import { sharingKeys } from "./sharing-api.js";

export function DiscoverableSpaces({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState<string | null>(null);
  const spaces = useQuery({
    queryKey: sharingKeys.discoverable(organizationId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/discoverable-spaces", {
          params: { path: { organizationId } },
        }),
      ),
    throwOnError: false,
  });
  if (!spaces.data || spaces.data.length === 0) return null;
  return (
    <Section title={t("sharing.discoverable.title")} icon={DoorOpen}>
      <p className="px-4 pt-2 text-sm text-text-muted">{t("sharing.discoverable.description")}</p>
      <ul className="flex flex-col divide-y divide-border">
        {spaces.data.map((space) => (
          <li key={space.id} className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" title={space.name}>
                  {space.name}
                </p>
                {space.description ? <p className="text-sm text-text-muted">{space.description}</p> : null}
              </div>
              {space.requested ? (
                <Badge variant="warning">{t("sharing.discoverable.requested")}</Badge>
              ) : asking === space.id ? null : (
                <Button variant="secondary" onClick={() => setAsking(space.id)}>
                  {t("sharing.discoverable.ask")}
                </Button>
              )}
            </div>
            {asking === space.id && !space.requested ? (
              <RequestAccessForm
                target={{ type: "space", id: space.id, name: space.name }}
                onSent={() => void spaces.refetch()}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}
