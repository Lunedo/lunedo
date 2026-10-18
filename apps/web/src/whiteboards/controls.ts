export function nameUnlabeledControls(container: HTMLElement, menuLabel: string): void {
  for (const control of container.querySelectorAll<HTMLElement>("button, [role='button']")) {
    if (control.getAttribute("aria-label") || control.getAttribute("aria-labelledby")) continue;
    if ((control.textContent ?? "").trim() !== "") continue;
    const title = control.getAttribute("title")?.split(" — ")[0]?.trim();
    const name = control.classList.contains("main-menu-trigger") ? menuLabel : title;
    if (name) control.setAttribute("aria-label", name);
  }
}
