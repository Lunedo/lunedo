const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function CommentHighlights({
  scope,
  open,
  active,
}: {
  scope: string;
  open: readonly string[];
  active: string | null;
}) {
  const ids = open.filter((id) => UUID.test(id));
  if (ids.length === 0) return null;
  const selector = (id: string) => `${scope} [data-thread-id="${id}"]`;
  const rules = [
    `${ids.map(selector).join(",")}{background-color:var(--ld-content-yellow-background);border-bottom:var(--ld-focus-width) solid var(--ld-color-warning);cursor:pointer}`,
    ...(active && UUID.test(active)
      ? [`${selector(active)}{outline:var(--ld-focus-width) solid var(--ld-color-accent);outline-offset:1px}`]
      : []),
  ];
  return <style>{rules.join("")}</style>;
}
