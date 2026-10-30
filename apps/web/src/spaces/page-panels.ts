import type { QueryClient, QueryFunction, QueryKey } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { commentsQuery, reactionsQuery } from "../collaboration/queries.js";
import { attachmentsQuery } from "../files/attachments-api.js";
import { watchStatusQuery } from "../notifications/watching-api.js";
import { versionsQuery } from "./content-queries.js";
import { pageEditorsQuery } from "./page-editors.js";
import { backlinksQuery, labelsQuery } from "./space-queries.js";

type PagePanels = Awaited<ReturnType<typeof fetchPanels>>;

function fetchPanels(pageId: string) {
  return request(() => api.GET("/api/v1/pages/{pageId}/panels", { params: { path: { pageId } } }));
}

export function preloadPagePanels(queryClient: QueryClient, pageId: string): void {
  const panels = fetchPanels(pageId);
  panels.catch(() => undefined);
  const seed = <T>(
    options: { queryKey: QueryKey; queryFn?: unknown },
    pick: (loaded: PagePanels) => T,
  ): void => {
    const own = options.queryFn as QueryFunction<T>;
    void queryClient.prefetchQuery({
      queryKey: options.queryKey,
      queryFn: (context) => panels.then(pick, () => own(context)),
    });
  };
  seed(labelsQuery(pageId), (loaded) => loaded.labels);
  seed(reactionsQuery(pageId), (loaded) => loaded.reactions);
  seed(watchStatusQuery({ type: "item", id: pageId }), (loaded) => loaded.watch);
  seed(pageEditorsQuery(pageId), (loaded) => loaded.editors);
  seed(versionsQuery(pageId), (loaded) => loaded.versions);
  seed(backlinksQuery(pageId), (loaded) => loaded.backlinks);
  seed(attachmentsQuery(pageId), (loaded) => loaded.attachments);
  seed(commentsQuery(pageId), (loaded) => loaded.comments);
}
