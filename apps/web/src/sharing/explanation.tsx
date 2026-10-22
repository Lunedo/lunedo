import { Notice } from "@lunedo/ui";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { translateKey } from "../i18n/translate.js";
import type { AccessExplanation } from "./sharing-api.js";

type Reason = AccessExplanation["reasons"][number];

export function accessRoleLabel(t: TFunction, role: string | null): string {
  return role ? translateKey(t, `sharing.roles.${role}`) : t("sharing.roles.none");
}

export function reasonText(t: TFunction, reason: Reason): string {
  const text = sourceText(t, reason);
  return reason.inactive === "membershipEnded" ? t("sharing.why.inactive", { reason: text }) : text;
}

function sourceText(t: TFunction, reason: Reason): string {
  const role = accessRoleLabel(t, reason.role ?? null);
  switch (reason.type) {
    case "spaceRole": {
      const via = reason.via;
      if (via?.type === "group") return t("sharing.why.spaceGroup", { role, group: via.name ?? "" });
      if (via?.type === "organizationMembers") return t("sharing.why.spaceOrganization", { role });
      if (via?.type === "instanceUsers") return t("sharing.why.spaceInstance", { role });
      if (via?.type === "visibility") return t("sharing.why.spaceVisibility", { role });
      return t("sharing.why.spaceDirect", { role });
    }
    case "share":
      if (reason.inherited) {
        return reason.itemTitle
          ? t("sharing.why.shareAbove", { role, title: reason.itemTitle })
          : t("sharing.why.shareAboveHidden", { role });
      }
      return t("sharing.why.share", { role });
    case "link":
      return t("sharing.why.link", {
        scope: translateKey(t, `sharing.links.scopes.${reason.scope ?? "people"}`),
      });
    default:
      return t("sharing.why.other");
  }
}

export function denialText(t: TFunction, explanation: AccessExplanation): string | null {
  switch (explanation.denial) {
    case null:
      return null;
    case "restricted": {
      const titles = explanation.restrictions
        .filter((restriction) => !restriction.listed)
        .map((restriction) => restriction.title ?? t("sharing.why.hiddenPage"));
      return t("sharing.why.restricted", { pages: titles.join(", ") });
    }
    case "editRestricted":
      return t("sharing.why.editRestricted");
    case "unpublished":
      return t("sharing.why.unpublished");
    case "inTrash":
      return t("sharing.why.inTrash");
    case "accountInactive":
      return t("sharing.why.accountInactive");
    default:
      return t("sharing.why.noAccess");
  }
}

export function ExplanationView({
  explanation,
  subject = "page",
}: {
  explanation: AccessExplanation;
  subject?: "page" | "space";
}) {
  const { t } = useTranslation();
  const name = explanation.name ?? t("spaces.holders.unknownPerson");
  const denial = denialText(t, explanation);
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">
        {explanation.role
          ? t("sharing.why.summary", { name, role: accessRoleLabel(t, explanation.role) })
          : subject === "space"
            ? t("sharing.why.summaryNoneSpace", { name })
            : t("sharing.why.summaryNone", { name })}
      </p>
      {explanation.reasons.length > 0 ? (
        <ul className="list-disc ps-5 text-sm">
          {explanation.reasons.map((reason) => (
            <li
              key={`${reason.type}-${reason.itemId ?? ""}-${reason.linkId ?? ""}-${reason.via?.groupId ?? ""}-${reason.inactive ?? ""}`}
            >
              {reasonText(t, reason)}
            </li>
          ))}
        </ul>
      ) : null}
      {denial ? (
        <Notice variant={explanation.role ? "info" : "warning"} title={t("sharing.why.limitedTitle")}>
          {denial}
        </Notice>
      ) : null}
    </div>
  );
}
