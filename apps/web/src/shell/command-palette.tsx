import { CommandPalette, useToast } from "@pagehall/ui";
import { Building2, Link2 } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/request.js";
import { useFailureToast } from "../errors/failure.js";
import { translateKey } from "../i18n/translate.js";
import { useConfluenceLink } from "../imports/confluence-link.js";
import { looksLikeConfluenceLink } from "../imports/reimport-api.js";
import { commands, isNavigationVisible, navigationItems } from "./extensions.js";
import { useRegistry } from "./registry.js";
import { useShell } from "./shell.js";
import { useOrganizationState } from "./shell-context.js";

export function CommandPaletteHost({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const shell = useShell();
  const organization = useOrganizationState();
  const navigation = useRegistry(navigationItems);
  const actions = useRegistry(commands);
  const openLink = useConfluenceLink();
  const failed = useFailureToast();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  if (!open) return null;

  const close = () => onOpenChange(false);
  const sections = [
    { section: "account", heading: t("navigation.myAccount") },
    {
      section: "organization",
      heading: organization.organization?.name ?? t("navigation.organization"),
    },
    { section: "instance", heading: t("navigation.instance") },
  ] as const;

  const groups: ComponentProps<typeof CommandPalette>["groups"] = sections
    .map(({ section, heading }) => ({
      heading,
      items: navigation
        .filter((item) => item.section === section && isNavigationVisible(item, shell))
        .map((item) => ({
          id: item.id,
          label: translateKey(t, item.labelKey),
          icon: item.icon,
          keywords: [heading],
          onSelect: () => {
            close();
            shell.navigate(item.to, shell.organizationId ? { organizationId: shell.organizationId } : {});
          },
        })),
    }))
    .filter((group) => group.items.length > 0);

  if (organization.multipleOrganizations) {
    groups.push({
      heading: t("navigation.switchOrganization"),
      items: organization.organizations.map((entry) => ({
        id: `organization.${entry.id}`,
        label: t("commands.switchTo", { name: entry.name }),
        icon: Building2,
        keywords: [entry.slug],
        onSelect: () => {
          close();
          shell.navigate("/settings/organizations/$organizationId/general", { organizationId: entry.id });
        },
      })),
    });
  }

  if (looksLikeConfluenceLink(query)) {
    const link = query.trim();
    const open = (): Promise<void> =>
      openLink(link).catch((error: unknown) => {
        if (error instanceof ApiError && error.code === "notFound") {
          toast({
            title: t("commands.confluenceLinkFailed"),
            description: t("imports.links.notFound"),
            variant: "error",
          });
        } else {
          failed(t("commands.confluenceLinkFailed"), error, () => void open());
        }
      });
    groups.unshift({
      heading: t("commands.confluenceLink"),
      items: [
        {
          id: "confluence-link",
          label: t("commands.openConfluenceLink"),
          icon: Link2,
          alwaysShown: true,
          onSelect: () => {
            close();
            void open();
          },
        },
      ],
    });
  }

  groups.push({
    heading: t("commands.actions"),
    items: actions
      .filter((command) => (command.visible ? command.visible(shell) : true))
      .map((command) => ({
        id: command.id,
        label: translateKey(t, command.labelKey),
        ...(command.icon ? { icon: command.icon } : {}),
        ...(command.shortcut ? { shortcut: command.shortcut } : {}),
        ...(command.keywords ? { keywords: command.keywords } : {}),
        onSelect: () => {
          close();
          command.run(shell);
        },
      })),
  });

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      label={t("commands.label")}
      placeholder={t("commands.placeholder")}
      emptyText={t("commands.empty")}
      groups={groups}
      query={query}
      onQueryChange={setQuery}
    />
  );
}
