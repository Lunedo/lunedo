import { Section } from "@pagehall/ui";
import type { ReactNode } from "react";

export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Section title={title} {...(actions ? { actions } : {})}>
      <div className="flex flex-col gap-4 p-4">
        {description ? <p className="text-sm text-text-muted">{description}</p> : null}
        {children}
      </div>
    </Section>
  );
}
