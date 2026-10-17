export const ACCORDION_QUERY = "(max-width: 599px)";

let counter = 0;

function parts(tabs: HTMLElement) {
  return {
    buttons: Array.from(tabs.querySelectorAll<HTMLButtonElement>(":scope > .ph-tabs-list > [role=tab]")),
    toggles: Array.from(tabs.querySelectorAll<HTMLButtonElement>(":scope > .ph-tab > .ph-tab-toggle")),
    panels: Array.from(tabs.querySelectorAll<HTMLElement>(":scope > .ph-tab > [role=tabpanel]")),
  };
}

function accordion(tabs: HTMLElement): boolean {
  return tabs.dataset.mode === "accordion";
}

export function selectTab(tabs: HTMLElement, index: number, focus = false): void {
  const { buttons, toggles, panels } = parts(tabs);
  if (buttons.length === 0) return;
  const selected = Math.max(0, Math.min(index, buttons.length - 1));
  buttons.forEach((button, position) => {
    const active = position === selected;
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
    toggles[position]?.setAttribute("aria-expanded", active ? "true" : "false");
    const panel = panels[position];
    if (panel) panel.hidden = !active;
  });
  if (focus) buttons[selected]?.focus();
}

export function toggleSection(tabs: HTMLElement, index: number): void {
  const { toggles, panels } = parts(tabs);
  const toggle = toggles[index];
  const panel = panels[index];
  if (!toggle || !panel) return;
  const expanded = toggle.getAttribute("aria-expanded") !== "true";
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  panel.hidden = !expanded;
}

export function setTabsMode(tabs: HTMLElement, narrow: boolean): void {
  const mode = narrow ? "accordion" : "tabs";
  if (tabs.dataset.mode === mode) return;
  const { buttons, toggles } = parts(tabs);
  if (narrow) {
    const selected = buttons.findIndex((button) => button.getAttribute("aria-selected") === "true");
    tabs.dataset.mode = mode;
    selectTab(tabs, selected === -1 ? 0 : selected);
    return;
  }
  const expanded = toggles.findIndex((toggle) => toggle.getAttribute("aria-expanded") === "true");
  tabs.dataset.mode = mode;
  selectTab(tabs, expanded === -1 ? 0 : expanded);
}

export function enhanceTabs(root: HTMLElement, narrow: boolean): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(".ph-tabs:not(.ph-tabs-print)"));
  for (const tabs of all) {
    if (!tabs.dataset.tabsId) {
      counter += 1;
      const id = `ph-tabs-${counter}`;
      tabs.dataset.tabsId = id;
      const { buttons, toggles, panels } = parts(tabs);
      buttons.forEach((button, index) => {
        const panel = panels[index];
        const toggle = toggles[index];
        button.id = `${id}-tab-${index}`;
        button.title = button.textContent ?? "";
        if (toggle) toggle.id = `${id}-toggle-${index}`;
        if (panel) {
          panel.id = `${id}-panel-${index}`;
          button.setAttribute("aria-controls", panel.id);
          toggle?.setAttribute("aria-controls", panel.id);
          panel.setAttribute("aria-labelledby", button.id);
        }
      });
    }
    setTabsMode(tabs, narrow);
  }
  return all;
}

export function handleTabsClick(target: HTMLElement): boolean {
  const button = target.closest<HTMLElement>(".ph-tabs > .ph-tabs-list > [role=tab]");
  const tabs = button?.closest<HTMLElement>(".ph-tabs");
  if (button && tabs) {
    selectTab(tabs, Number(button.dataset.index));
    return true;
  }
  const toggle = target.closest<HTMLElement>(".ph-tabs > .ph-tab > .ph-tab-toggle");
  const owner = toggle?.closest<HTMLElement>(".ph-tabs");
  if (toggle && owner && accordion(owner)) {
    toggleSection(owner, Number(toggle.dataset.index));
    return true;
  }
  return false;
}

export function handleTabsKey(event: KeyboardEvent | React.KeyboardEvent): boolean {
  const target = event.target as HTMLElement;
  if (target.getAttribute("role") !== "tab") return false;
  const tabs = target.closest<HTMLElement>(".ph-tabs");
  if (!tabs) return false;
  const count = parts(tabs).buttons.length;
  const index = Number(target.dataset.index);
  const next: Record<string, number> = {
    ArrowRight: (index + 1) % count,
    ArrowLeft: (index - 1 + count) % count,
    Home: 0,
    End: count - 1,
  };
  const destination = next[event.key];
  if (destination === undefined) return false;
  event.preventDefault();
  selectTab(tabs, destination, true);
  return true;
}
