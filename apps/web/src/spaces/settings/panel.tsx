import { Section } from "@lunedo/ui";
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
    <Section title={title} {...(description ? { description } : {})} {...(actions ? { actions } : {})}>
      <div className="flex flex-col gap-4 py-4">{children}</div>
    </Section>
  );
}
