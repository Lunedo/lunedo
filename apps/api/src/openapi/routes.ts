import { RequestMethod, type Type } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { INTERNAL_ROUTE, ROUTE_ACCESS, type RouteAccess } from "../access/route-access.js";
import { AuditController } from "../audit/audit.controller.js";
import { AccountController } from "../auth/account.controller.js";
import { AuthController } from "../auth/auth.controller.js";
import { BackupsController } from "../backups/backups.controller.js";
import { ChatChannelsController } from "../chat/chat-channels.controller.js";
import { BlogController } from "../collaboration/blog.controller.js";
import { CommentsController } from "../collaboration/comments.controller.js";
import { HomeController } from "../collaboration/home.controller.js";
import { ReportsController } from "../collaboration/reports.controller.js";
import { TasksController } from "../collaboration/tasks.controller.js";
import { DiagramsController } from "../diagrams/diagrams.controller.js";
import { DocsController } from "../docs/docs.controller.js";
import { EmbedsController } from "../embeds/embeds.controller.js";
import { ExportsController } from "../exports/exports.controller.js";
import { RenderingController } from "../exports/rendering.controller.js";
import { AttachmentsController } from "../files/attachments.controller.js";
import { API_ROUTE, type ApiRouteDefinition } from "../http/api-route.js";
import { IdentityProvidersController } from "../identity/identity-providers.controller.js";
import { ProviderAuthController } from "../identity/provider-auth.controller.js";
import { ProviderGroupsController } from "../identity/provider-groups.controller.js";
import { ImportsController } from "../imports/imports.controller.js";
import { MeetingsController } from "../meetings/meetings.controller.js";
import { OneOnOnesController } from "../meetings/one-on-ones.controller.js";
import { NotificationsController } from "../notifications/notifications.controller.js";
import { PushController } from "../notifications/push.controller.js";
import { AccountWatchesController, WatchesController } from "../notifications/watches.controller.js";
import { OperationsController } from "../operations/operations.controller.js";
import { AccountsController } from "../organizations/accounts.controller.js";
import { AnnouncementsController } from "../organizations/announcements.controller.js";
import { GroupsController } from "../organizations/groups.controller.js";
import { InstanceController } from "../organizations/instance.controller.js";
import { OrganizationsController } from "../organizations/organizations.controller.js";
import { PortalController } from "../portal/portal.controller.js";
import { SavedSearchesController } from "../search/saved-searches.controller.js";
import { SearchController } from "../search/search.controller.js";
import { SetupRestoreController } from "../setup/restore.controller.js";
import { SetupController } from "../setup/setup.controller.js";
import { ShareLinksController } from "../sharing/links.controller.js";
import { PageAccessController } from "../sharing/page-access.controller.js";
import { AccessRequestsController } from "../sharing/requests.controller.js";
import { ArticleApiController } from "../spaces/article-api.controller.js";
import { ConfidentialSpacesController } from "../spaces/confidential-spaces.controller.js";
import { CopiesController } from "../spaces/copies.controller.js";
import { ItemsController } from "../spaces/items.controller.js";
import { KnowledgeBasesController } from "../spaces/knowledge-bases.controller.js";
import { OrganizationSpacesController } from "../spaces/organization-spaces.controller.js";
import { OwnershipController } from "../spaces/ownership.controller.js";
import { PersonalSpacesController } from "../spaces/personal-spaces.controller.js";
import { PortalAccountsController } from "../spaces/portal-accounts.controller.js";
import { ReviewsController } from "../spaces/reviews.controller.js";
import { ShortcutsController } from "../spaces/shortcuts.controller.js";
import { SpacesController } from "../spaces/spaces.controller.js";
import { StatisticsController } from "../spaces/statistics.controller.js";
import { TemplateFilesController } from "../spaces/template-files.controller.js";
import { TemplatesController } from "../spaces/templates.controller.js";
import { TrashController } from "../spaces/trash.controller.js";
import { VersionsController } from "../spaces/versions.controller.js";
import { StorageController } from "../storage/storage.controller.js";
import { ServiceAccountsController } from "../tokens/service-accounts.controller.js";
import { TokensController } from "../tokens/tokens.controller.js";
import { WhiteboardsController } from "../whiteboards/whiteboards.controller.js";

export const apiControllers = (): Type[] => [
  AuthController,
  AccountController,
  SetupController,
  SetupRestoreController,
  OrganizationsController,
  GroupsController,
  InstanceController,
  AccountsController,
  AnnouncementsController,
  ServiceAccountsController,
  TokensController,
  AuditController,
  NotificationsController,
  WatchesController,
  AccountWatchesController,
  PushController,
  ChatChannelsController,
  IdentityProvidersController,
  ProviderAuthController,
  ProviderGroupsController,
  DocsController,
  SpacesController,
  OrganizationSpacesController,
  ConfidentialSpacesController,
  ItemsController,
  KnowledgeBasesController,
  ArticleApiController,
  PortalAccountsController,
  ReviewsController,
  StatisticsController,
  PortalController,
  CopiesController,
  OwnershipController,
  ShortcutsController,
  PersonalSpacesController,
  VersionsController,
  WhiteboardsController,
  DiagramsController,
  EmbedsController,
  TrashController,
  TemplatesController,
  TemplateFilesController,
  MeetingsController,
  OneOnOnesController,
  CommentsController,
  TasksController,
  ReportsController,
  BlogController,
  HomeController,
  AttachmentsController,
  PageAccessController,
  ShareLinksController,
  AccessRequestsController,
  ImportsController,
  ExportsController,
  RenderingController,
  StorageController,
  OperationsController,
  BackupsController,
  SearchController,
  SavedSearchesController,
];

export interface ApiRouteInfo {
  method: string;
  path: string;
  handler: string;
  controller: string;
  access: RouteAccess | undefined;
  internal: boolean;
  definition: ApiRouteDefinition | undefined;
}

export function joinPath(...parts: unknown[]): string {
  const segments = parts
    .flatMap((part) => (Array.isArray(part) ? part : [part]))
    .filter((part): part is string => typeof part === "string")
    .flatMap((part) => part.split("/"))
    .filter(Boolean);
  return `/${segments.join("/")}`;
}

function metadata<T>(key: string, ...targets: object[]): T | undefined {
  for (const target of targets) {
    const value = Reflect.getMetadata(key, target) as T | undefined;
    if (value !== undefined) return value;
  }
  return undefined;
}

export function routesOf(controller: Type): ApiRouteInfo[] {
  const prototype = controller.prototype as Record<string, unknown>;
  const routes: ApiRouteInfo[] = [];
  for (const name of Object.getOwnPropertyNames(prototype)) {
    const handler = prototype[name];
    if (name === "constructor" || typeof handler !== "function") continue;
    const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
    if (path === undefined) continue;
    const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod] ?? "GET";
    routes.push({
      method,
      path: joinPath(Reflect.getMetadata(PATH_METADATA, controller), path),
      handler: name,
      controller: controller.name,
      access: metadata<RouteAccess>(ROUTE_ACCESS, handler, controller),
      internal: metadata<boolean>(INTERNAL_ROUTE, handler, controller) ?? false,
      definition: metadata<ApiRouteDefinition>(API_ROUTE, handler),
    });
  }
  return routes;
}

export function apiRoutes(): ApiRouteInfo[] {
  return apiControllers().flatMap(routesOf);
}
