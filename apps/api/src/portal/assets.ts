import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EMBED_ALLOW, EMBED_SANDBOX } from "@pagehall/server";
import { portalStyle } from "./styles.js";

const require = createRequire(import.meta.url);

const FONT_FACES = [
  "@fontsource/geist/400.css",
  "@fontsource/geist/500.css",
  "@fontsource/geist/600.css",
  "@fontsource/geist/700.css",
  "@fontsource/geist-mono/400.css",
];
const FONT_FILE = /^(geist|geist-mono)-latin(-ext)?-(400|500|600|700)-normal\.woff2$/;

function fontFaces(): string {
  return FONT_FACES.flatMap((entry) => {
    const css = readFileSync(require.resolve(entry), "utf8");
    return [...css.matchAll(/@font-face\s*{[^}]*}/g)]
      .map((match) => match[0])
      .filter((block) => /url\(\.\/files\/[a-z-]+-latin(-ext)?-\d+-normal\.woff2\)/.test(block))
      .map((block) =>
        block.replace(/src:[^;]*;/, (source) => {
          const file = /url\(\.\/files\/([a-z0-9-]+\.woff2)\)/.exec(source)?.[1] ?? "";
          return `src:url(fonts/${file}) format("woff2");`;
        }),
      );
  }).join("\n");
}

export function fontFile(name: string): Buffer | null {
  if (!FONT_FILE.test(name)) return null;
  const family = name.startsWith("geist-mono") ? "geist-mono" : "geist";
  return readFileSync(require.resolve(`@fontsource/${family}/files/${name}`));
}

const SCRIPT = `(() => {
  const toast = document.querySelector("[data-toast]");
  let timer;
  const say = (text) => {
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { toast.hidden = true; }, 4000);
  };
  const menus = () => document.querySelectorAll("details[data-menu][open]");
  document.addEventListener("click", (event) => {
    for (const menu of menus()) if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const menu of menus()) {
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }
  });
  const toggle = document.querySelector("[data-phone-menu]");
  const panel = document.getElementById("pmenu");
  if (toggle && panel) {
    toggle.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? toggle.dataset.closeLabel : toggle.dataset.openLabel);
      if (open) panel.querySelector("input")?.focus();
    });
  }
  for (const form of document.querySelectorAll("form[data-search]")) {
    form.addEventListener("submit", (event) => {
      const input = form.querySelector("input[name=q]");
      if (!input || input.value.trim()) return;
      event.preventDefault();
      const error = form.nextElementSibling;
      if (error && error.matches("[data-search-error]")) {
        error.hidden = false;
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", error.id);
      }
      input.focus();
    });
  }
  for (const form of document.querySelectorAll("form[data-autosubmit]")) {
    form.addEventListener("change", () => form.requestSubmit());
  }
  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        say(button.dataset.copied);
      } catch {
        say(button.dataset.copyFailed);
      }
    });
  }
  for (const frame of document.querySelectorAll(".ph-embed-frame[data-src]")) {
    const iframe = document.createElement("iframe");
    iframe.src = frame.dataset.src;
    iframe.title = frame.dataset.title || "";
    iframe.loading = "lazy";
    iframe.setAttribute("sandbox", ${JSON.stringify(EMBED_SANDBOX)});
    iframe.setAttribute("allow", ${JSON.stringify(EMBED_ALLOW)});
    iframe.referrerPolicy = frame.dataset.referrerPolicy || "strict-origin-when-cross-origin";
    const height = Number(frame.dataset.height);
    if (height > 0) iframe.style.height = height + "px";
    frame.replaceChildren(iframe);
  }
  const feedback = document.querySelector("[data-feedback]");
  if (!feedback) return;
  const itemId = feedback.dataset.feedback;
  const key = "pagehall.rated." + itemId;
  const remember = () => { try { localStorage.setItem(key, "1"); } catch {} };
  const rated = () => { try { return localStorage.getItem(key) === "1"; } catch { return false; } };
  const steps = feedback.querySelectorAll("[data-step]");
  const show = (name) => { for (const step of steps) step.hidden = step.dataset.step !== name; };
  const failedText = feedback.querySelector("[data-failed-text]");
  const failedDefault = failedText ? failedText.textContent : "";
  let pending = null;
  const send = async (body, next) => {
    pending = { body, next };
    try {
      const response = await fetch(feedback.dataset.endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-pagehall-request": "1" },
        body: JSON.stringify({ itemId, ...body }),
      });
      if (!response.ok) {
        if (failedText) failedText.textContent = response.status === 413 ? failedText.dataset.tooLong : failedDefault;
        show("failed");
        return;
      }
      pending = null;
      next();
    } catch {
      if (failedText) failedText.textContent = failedDefault;
      show("failed");
    }
  };
  if (rated()) show("thanks");
  feedback.querySelector("[data-rate=yes]")?.addEventListener("click", () =>
    send({ helpful: true }, () => { remember(); show("thanks"); }));
  feedback.querySelector("[data-rate=no]")?.addEventListener("click", () =>
    send({ helpful: false }, () => { remember(); show("text"); feedback.querySelector("textarea")?.focus(); }));
  const sent = feedback.querySelector("[data-sent-text]");
  const finish = (withText) => {
    if (withText && sent) sent.textContent = sent.dataset.withText;
    show("sent");
    feedback.querySelector("[data-mail]")?.classList.add("primary");
  };
  feedback.querySelector("[data-send]")?.addEventListener("click", () => {
    const text = feedback.querySelector("textarea")?.value.trim() ?? "";
    if (!text) return finish(false);
    send({ text }, () => finish(true));
  });
  feedback.querySelector("[data-skip]")?.addEventListener("click", () => finish(false));
  feedback.querySelector("[data-retry]")?.addEventListener("click", () => {
    if (pending) send(pending.body, pending.next);
  });
})();
`;

function hashed(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

export const portalCss = `${fontFaces()}\n${portalStyle}`;
export const portalScript = SCRIPT;
export const PORTAL_ASSETS = {
  style: `portal-${hashed(portalCss)}.css`,
  script: `portal-${hashed(portalScript)}.js`,
};
