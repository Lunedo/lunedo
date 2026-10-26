import { Button, Dialog, Field, focusFirstInvalidSoon, IconButton, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import {
  type Holder,
  HolderPicker,
  holderLabel,
  holderValue,
  RoleSelect,
  roleLabel,
} from "../access/holders.js";
import { ImpactConfirmDialog } from "../access/impact.js";
import { type SpaceRole, spaceKeys } from "../space-queries.js";

type Chosen = Holder & { name: string };

export function AddHoldersDialog({
  space,
  existing,
  open,
  onOpenChange,
}: {
  space: {
    id: string;
    organizationId: string | null;
    organizationName: string | null;
    personal: boolean;
    confidential: boolean;
  };
  existing: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [role, setRole] = useState<SpaceRole>("reader");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const body = {
    holders: chosen.map(({ principalKind, principalId }) => ({ principalKind, principalId })),
    role,
  };
  const impact = useQuery({
    queryKey: ["spaces", space.id, "grantImpact", JSON.stringify(body)],
    enabled: confirming,
    retry: false,
    queryFn: () =>
      request(() =>
        api.POST("/api/v1/spaces/{spaceId}/permissions/grants/preview", {
          params: { path: { spaceId: space.id } },
          body,
        }),
      ),
  });
  const label = (holder: Holder) => holderLabel(t, holder, space.organizationName);
  const reset = () => {
    setChosen([]);
    setRole("reader");
    setError(null);
    setConfirming(false);
  };
  const close = () => {
    reset();
    onOpenChange(false);
  };
  const next = () => {
    if (chosen.length === 0) {
      setError(t("spaces.create.chooseHolderFirst"));
      focusFirstInvalidSoon();
      return;
    }
    setError(null);
    setConfirming(true);
  };
  const apply = async () => {
    try {
      await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/permissions/grants", {
          params: { path: { spaceId: space.id } },
          body,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: spaceKeys.permissions(space.id) });
      await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
      toast({ title: t("spaces.permissions.grantManyDone", { count: chosen.length }), variant: "success" });
      close();
    } catch (failure) {
      toast({
        title: t("spaces.permissions.failed"),
        description: problemMessage(t, failure),
        variant: "error",
      });
    }
  };
  const names = chosen.map(label);
  return (
    <>
      <Dialog
        open={open && !confirming}
        onOpenChange={(next) => !next && close()}
        title={t("spaces.permissions.addTitle")}
        description={t("spaces.permissions.addDescription")}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={next}>
              {t("common.continue")}
            </Button>
          </>
        }
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            next();
          }}
        >
          <Field label={t("spaces.create.addHolder")} {...(error ? { error } : {})}>
            <HolderPicker
              label={t("spaces.create.addHolder")}
              organizationId={space.organizationId}
              organizationName={space.organizationName}
              personal={space.personal}
              peopleOnly={space.confidential}
              exclude={[...existing, ...chosen.map(holderValue)]}
              value={null}
              onValueChange={(holder) => {
                if (!holder) return;
                setChosen((current) => [...current, holder]);
                setError(null);
              }}
            />
          </Field>
          {chosen.length > 0 ? (
            <ul aria-label={t("spaces.permissions.chosen")} className="flex flex-col divide-y divide-border">
              {chosen.map((holder) => (
                <li key={holderValue(holder)} className="flex min-h-control-field items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={label(holder)}>
                    {label(holder)}
                  </span>
                  <IconButton
                    size="field"
                    label={t("spaces.permissions.unchoose", { holder: label(holder) })}
                    icon={X}
                    onClick={() =>
                      setChosen((current) =>
                        current.filter((entry) => holderValue(entry) !== holderValue(holder)),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          ) : null}
          <Field label={t("spaces.create.newRole")}>
            <RoleSelect label={t("spaces.create.newRole")} value={role} onValueChange={setRole} />
          </Field>
        </form>
      </Dialog>
      <ImpactConfirmDialog
        open={open && confirming}
        onOpenChange={(next) => !next && setConfirming(false)}
        title={t("spaces.permissions.grantManyTitle", {
          count: chosen.length,
          holders: names.join(", "),
          role: roleLabel(t, role),
        })}
        description={t("spaces.permissions.confirmDescription")}
        confirmLabel={t("spaces.permissions.confirmGrant")}
        impact={impact}
        onConfirm={apply}
      />
    </>
  );
}
