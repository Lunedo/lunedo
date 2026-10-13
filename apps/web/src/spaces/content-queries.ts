import { queryOptions } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { request } from "../api/request.js";

type Data<T extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<T>>;

const fetchDraft = (pageId: string) =>
  request(() => api.GET("/api/v1/pages/{pageId}/draft", { params: { path: { pageId } } }));
const fetchVersions = (pageId: string) =>
  request(() => api.GET("/api/v1/pages/{pageId}/versions", { params: { path: { pageId } } }));
const fetchCompare = (pageId: string, from: VersionSide, to: VersionSide) =>
  request(() =>
    api.GET("/api/v1/pages/{pageId}/compare", {
      params: { path: { pageId }, query: { from: String(from), to: String(to) } as never },
    }),
  );
const fetchVersion = (pageId: string, number: number) =>
  request(() =>
    api.GET("/api/v1/pages/{pageId}/versions/{number}", { params: { path: { pageId, number } } }),
  );
const fetchDiscarded = (pageId: string) =>
  request(() => api.GET("/api/v1/pages/{pageId}/discarded-drafts", { params: { path: { pageId } } }));
const fetchTrash = (spaceId: string) =>
  request(() => api.GET("/api/v1/spaces/{spaceId}/trash", { params: { path: { spaceId } } }));
const fetchArchive = (spaceId: string) =>
  request(() => api.GET("/api/v1/spaces/{spaceId}/archive", { params: { path: { spaceId } } }));
const fetchGallery = (spaceId: string) =>
  request(() =>
    api.GET("/api/v1/spaces/{spaceId}/template-gallery", { params: { path: { spaceId }, query: {} } }),
  );

export type VersionSide = number | "draft";
export type Draft = Data<typeof fetchDraft>;
export type PageVersion = Data<typeof fetchVersions>[number];
export type Comparison = Data<typeof fetchCompare>;
export type DiscardedDraft = Data<typeof fetchDiscarded>[number];
export type TrashEntry = Data<typeof fetchTrash>[number];
export type ArchivedItem = Data<typeof fetchArchive>[number];
export type PageTemplate = Data<typeof fetchGallery>[number];
export type TemplateField = PageTemplate["fields"][number];

export const contentKeys = {
  draft: (pageId: string) => ["items", pageId, "draft"] as const,
  versions: (pageId: string) => ["items", pageId, "versions"] as const,
  version: (pageId: string, number: number) => ["items", pageId, "versions", number] as const,
  compare: (pageId: string, from: VersionSide, to: VersionSide) =>
    ["items", pageId, "compare", String(from), String(to)] as const,
  discarded: (pageId: string) => ["items", pageId, "discarded"] as const,
  trash: (spaceId: string) => ["spaces", spaceId, "trash"] as const,
  archive: (spaceId: string) => ["spaces", spaceId, "archive"] as const,
  gallery: (spaceId: string) => ["spaces", spaceId, "templateGallery"] as const,
  spaceTemplates: (spaceId: string) => ["spaces", spaceId, "templates"] as const,
  spaceSettings: (spaceId: string) => ["spaces", spaceId, "settings"] as const,
  organizationTrash: (organizationId: string) => ["organization", organizationId, "trash"] as const,
  organizationTemplates: (organizationId: string) => ["organization", organizationId, "templates"] as const,
  instanceTemplates: ["instance", "templates"] as const,
  personalTrash: ["instance", "personalSpaces", "trash"] as const,
};

export function draftQuery(pageId: string) {
  return queryOptions({
    queryKey: contentKeys.draft(pageId),
    queryFn: () => fetchDraft(pageId),
  });
}

export function versionsQuery(pageId: string) {
  return queryOptions({
    queryKey: contentKeys.versions(pageId),
    queryFn: () => fetchVersions(pageId),
  });
}

export function versionQuery(pageId: string, number: number) {
  return queryOptions({
    queryKey: contentKeys.version(pageId, number),
    queryFn: () => fetchVersion(pageId, number),
  });
}

export function compareQuery(pageId: string, from: VersionSide, to: VersionSide) {
  return queryOptions({
    queryKey: contentKeys.compare(pageId, from, to),
    queryFn: () => fetchCompare(pageId, from, to),
  });
}

export function discardedDraftsQuery(pageId: string) {
  return queryOptions({
    queryKey: contentKeys.discarded(pageId),
    queryFn: () => fetchDiscarded(pageId),
  });
}

export function trashQuery(spaceId: string) {
  return queryOptions({
    queryKey: contentKeys.trash(spaceId),
    queryFn: () => fetchTrash(spaceId),
  });
}

export function archiveQuery(spaceId: string) {
  return queryOptions({
    queryKey: contentKeys.archive(spaceId),
    queryFn: () => fetchArchive(spaceId),
  });
}

export function galleryQuery(spaceId: string) {
  return queryOptions({
    queryKey: contentKeys.gallery(spaceId),
    queryFn: () => fetchGallery(spaceId),
    staleTime: 60_000,
  });
}
