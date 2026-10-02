import { Bot, KeyRound, ShieldAlert, ShieldCheck, UserRound, UserRoundX } from "lucide-react";
import { notificationTypes } from "./notification-types.js";
import type { NotificationItem } from "./notifications-api.js";

const ORGANIZATION = "/settings/organizations/$organizationId";

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
    id: "identityProvider.credentialExpiring",
    icon: KeyRound,
    link: (item) => ({
      to: "/settings/instance/sign-in-providers/$providerId",
      params: { providerId: (item.params as { providerId: string }).providerId },
    }),
  },
);
