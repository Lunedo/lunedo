import { useToast } from "@pagehall/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { problemMessage } from "../errors/problem-message.js";
import { collaborationKeys, type TaskStatus } from "./queries.js";

export function useSetTaskStatus(pageId: string | null, options: { onPage?: boolean } = {}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, done }: { taskId: string; done: boolean }) =>
      request(() =>
        options.onPage && pageId
          ? api.PUT("/api/v1/pages/{pageId}/tasks/{taskId}/status", {
              params: { path: { pageId, taskId } },
              body: { done },
            })
          : api.PUT("/api/v1/tasks/{taskId}/status", { params: { path: { taskId } }, body: { done } }),
      ),
    onMutate: async ({ taskId, done }) => {
      if (!pageId) return { previous: undefined };
      const key = collaborationKeys.taskStatuses(pageId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskStatus[]>(key);
      queryClient.setQueryData<TaskStatus[]>(key, (current) => {
        const list = current ?? [];
        return list.some((status) => status.id === taskId)
          ? list.map((status) => (status.id === taskId ? { ...status, done } : status))
          : [...list, { id: taskId, done, changedAt: null, changedBy: null }];
      });
      return { previous };
    },
    onError: (error, variables, context) => {
      if (pageId) queryClient.setQueryData(collaborationKeys.taskStatuses(pageId), context?.previous);
      toast({
        variant: "error",
        title: variables.done ? t("tasks.checkFailed") : t("tasks.uncheckFailed"),
        description: problemMessage(t, error),
      });
    },
    onSettled: () => {
      if (pageId) void queryClient.invalidateQueries({ queryKey: collaborationKeys.taskStatuses(pageId) });
      void queryClient.invalidateQueries({ queryKey: collaborationKeys.allTasks });
      void queryClient.invalidateQueries({ queryKey: collaborationKeys.home });
    },
  });
}
