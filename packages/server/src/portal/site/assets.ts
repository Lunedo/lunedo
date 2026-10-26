import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EMBED_ALLOW, EMBED_SANDBOX } from "@lunedo/editor-schema";
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

export function fontFiles(): string[] {
  return [...portalCss.matchAll(/url\(fonts\/([a-z0-9-]+\.woff2)\)/g)].map((match) => match[1] ?? "");
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
  const themeMenu = document.querySelector("[data-theme-menu]");
  if (themeMenu) {
    const stored = () => { try { return localStorage.getItem("lunedo.portal.theme") || "system"; } catch { return "system"; } };
    const mark = () => {
      for (const choice of themeMenu.querySelectorAll("[data-theme-choice]"))
        choice.setAttribute("aria-pressed", String(choice.dataset.themeChoice === stored()));
    };
    themeMenu.hidden = false;
    mark();
    for (const choice of themeMenu.querySelectorAll("[data-theme-choice]")) {
      choice.addEventListener("click", () => {
        const value = choice.dataset.themeChoice;
        try {
          if (value === "system") localStorage.removeItem("lunedo.portal.theme");
          else localStorage.setItem("lunedo.portal.theme", value);
        } catch {}
        if (value === "system") delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = value;
        mark();
        themeMenu.open = false;
        themeMenu.querySelector("summary")?.focus();
      });
    }
  }
  for (const button of document.querySelectorAll("[data-tree-toggle]")) {
    button.hidden = false;
    button.addEventListener("click", () => {
      const list = document.getElementById(button.getAttribute("aria-controls"));
      if (!list) return;
      const open = list.hidden;
      list.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", open ? button.dataset.collapse : button.dataset.expand);
    });
  }
  const drawer = document.querySelector("[data-tree-drawer]");
  const tree = document.getElementById("ptree");
  if (drawer && tree) {
    drawer.hidden = false;
    drawer.addEventListener("click", () => {
      const open = !tree.classList.contains("open");
      tree.classList.toggle("open", open);
      drawer.setAttribute("aria-expanded", String(open));
      const label = drawer.querySelector("span");
      if (label) label.textContent = open ? drawer.dataset.closeLabel : drawer.dataset.openLabel;
    });
  }
  const quick = document.querySelector("[data-quick]");
  if (quick) {
    const input = quick.querySelector("input");
    const list = quick.querySelector("[role=listbox]");
    const message = quick.querySelector(".qs-msg");
    const all = quick.querySelector("[data-quick-all]");
    let opener = null;
    let options = [];
    let active = -1;
    let request = 0;
    let timer;
    const select = (index) => {
      options.forEach((option, at) => option.setAttribute("aria-selected", String(at === index)));
      active = index;
      const chosen = options[index];
      if (chosen) {
        input.setAttribute("aria-activedescendant", chosen.id);
        chosen.scrollIntoView({ block: "nearest" });
      } else input.removeAttribute("aria-activedescendant");
    };
    const close = () => {
      quick.hidden = true;
      document.body.style.overflow = "";
      opener?.focus();
    };
    const open = (from) => {
      opener = from || document.activeElement;
      quick.hidden = false;
      document.body.style.overflow = "hidden";
      input.focus();
      input.select();
    };
    const count = () => {
      const query = input.value.trim();
      if (!query) return;
      fetch(quick.dataset.endpoint + "/count", {
        method: "POST",
        keepalive: true,
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: query }),
      }).catch(() => {});
    };
    const option = (entry, index) => {
      const item = document.createElement("div");
      item.setAttribute("role", "option");
      item.id = "qs-" + index;
      item.dataset.href = entry.href;
      const text = document.createElement("span");
      text.className = "g";
      const title = document.createElement("b");
      title.textContent = entry.title;
      title.style.fontWeight = "500";
      const detail = document.createElement("span");
      detail.textContent = [entry.type, entry.path].filter(Boolean).join(" · ");
      text.append(title);
      if (detail.textContent) text.append(detail);
      item.append(text);
      item.addEventListener("click", () => { count(); location.href = entry.href; });
      return item;
    };
    const group = (label) => {
      const heading = document.createElement("div");
      heading.className = "grp";
      heading.setAttribute("role", "presentation");
      heading.textContent = label;
      return heading;
    };
    const say = (text) => {
      message.textContent = text;
      message.hidden = !text;
    };
    const render = (query, data) => {
      const nodes = [];
      options = [];
      let index = 0;
      for (const [label, entries] of [[quick.dataset.topics, data.topics], [quick.dataset.articles, data.articles]]) {
        if (entries.length === 0) continue;
        nodes.push(group(label));
        for (const entry of entries) {
          const node = option(entry, index++);
          options.push(node);
          nodes.push(node);
        }
      }
      list.replaceChildren(...nodes);
      input.setAttribute("aria-expanded", String(options.length > 0));
      say(options.length === 0 ? quick.dataset.none.replace("{query}", query) : "");
      all.hidden = data.total === 0;
      all.href = data.all;
      all.textContent = data.total === 1 ? quick.dataset.allOne : quick.dataset.allOther.replace("{count}", String(data.total));
      select(options.length > 0 ? 0 : -1);
    };
    const run = async () => {
      const query = input.value.trim();
      const id = ++request;
      if (!query) {
        list.replaceChildren();
        options = [];
        all.hidden = true;
        say("");
        return;
      }
      try {
        const response = await fetch(quick.dataset.endpoint + "?q=" + encodeURIComponent(query), {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        if (id === request) render(query, data);
      } catch {
        if (id !== request) return;
        list.replaceChildren();
        options = [];
        all.hidden = true;
        say(quick.dataset.failed);
      }
    };
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(run, 150);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" && options.length > 0) {
        event.preventDefault();
        select((active + 1) % options.length);
      } else if (event.key === "ArrowUp" && options.length > 0) {
        event.preventDefault();
        select((active - 1 + options.length) % options.length);
      } else if (event.key === "Enter" && options[active]) {
        event.preventDefault();
        count();
        location.href = options[active].dataset.href;
      }
    });
    quick.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      } else if (event.key === "Tab") {
        const focusable = [...quick.querySelectorAll("input,button,a")].filter((node) => !node.hidden);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    quick.addEventListener("click", (event) => { if (event.target === quick) close(); });
    quick.querySelector("[data-quick-close]")?.addEventListener("click", close);
    for (const trigger of document.querySelectorAll("[data-quick-open]")) {
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        open(trigger);
      });
    }
    document.addEventListener("keydown", (event) => {
      const typing = event.target instanceof HTMLElement && event.target.matches("input,textarea,select,[contenteditable]");
      if ((event.key === "k" && (event.ctrlKey || event.metaKey)) || (event.key === "/" && !typing)) {
        if (!quick.hidden) return;
        event.preventDefault();
        open(null);
      }
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
  for (const frame of document.querySelectorAll(".ld-embed-frame[data-src]")) {
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
  const key = "lunedo.rated." + itemId;
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
        headers: { "content-type": "application/json", "x-lunedo-request": "1" },
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
export const portalThemeScript = `(() => {
  const root = document.documentElement;
  root.classList.add("js");
  try {
    const theme = localStorage.getItem("lunedo.portal.theme");
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  } catch {}
})();
`;
export const staticSearchScript = `(() => {
  const root = document.querySelector("[data-static-search]");
  if (!root || typeof MiniSearch === "undefined") return;
  const params = new URLSearchParams(location.search);
  const query = (params.get("q") || "").trim().slice(0, 200);
  for (const input of document.querySelectorAll("form[data-search] input[name=q]")) input.value = query;
  const list = root.querySelector("[data-results]");
  const heading = root.querySelector("[data-heading]");
  const empty = root.querySelector("[data-empty]");
  const failed = root.querySelector("[data-failed]");
  const text = (key, values) =>
    (root.dataset[key] || "").replace(/\\{(\\w+)\\}/g, (_match, name) => (values && name in values ? values[name] : ""));
  const options = {
    fields: ["title", "text", "category"],
    storeFields: ["title", "url", "excerpt", "category", "type", "number"],
  };
  const load = async (address) => {
    const response = await fetch(address, { credentials: "same-origin" });
    if (!response.ok) throw new Error(String(response.status));
    return MiniSearch.loadJSON(await response.text(), options);
  };
  const search = (index) =>
    index.search(query, { prefix: true, fuzzy: 0.2, boost: { title: 3, category: 1.5 }, combineWith: "AND" });
  const terms = query.toLowerCase().split(/\\s+/).filter((term) => term.length > 1);
  const marked = (value) => {
    const fragment = document.createDocumentFragment();
    const lower = value.toLowerCase();
    let position = 0;
    while (position < value.length) {
      let next = -1;
      let length = 0;
      for (const term of terms) {
        const found = lower.indexOf(term, position);
        if (found !== -1 && (next === -1 || found < next)) {
          next = found;
          length = term.length;
        }
      }
      if (next === -1) {
        fragment.append(value.slice(position));
        break;
      }
      fragment.append(value.slice(position, next));
      const mark = document.createElement("mark");
      mark.textContent = value.slice(next, next + length);
      fragment.append(mark);
      position = next + length;
    }
    return fragment;
  };
  const show = (results) => {
    heading.textContent = text(
      results.length === 0 ? "resultsNone" : results.length === 1 ? "resultsOne" : "resultsOther",
      { count: String(results.length), query },
    );
    heading.hidden = false;
    list.replaceChildren(
      ...results.slice(0, 50).map((result) => {
        const item = document.createElement("li");
        const path = document.createElement("span");
        path.className = "path";
        path.textContent = [result.type ? root.dataset["type" + result.type] || "" : "", result.category || ""]
          .filter(Boolean)
          .join(" · ");
        if (result.fallback) {
          item.lang = root.dataset.fallbackLanguage || "";
          path.lang = document.documentElement.lang;
          const tag = document.createElement("span");
          tag.className = "ltag";
          tag.textContent = root.dataset.fallbackLabel || "";
          path.append(tag);
        }
        const link = document.createElement("a");
        link.className = "t";
        link.href = result.base + result.url;
        link.textContent = result.title;
        item.append(path, link);
        if (result.excerpt) {
          const excerpt = document.createElement("p");
          excerpt.append(marked(result.excerpt));
          item.append(excerpt);
        }
        return item;
      }),
    );
    list.hidden = results.length === 0;
    empty.hidden = results.length > 0;
  };
  if (!query) return;
  (async () => {
    try {
      const base = root.dataset.base || "";
      const results = search(await load(root.dataset.index)).map((result) => ({ ...result, base }));
      if (root.dataset.fallbackIndex) {
        const shown = new Set(results.map((result) => result.number));
        const fallbackBase = root.dataset.fallbackBase || "";
        for (const result of search(await load(root.dataset.fallbackIndex))) {
          if (!shown.has(result.number)) results.push({ ...result, base: fallbackBase, fallback: true });
        }
      }
      show(results);
    } catch {
      failed.hidden = false;
    }
  })();
})();
`;
export const PORTAL_ASSETS = {
  style: `portal-${hashed(portalCss)}.css`,
  script: `portal-${hashed(portalScript)}.js`,
  theme: `portal-theme-${hashed(portalThemeScript)}.js`,
};
