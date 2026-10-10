import { Button, Field, focusFirstInvalidSoon, IconButton, Notice, RadioGroup } from "@pagehall/ui";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SpaceRole, SpaceVisibility } from "../space-queries.js";
import {
  type Grant,
  type Holder,
  HolderPicker,
  holderLabel,
  holderValue,
  RoleSelect,
  roleLabel,
} from "./holders.js";

const VISIBILITIES: SpaceVisibility[] = ["private", "organization", "instance"];

export function VisibilityField({
  value,
  onChange,
  organizationName,
}: {
  value: SpaceVisibility;
  onChange: (value: SpaceVisibility) => void;
  organizationName: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-semibold">{t("spaces.create.visibility")}</legend>
      <RadioGroup
        label={t("spaces.create.visibility")}
        variant="card"
        value={value}
        onValueChange={(next) => onChange(next as SpaceVisibility)}
        options={VISIBILITIES.map((option) => ({
          value: option,
          label: t(`spaces.visibility.${option}.label`),
          description: t(`spaces.visibility.${option}.description`, { organization: organizationName }),
        }))}
      />
    </fieldset>
  );
}

export function GrantsField({
  organizationId,
  organizationName,
  grants,
  onChange,
  ownId,
  peopleOnly = false,
}: {
  organizationId: string;
  organizationName: string | null;
  grants: Grant[];
  onChange: (update: (current: Grant[]) => Grant[]) => void;
  ownId: string;
  peopleOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState<(Holder & { name: string }) | null>(null);
  const [addingRole, setAddingRole] = useState<SpaceRole>("reader");
  const [holderError, setHolderError] = useState<string | null>(null);
  const others = grants.filter(
    (grant) => !(grant.principalKind === "account" && grant.principalId === ownId),
  );

  const addHolder = () => {
    if (!adding) {
      setHolderError(t("spaces.create.chooseHolderFirst"));
      focusFirstInvalidSoon();
      return;
    }
    setHolderError(null);
    onChange((current) => [
      ...current.filter((grant) => holderValue(grant) !== holderValue(adding)),
      { ...adding, role: addingRole },
    ]);
    setAdding(null);
  };

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 font-semibold">{t("spaces.create.permissions")}</legend>
      <p className="text-sm text-text-muted">{t("spaces.create.permissionsHint")}</p>
      <ul className="flex flex-col gap-2">
        <li className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{t("spaces.create.you")}</span>
          <span className="text-sm text-text-muted">{roleLabel(t, "admin")}</span>
        </li>
        {others.map((grant) => {
          const label = holderLabel(t, grant, organizationName ?? undefined);
          return (
            <li key={holderValue(grant)} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 grow basis-field truncate" title={label}>
                {label}
              </span>
              <div className="w-unit-field">
                <RoleSelect
                  label={t("spaces.create.roleOf", { holder: label })}
                  value={grant.role}
                  onValueChange={(role) =>
                    onChange((current) =>
                      current.map((entry) =>
                        holderValue(entry) === holderValue(grant) ? { ...entry, role } : entry,
                      ),
                    )
                  }
                />
              </div>
              <IconButton
                label={t("spaces.create.removeHolder", { holder: label })}
                icon={X}
                onClick={() =>
                  onChange((current) => current.filter((entry) => holderValue(entry) !== holderValue(grant)))
                }
              />
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Field label={t("spaces.create.addHolder")} {...(holderError ? { error: holderError } : {})}>
            <HolderPicker
              label={t("spaces.create.addHolder")}
              organizationId={organizationId}
              organizationName={organizationName}
              personal={false}
              peopleOnly={peopleOnly}
              exclude={[...grants.map(holderValue), `account:${ownId}`]}
              value={adding ? holderValue(adding) : null}
              onValueChange={setAdding}
            />
          </Field>
        </div>
        <div className="sm:w-unit-field">
          <RoleSelect label={t("spaces.create.newRole")} value={addingRole} onValueChange={setAddingRole} />
        </div>
        <Button variant="secondary" icon={Plus} onClick={addHolder}>
          {t("spaces.create.add")}
        </Button>
      </div>
    </fieldset>
  );
}

export function WhoGetsAccess({
  visibility,
  grants,
  ownId,
  organizationName,
}: {
  visibility: SpaceVisibility | null;
  grants: Grant[];
  ownId: string;
  organizationName: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Notice variant="info" title={t("spaces.create.whoGetsAccess")}>
      <ul className="list-disc ps-5">
        <li>{t("spaces.create.accessYou")}</li>
        {visibility && visibility !== "private" ? (
          <li>{t(`spaces.visibility.${visibility}.summary`, { organization: organizationName ?? "" })}</li>
        ) : null}
        {grants
          .filter((grant) => !(grant.principalKind === "account" && grant.principalId === ownId))
          .map((grant) => (
            <li key={holderValue(grant)}>
              {t("spaces.create.accessHolder", {
                holder: holderLabel(t, grant, organizationName ?? undefined),
                role: roleLabel(t, grant.role),
              })}
            </li>
          ))}
      </ul>
    </Notice>
  );
}
