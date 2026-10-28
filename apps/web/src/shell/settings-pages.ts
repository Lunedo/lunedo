export type NavigationSection = "account" | "organization" | "instance";

export interface SettingsPage {
  readonly id: string;
  readonly order: number;
  readonly section: NavigationSection;
  readonly labelKey: string;
  readonly groupKey?: string;
}

export const settingsPages: readonly SettingsPage[] = [
  { id: "account.profile", order: 5, section: "account", labelKey: "navigation.profile" },
  { id: "account.security", order: 10, section: "account", labelKey: "navigation.signInAndSecurity" },
  { id: "account.preferences", order: 20, section: "account", labelKey: "navigation.preferences" },
  { id: "account.notifications", order: 30, section: "account", labelKey: "navigation.notifications" },
  { id: "account.watching", order: 40, section: "account", labelKey: "navigation.watching" },
  { id: "account.exports", order: 50, section: "account", labelKey: "navigation.exports" },
  { id: "organization.general", order: 10, section: "organization", labelKey: "navigation.general" },
  {
    id: "organization.announcements",
    order: 20,
    section: "organization",
    labelKey: "navigation.announcements",
  },
  {
    id: "organization.notifications",
    order: 30,
    section: "organization",
    labelKey: "navigation.notificationDefaults",
  },
  {
    id: "organization.members",
    order: 40,
    section: "organization",
    labelKey: "navigation.members",
    groupKey: "navigationGroups.peopleAndAccess",
  },
  {
    id: "organization.groups",
    order: 50,
    section: "organization",
    labelKey: "navigation.groups",
    groupKey: "navigationGroups.peopleAndAccess",
  },
  {
    id: "organization.roles",
    order: 60,
    section: "organization",
    labelKey: "navigation.roles",
    groupKey: "navigationGroups.peopleAndAccess",
  },
  {
    id: "organization.domains",
    order: 70,
    section: "organization",
    labelKey: "navigation.domainsAndGuests",
    groupKey: "navigationGroups.peopleAndAccess",
  },
  {
    id: "organization.access",
    order: 80,
    section: "organization",
    labelKey: "navigation.accessOverview",
    groupKey: "navigationGroups.peopleAndAccess",
  },
  {
    id: "organization.spaces",
    order: 90,
    section: "organization",
    labelKey: "navigation.spaces",
    groupKey: "navigationGroups.content",
  },
  {
    id: "organization.content",
    order: 100,
    section: "organization",
    labelKey: "navigation.pagesAndTrash",
    groupKey: "navigationGroups.content",
  },
  {
    id: "organization.templates",
    order: 110,
    section: "organization",
    labelKey: "navigation.templates",
    groupKey: "navigationGroups.content",
  },
  {
    id: "organization.imports",
    order: 120,
    section: "organization",
    labelKey: "navigation.imports",
    groupKey: "navigationGroups.content",
  },
  {
    id: "organization.serviceAccounts",
    order: 130,
    section: "organization",
    labelKey: "navigation.serviceAccounts",
    groupKey: "navigationGroups.integrationsAndSecurity",
  },
  {
    id: "organization.apiTokens",
    order: 140,
    section: "organization",
    labelKey: "navigation.apiTokens",
    groupKey: "navigationGroups.integrationsAndSecurity",
  },
  {
    id: "organization.security",
    order: 150,
    section: "organization",
    labelKey: "navigation.security",
    groupKey: "navigationGroups.integrationsAndSecurity",
  },
  {
    id: "organization.audit",
    order: 160,
    section: "organization",
    labelKey: "navigation.auditLog",
    groupKey: "navigationGroups.integrationsAndSecurity",
  },
  { id: "instance.general", order: 10, section: "instance", labelKey: "navigation.general" },
  { id: "instance.announcements", order: 20, section: "instance", labelKey: "navigation.announcements" },
  {
    id: "instance.status",
    order: 40,
    section: "instance",
    labelKey: "navigation.systemStatus",
    groupKey: "navigationGroups.operations",
  },
  {
    id: "instance.updates",
    order: 50,
    section: "instance",
    labelKey: "navigation.updates",
    groupKey: "navigationGroups.operations",
  },
  {
    id: "instance.maintenance",
    order: 60,
    section: "instance",
    labelKey: "navigation.maintenance",
    groupKey: "navigationGroups.operations",
  },
  {
    id: "instance.backups",
    order: 70,
    section: "instance",
    labelKey: "navigation.backups",
    groupKey: "navigationGroups.operations",
  },
  {
    id: "instance.storage",
    order: 80,
    section: "instance",
    labelKey: "navigation.storage",
    groupKey: "navigationGroups.operations",
  },
  {
    id: "instance.organizations",
    order: 90,
    section: "instance",
    labelKey: "navigation.organizations",
    groupKey: "navigationGroups.peopleAndSignIn",
  },
  {
    id: "instance.accounts",
    order: 100,
    section: "instance",
    labelKey: "navigation.accounts",
    groupKey: "navigationGroups.peopleAndSignIn",
  },
  {
    id: "instance.roles",
    order: 110,
    section: "instance",
    labelKey: "navigation.roles",
    groupKey: "navigationGroups.peopleAndSignIn",
  },
  {
    id: "instance.security",
    order: 120,
    section: "instance",
    labelKey: "navigation.policies",
    groupKey: "navigationGroups.peopleAndSignIn",
  },
  {
    id: "instance.signInProviders",
    order: 130,
    section: "instance",
    labelKey: "navigation.signInProviders",
    groupKey: "navigationGroups.peopleAndSignIn",
  },
  {
    id: "instance.breakGlass",
    order: 140,
    section: "instance",
    labelKey: "navigation.breakGlass",
    groupKey: "navigationGroups.peopleAndSignIn",
  },
  {
    id: "instance.templates",
    order: 170,
    section: "instance",
    labelKey: "navigation.templates",
    groupKey: "navigationGroups.content",
  },
  {
    id: "instance.mail",
    order: 180,
    section: "instance",
    labelKey: "navigation.delivery",
    groupKey: "navigationGroups.services",
  },
  {
    id: "instance.rendering",
    order: 190,
    section: "instance",
    labelKey: "navigation.rendering",
    groupKey: "navigationGroups.services",
  },
  {
    id: "instance.embeds",
    order: 200,
    section: "instance",
    labelKey: "navigation.embeds",
    groupKey: "navigationGroups.services",
  },
  {
    id: "instance.portals",
    order: 210,
    section: "instance",
    labelKey: "navigation.portals",
    groupKey: "navigationGroups.services",
  },
  {
    id: "instance.audit",
    order: 220,
    section: "instance",
    labelKey: "navigation.auditLog",
    groupKey: "navigationGroups.log",
  },
];

export function settingsPage(id: string): SettingsPage {
  const page = settingsPages.find((candidate) => candidate.id === id);
  if (!page) throw new Error(`Unknown settings page ${id}`);
  return page;
}
