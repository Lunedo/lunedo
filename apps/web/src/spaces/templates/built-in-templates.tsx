import { Badge, Button, Section, Skeleton, useToast } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import type { PageTemplate } from "../content-queries.js";

export function BuiltInTemplates({
  organizationId,
  canManage,
  onDuplicate,
}: {
  organizationId: string;
  canManage: boolean;
  onDuplicate: (template: PageTemplate) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const templates = useQuery({
    queryKey: ["organization", organizationId, "templates", "builtIn"],
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/templates/built-in", {
          params: { path: { organizationId } },
        }),
      ),
    enabled: canManage,
    throwOnError: false,
  });
  if (!canManage) return null;
  const duplicate = async (template: PageTemplate) => {
    setBusy(template.id);
    try {
      await onDuplicate(template);
      toast({ variant: "success", title: t("templates.builtIn.duplicated", { name: template.name }) });
    } catch (failure) {
      toast({
        variant: "error",
        title: t("templates.builtIn.duplicateFailed", { name: template.name }),
        description: problemMessage(t, failure),
      });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section title={t("templates.builtIn.title")} description={t("templates.builtIn.description")}>
      {templates.isError ? (
        <LoadError
          what={t("templates.builtIn.loadFailed")}
          error={templates.error}
          onRetry={() => void templates.refetch()}
        />
      ) : templates.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {templates.data.map((template) => (
            <li key={template.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium" title={template.name}>
                    {template.name}
                  </span>
                  <Badge variant="neutral">{t(`templates.categories.${template.category}`)}</Badge>
                </span>
                <span className="text-sm text-text-muted">{template.description}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                icon={Copy}
                loading={busy === template.id}
                aria-label={t("templates.builtIn.duplicateNamed", { name: template.name })}
                onClick={() => void duplicate(template)}
              >
                {t("templates.builtIn.duplicate")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
