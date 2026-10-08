import { queryOptions } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { paths } from "../api/generated/schema.js";
import { request } from "../api/request.js";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;
type Ok<Path extends keyof paths, Method extends "get" | "post" | "put" | "patch" | "delete"> = Json<
  NonNullable<paths[Path][Method]> extends { responses: infer Responses }
    ? Responses[keyof Responses & (200 | 201)]
    : never
>;

const fetchComments = (pageId: string) =>
  request(() => api.GET("/api/v1/pages/{pageId}/comments", { params: { path: { pageId } } }));

export type CommentList = Awaited<ReturnType<typeof fetchComments>>;
export type CommentThread = CommentList["threads"][number];
export type CommentEntry = CommentThread["replies"][number];
export type Reactions = Ok<"/api/v1/pages/{pageId}/reactions", "get">;
export type ReactionSummary = Reactions["reactions"][number];
export type TaskStatus = Ok<"/api/v1/pages/{pageId}/tasks", "get">[number];
export type TaskList = Ok<"/api/v1/tasks", "get">;
export type TaskEntry = TaskList["items"][number];
export type TaskQuery = NonNullable<paths["/api/v1/tasks"]["get"]["parameters"]["query"]>;
export type BlogPost = Ok<"/api/v1/blog-posts/{postId}", "get">;
export type BlogPage = Ok<"/api/v1/spaces/{spaceId}/blog", "get">;
export type ForYou = Ok<"/api/v1/home", "get">;
export type Starred = Ok<"/api/v1/starred", "get">;
export type ContentReference = ForYou["mentions"][number]["item"];
export type Mention = ForYou["mentions"][number];

export const collaborationKeys = {
  comments: (itemId: string) => ["items", itemId, "comments"] as const,
  reactions: (itemId: string) => ["items", itemId, "reactions"] as const,
  taskStatuses: (itemId: string) => ["items", itemId, "tasks"] as const,
  tasks: (query: TaskQuery) => ["tasks", query] as const,
  allTasks: ["tasks"] as const,
  blogPost: (postId: string) => ["blogPosts", postId] as const,
  spaceBlog: (spaceId: string) => ["spaces", spaceId, "blog"] as const,
  scheduledPosts: (spaceId: string) => ["spaces", spaceId, "blog", "scheduled"] as const,
  organizationBlog: (organizationId: string, filters: { spaceId?: string; label?: string }) =>
    ["blog", organizationId, filters] as const,
  allBlogs: ["blog"] as const,
  home: ["home"] as const,
  starred: ["starred"] as const,
  organizationHomePage: (organizationId: string) => ["organization", organizationId, "homePage"] as const,
};

export function commentsQuery(itemId: string) {
  return queryOptions({
    queryKey: collaborationKeys.comments(itemId),
    throwOnError: false,
    queryFn: () => fetchComments(itemId),
  });
}

export function reactionsQuery(itemId: string) {
  return queryOptions({
    queryKey: collaborationKeys.reactions(itemId),
    throwOnError: false,
    queryFn: () =>
      request(() => api.GET("/api/v1/pages/{pageId}/reactions", { params: { path: { pageId: itemId } } })),
  });
}

export function taskStatusesQuery(itemId: string) {
  return queryOptions({
    queryKey: collaborationKeys.taskStatuses(itemId),
    throwOnError: false,
    queryFn: () =>
      request(() => api.GET("/api/v1/pages/{pageId}/tasks", { params: { path: { pageId: itemId } } })),
  });
}

export function tasksQuery(query: TaskQuery) {
  return queryOptions({
    queryKey: collaborationKeys.tasks(query),
    queryFn: () => request(() => api.GET("/api/v1/tasks", { params: { query } })),
  });
}

export function blogPostQuery(postId: string) {
  return queryOptions({
    queryKey: collaborationKeys.blogPost(postId),
    queryFn: () => request(() => api.GET("/api/v1/blog-posts/{postId}", { params: { path: { postId } } })),
  });
}

export function homeQuery() {
  return queryOptions({
    queryKey: collaborationKeys.home,
    queryFn: () => request(() => api.GET("/api/v1/home")),
  });
}

export function starredQuery() {
  return queryOptions({
    queryKey: collaborationKeys.starred,
    throwOnError: false,
    queryFn: () => request(() => api.GET("/api/v1/starred")),
    staleTime: 30_000,
  });
}

export function organizationHomePageQuery(organizationId: string) {
  return queryOptions({
    queryKey: collaborationKeys.organizationHomePage(organizationId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/home-page", { params: { path: { organizationId } } }),
      ),
  });
}

export function recordView(itemId: string): void {
  void request(() => api.POST("/api/v1/items/{itemId}/views", { params: { path: { itemId } } })).catch(
    () => undefined,
  );
}
