import { slugify } from "@pagehall/editor-schema";
import {
  AtSign,
  Bot,
  Building2,
  CalendarClock,
  CalendarPlus,
  CircleDot,
  FileArchive,
  FileInput,
  FilePen,
  KeyRound,
  ListChecks,
  Lock,
  Mail,
  MessageSquare,
  Newspaper,
  NotebookPen,
  Share2,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  UserRound,
  UserRoundX,
  Users,
} from "lucide-react";
import { blogPostPath, pagePath } from "../spaces/space-queries.js";
import { notificationTypes } from "./notification-types.js";
import type { NotificationItem } from "./notifications-api.js";

const ORGANIZATION = "/settings/organizations/$organizationId";

function contentLink(item: NotificationItem) {
  const params = item.params as { itemKind?: string; itemTitle?: string; spaceKey?: string };
  if (!item.target.id) return null;
  const slug = slugify(params.itemTitle ?? "");
  const spaceKey = params.spaceKey ?? "";
  return {
    to:
      params.itemKind === "blogPost"
        ? blogPostPath(spaceKey, item.target.id, slug)
        : pagePath(spaceKey, item.target.id, slug),
  };
}

function inOrganization(item: NotificationItem, path: string, params: Record<string, string> = {}) {
  return item.organizationId
    ? { to: `${ORGANIZATION}${path}`, params: { organizationId: item.organizationId, ...params } }
    : null;
}

notificationTypes.register(
  {
    id: "apiToken.expiring",
    icon: KeyRound,
    link: (item) => {
      const serviceAccountId = (item.params as { serviceAccountId?: string | null }).serviceAccountId;
      return serviceAccountId
        ? inOrganization(item, "/service-accounts/$serviceAccountId", { serviceAccountId })
        : { to: "/settings/security" };
    },
  },
  {
    id: "apiToken.unused",
    icon: KeyRound,
    link: (item) => {
      const serviceAccountId = (item.params as { serviceAccountId?: string | null }).serviceAccountId;
      return serviceAccountId
        ? inOrganization(item, "/service-accounts/$serviceAccountId", { serviceAccountId })
        : { to: "/settings/security" };
    },
  },
  { id: "guest.expiring", icon: UserRound, link: (item) => inOrganization(item, "/members") },
  { id: "guest.inactive", icon: UserRoundX, link: (item) => inOrganization(item, "/members") },
  { id: "access.expiring", icon: ShieldCheck, link: (item) => inOrganization(item, "/members") },
  {
    id: "serviceAccount.unattended",
    icon: Bot,
    link: (item) =>
      inOrganization(item, "/service-accounts/$serviceAccountId", { serviceAccountId: item.target.id ?? "" }),
  },
  { id: "breakGlass.started", icon: ShieldAlert, link: (item) => inOrganization(item, "/audit-log") },
  { id: "signIn.newBrowser", icon: KeyRound, link: () => ({ to: "/settings/security" }) },
  { id: "auth.emergencySignIn", icon: ShieldAlert, link: () => ({ to: "/settings/instance/audit-log" }) },
  { id: "account.withoutOrganization", icon: UserRound, link: () => ({ to: "/settings/instance/accounts" }) },
  {
    id: "account.rolesWithheld",
    icon: ShieldAlert,
    link: () => ({ to: "/settings/instance/sign-in-providers" }),
  },
  {
    id: "account.homeOrganizationChanged",
    icon: Building2,
    link: (item) =>
      item.organizationId ? inOrganization(item, "/members") : { to: "/settings/preferences" },
  },
  { id: "mail.credentialExpiring", icon: Mail, link: () => ({ to: "/settings/instance/mail" }) },
  {
    id: "identityProvider.syncHeld",
    icon: ShieldAlert,
    link: (item) => ({
      to: "/settings/instance/sign-in-providers/$providerId",
      params: { providerId: (item.params as { providerId: string }).providerId },
    }),
  },
  {
    id: "identityProvider.credentialExpiring",
    icon: KeyRound,
    link: (item) => ({
      to: "/settings/instance/sign-in-providers/$providerId",
      params: { providerId: (item.params as { providerId: string }).providerId },
    }),
  },
  { id: "content.mentioned", icon: AtSign, link: contentLink },
  { id: "task.assigned", icon: ListChecks, link: contentLink },
  { id: "blogPost.scheduleHeld", icon: CalendarClock, link: contentLink },
  { id: "blogPost.published", icon: Newspaper, link: contentLink },
  { id: "page.shared", icon: Share2, link: contentLink },
  { id: "comment.created", icon: MessageSquare, link: contentLink, watched: true },
  { id: "content.changed", icon: FilePen, link: contentLink, watched: true },
  { id: "page.statusChanged", icon: CircleDot, link: contentLink, watched: true },
  { id: "ownership.transferred", icon: UserRound, link: contentLink, watched: true },
  {
    id: "access.requested",
    icon: UserPlus,
    link: (item) => (item.target.id ? { to: `/access-requests/${item.target.id}` } : null),
  },
  {
    id: "access.requestDecided",
    icon: UserPlus,
    link: (item) => (item.target.id ? { to: `/access-requests/${item.target.id}` } : null),
  },
  {
    id: "ownership.orphaned",
    icon: UserRoundX,
    link: (item) => {
      const spaceKey = (item.params as { spaceKey?: string }).spaceKey;
      return spaceKey ? { to: `/spaces/${encodeURIComponent(spaceKey)}/settings/content` } : null;
    },
  },
  {
    id: "restriction.orphaned",
    icon: Lock,
    link: (item) => {
      const spaceKey = (item.params as { spaceKey?: string }).spaceKey;
      return spaceKey ? { to: `/spaces/${encodeURIComponent(spaceKey)}/settings/access` } : null;
    },
  },
  { id: "meeting.notesAvailable", icon: NotebookPen, link: contentLink },
  { id: "meeting.reminder", icon: CalendarPlus, link: contentLink, dateTimeParams: ["startsAt"] },
  {
    id: "oneOnOne.started",
    icon: Users,
    link: (item) => {
      const spaceKey = (item.params as { spaceKey?: string }).spaceKey;
      return spaceKey && item.target.id
        ? { to: `/spaces/${encodeURIComponent(spaceKey)}/meetings/${item.target.id}` }
        : null;
    },
  },
  {
    id: "import.finished",
    icon: FileInput,
    link: (item) =>
      item.target.id ? inOrganization(item, "/imports/$importId", { importId: item.target.id }) : null,
  },
  {
    id: "import.failed",
    icon: FileInput,
    link: (item) =>
      item.target.id ? inOrganization(item, "/imports/$importId", { importId: item.target.id }) : null,
  },
  {
    id: "import.held",
    icon: FileInput,
    link: (item) =>
      item.target.id ? inOrganization(item, "/imports/$importId", { importId: item.target.id }) : null,
  },
  {
    id: "export.ready",
    icon: FileArchive,
    link: () => ({ to: "/settings/exports" }),
  },
  {
    id: "export.failed",
    icon: FileArchive,
    link: () => ({ to: "/settings/exports" }),
  },
  {
    id: "space.confidentialWithoutAdministrator",
    icon: Lock,
    link: (item) => inOrganization(item, "/spaces"),
  },
);
