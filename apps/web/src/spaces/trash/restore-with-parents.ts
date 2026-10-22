import { useToast } from "@lunedo/ui";
import { useTranslation } from "react-i18next";
import { isApiError } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";

export function parentEntriesOf(error: unknown): number {
  return isApiError(error, "restrictedParentInTrash") ? (error.problem.parentEntries ?? 0) : 0;
}

export function withParentsQuery(withParents: boolean): { withParents?: "true" } {
  return withParents ? { withParents: "true" } : {};
}

export function useRestoreFailure() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fail = (title: string, error: unknown, withParents?: () => Promise<unknown>) => {
    const offer = withParents && parentEntriesOf(error) > 0;
    toast({
      title,
      description: problemMessage(t, error),
      variant: "error",
      ...(offer
        ? {
            action: {
              label: t("trash.restoreWithParents"),
              onSelect: () => void withParents().catch((failure: unknown) => fail(title, failure)),
            },
          }
        : {}),
    });
  };
  return fail;
}
