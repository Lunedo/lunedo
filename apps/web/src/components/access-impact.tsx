import { Notice } from "@pagehall/ui";
import { useTranslation } from "react-i18next";

const SHOWN = 8;

export function AccessImpact({
  change,
  people,
  everyone,
  what,
}: {
  change: "gains" | "loses";
  people: readonly string[];
  everyone?: string;
  what: string;
}) {
  const { t } = useTranslation();
  const shown = people.slice(0, SHOWN);
  const more = people.length - shown.length;
  return (
    <Notice
      variant={change === "gains" ? "info" : "warning"}
      title={change === "gains" ? t("access.gainsAccess") : t("access.losesAccess")}
    >
      <p>{what}</p>
      {everyone ? <p className="mt-1 font-medium">{everyone}</p> : null}
      {shown.length > 0 ? (
        <ul
          aria-label={change === "gains" ? t("access.peopleGaining") : t("access.peopleLosing")}
          className="mt-2 list-disc ps-5"
        >
          {shown.map((name) => (
            <li key={name}>{name}</li>
          ))}
          {more > 0 ? <li>{t("access.andMore", { count: more })}</li> : null}
        </ul>
      ) : null}
      {!everyone && people.length === 0 ? <p className="mt-1">{t("access.nobody")}</p> : null}
    </Notice>
  );
}
