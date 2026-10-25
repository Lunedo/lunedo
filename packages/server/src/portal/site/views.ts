import { formatDate, parseIntroduction } from "@lunedo/shared";
import type { ArticleSort } from "../../search/adapter.js";
import { PORTAL_BASE_PLACEHOLDER } from "../articles.js";
import type { PortalConfig } from "../portals.js";
import type {
  ArticlePage,
  PortalArticle,
  PortalArticleFilter,
  PortalArticleSummary,
  PortalCategory,
  PortalSearchResult,
} from "../reader.js";
import { PORTAL_ICONS } from "./brand-icon.js";
import { type Html, html, raw, when } from "./html.js";
import { hasIcon, icon } from "./icons.js";
import { languageName, type PortalMessages } from "./messages.js";

const TYPE_ICONS = { howTo: "list-ordered", troubleshooting: "triangle-alert" } as const;
const PATH_SEGMENTS = 3;
const QUICK_COUNT_MARK = 987654321;
export const QUICK_TOPICS = 4;

export interface PortalAccount {
  name: string;
  email: string;
}

export interface LanguageLink {
  language: string;
  label: string;
  href: string;
  current: boolean;
  detail?: string | null;
}

export interface PortalLinks {
  home: string;
  article(article: { number: number; slug: string; language?: string }): string;
  category(id: string): string;
  search(query?: string): string;
  searchAction: string;
  contact(query?: string): string;
  share(article: { number: number; slug: string; language?: string }): string | null;
}

export function portalLinks(base: string, origin: string): PortalLinks {
  return {
    home: `${base}/`,
    article: (article) => articlePath(base, article),
    category: (id) => categoryPath(base, id),
    search: (query) => (query === undefined ? `${base}/search` : searchPath(base, query)),
    searchAction: `${base}/search`,
    contact: (query) => `${base}/contact${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    share: (article) => `${origin}${articlePath(base, article)}`,
  };
}

export interface StaticSearchData {
  index: string;
  base: string;
  fallbackIndex: string | null;
  fallbackBase: string | null;
  fallbackLanguage: string;
}

export interface PortalView {
  config: PortalConfig;
  t: PortalMessages;
  lang: string;
  root: string;
  base: string;
  links: PortalLinks;
  static: boolean;
  languageLinks: LanguageLink[];
  alternates: { hreflang: string; href: string }[];
  note: { text: string; lang: string } | null;
  maintenance: { message: string } | null;
  frameSources: string[];
  origin: string;
  nonce: string;
  assets: { style: string; script: string; theme: string };
  brandStyle: string;
  logoUrl: string | null;
  account: PortalAccount | null;
  appLink: { label: string; href: string } | null;
  accountLink: string | null;
  signInUrl: string | null;
  signOutUrl: string;
  quickSearch: string | null;
  categories: PortalCategory[];
}

export function articlePath(base: string, article: { number: number; slug: string }): string {
  return `${base}/${article.number}${article.slug ? `-${article.slug}` : ""}`;
}

export function categoryPath(base: string, id: string): string {
  return `${base}/topics/${id}`;
}

export function searchPath(base: string, query: string): string {
  return `${base}/search?q=${encodeURIComponent(query)}`;
}

export function mailto(address: string, subject: string, body?: string): string {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ""}`;
}

export function brandStyle(light: string, dark: string): string {
  return `:root{--kb:${light}}@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--kb:${dark}}}:root[data-theme=dark]{--kb:${dark}}`;
}

export function initialOf(title: string): string {
  const trimmed = title.trim();
  return [...trimmed].length <= 3 ? trimmed : ([...trimmed][0] ?? "").toUpperCase();
}

function longDate(view: PortalView, date: Date): string {
  return formatDate(date, view.config.dateFormat, view.config.timeZone, view.t.locale);
}

function changedOn(view: PortalView, article: { updatedAt: Date; reviewedAt: Date | null }): string {
  return article.reviewedAt
    ? view.t.reviewedOnLong(longDate(view, article.reviewedAt))
    : view.t.updatedOnLong(longDate(view, article.updatedAt));
}

function shortDate(view: PortalView, date: Date): string {
  return formatDate(date, view.config.dateFormat, view.config.timeZone, view.t.locale);
}

function folderIcon(folder: { title: string; icon: string | null }, size: number): Html {
  return hasIcon(folder.icon)
    ? html`<span class="cicon s${size}" aria-hidden="true">${icon(folder.icon)}</span>`
    : html`<span class="cicon s${size}" aria-hidden="true" data-initial="${initialOf(folder.title)}"></span>`;
}

function categoryOf(view: PortalView, id: string | null): PortalCategory | undefined {
  return id ? view.categories.find((category) => category.id === id) : undefined;
}

function areasOf(view: PortalView): PortalCategory[] {
  return view.categories.filter((category) => category.parentId === null);
}

function childrenOf(view: PortalView, id: string): PortalCategory[] {
  return view.categories.filter((category) => category.parentId === id);
}

export function folderTrail(categories: readonly PortalCategory[], ids: readonly string[]): PortalCategory[] {
  return ids.flatMap((id) => categories.find((category) => category.id === id) ?? []);
}

export function ancestorsOf(
  categories: readonly PortalCategory[],
  category: PortalCategory,
): PortalCategory[] {
  const trail: PortalCategory[] = [];
  for (let current: PortalCategory | undefined = category; current; ) {
    trail.unshift(current);
    const parentId: string | null = current.parentId;
    current = parentId ? categories.find((entry) => entry.id === parentId) : undefined;
  }
  return trail;
}

export function shortenPath(titles: readonly string[]): string {
  const shown =
    titles.length > PATH_SEGMENTS ? [titles[0] ?? "", "…", ...titles.slice(-(PATH_SEGMENTS - 1))] : titles;
  return shown.join(" › ");
}

function pathOf(view: PortalView, ids: readonly string[], below?: string): Html | null {
  const trail = folderTrail(view.categories, ids);
  const start = below ? trail.findIndex((folder) => folder.id === below) + 1 : 0;
  const titles = trail.slice(start).map((folder) => folder.title);
  if (titles.length === 0) return null;
  const full = titles.join(" › ");
  const short = shortenPath(titles);
  return short === full
    ? html`<span class="path">${full}</span>`
    : html`<span class="path" title="${full}">${short}</span>`;
}

export function introduction(source: string): Html {
  return html`${parseIntroduction(source).map(
    (block) =>
      html`<${raw(block.type === "callout" ? 'div class="callout"' : "p")}>${block.content.map((inline) =>
        inline.type === "break"
          ? raw("<br>")
          : inline.type === "link"
            ? html`<a href="${inline.href}">${inline.text}</a>`
            : inline.bold
              ? html`<strong>${inline.text}</strong>`
              : inline.italic
                ? html`<em>${inline.text}</em>`
                : html`${inline.text}`,
      )}</${raw(block.type === "callout" ? "div" : "p")}>`,
  )}`;
}

function metaLine(parts: readonly (Html | null)[]): Html {
  return html`<span class="m"><span class="mi">${parts
    .filter((part): part is Html => part !== null)
    .map((part) => html`<span>${part}</span>`)}</span></span>`;
}

function kindText(view: PortalView, type: PortalArticleSummary["type"]): Html | null {
  return type
    ? html`<span class="tkind ${type}">${icon(TYPE_ICONS[type])}${view.t.types[type]}</span>`
    : null;
}

function onlyIn(view: PortalView, article: { language: string }): Html | null {
  return view.languageLinks.length > 1 && article.language !== view.lang
    ? html`<span class="ltag" lang="${view.lang}">${view.t.onlyIn(languageName(article.language, view.lang))}</span>`
    : null;
}

export function favicon(view: Pick<PortalView, "logoUrl" | "assets">): Html {
  if (view.logoUrl) return html`<link rel="icon" href="${view.logoUrl}">`;
  const base = view.assets.style.replace(/[^/]*$/, "");
  return html`<link rel="icon" type="image/svg+xml" href="${base}${PORTAL_ICONS.standard}"><link rel="icon" type="image/svg+xml" href="${base}${PORTAL_ICONS.light}" media="(prefers-color-scheme: dark)"><link rel="icon" type="image/svg+xml" href="${base}${PORTAL_ICONS.contrast}" media="(prefers-contrast: more)">`;
}

function brandMark(view: PortalView): Html {
  return view.logoUrl
    ? html`<img src="${view.logoUrl}" alt="">`
    : html`<span class="mark" aria-hidden="true" data-initial="${initialOf(view.config.name)}"></span>`;
}

function searchForm(
  view: PortalView,
  id: string,
  value = "",
  options: { button?: boolean; error?: boolean } = {},
): Html {
  const errorId = `${id}-error`;
  return html`<form class="bsearch" role="search" action="${view.links.searchAction}" method="get" data-search>
      ${icon("search")}<label class="sr" for="${id}">${view.t.searchLabel}</label>
      <input id="${id}" name="q" type="search" value="${value}" placeholder="${view.t.searchPlaceholder}" autocomplete="off" maxlength="200"${raw(options.error ? ` aria-invalid="true" aria-describedby="${errorId}"` : "")}>
      ${when(options.button !== false, () => html`<button class="btn primary" type="submit">${view.t.searchButton}</button>`)}
    </form>
    <p class="err" id="${errorId}"${raw(options.error ? "" : " hidden")} data-search-error>${icon("circle-alert")}${view.t.searchEmpty}</p>`;
}

function areasMenu(view: PortalView, current: string | null): Html {
  return html`<details class="dd areas" data-menu><summary>${view.t.areas}${icon("chevron-down")}</summary>
    <div class="menu mega"><nav aria-label="${view.t.categoriesNavigation}">${areasOf(view).map(
      (area) =>
        html`<a href="${view.links.category(area.id)}"${raw(area.id === current ? ' aria-current="page"' : "")}>${folderIcon(area, 32)}<span class="trunc" title="${area.title}">${area.title}</span><span class="n">${area.articles}</span></a>`,
    )}</nav></div></details>`;
}

function languageMenu(view: PortalView): Html | null {
  const current = view.languageLinks.find((link) => link.current);
  return when(
    view.languageLinks.length > 1,
    () =>
      html`<details class="dd lang" data-menu><summary>${icon("languages")}<span class="code" aria-hidden="true">${(current?.language ?? "").toUpperCase()}</span><span class="sr">${view.t.languageCurrent(current?.label ?? "")}</span></summary>
        <div class="menu" role="list" aria-label="${view.t.languageMenu}">${view.languageLinks.map(
          (link) =>
            html`<a href="${link.href}" hreflang="${link.language}" lang="${link.language}"${raw(link.current ? ' aria-current="true"' : "")}><span class="cur">${when(link.current, () => icon("check"))}</span><span class="trunc" title="${link.label}">${link.label}</span>${when(link.detail, () => html`<span class="n" lang="${view.lang}">${link.detail ?? ""}</span>`)}</a>`,
        )}</div></details>`,
  );
}

function themeMenu(view: PortalView): Html {
  const { t } = view;
  const choices = [
    ["system", "sun-moon", t.themes.system],
    ["light", "sun", t.themes.light],
    ["dark", "moon", t.themes.dark],
  ] as const;
  return html`<details class="dd theme" data-menu data-theme-menu hidden><summary aria-label="${t.appearance}">${icon("sun-moon")}</summary>
    <div class="menu" role="group" aria-label="${t.appearance}">${choices.map(
      ([value, name, label]) =>
        html`<button type="button" data-theme-choice="${value}" aria-pressed="false">${icon(name)}<span>${label}</span><span class="cur">${icon("check")}</span></button>`,
    )}</div></details>`;
}

function header(view: PortalView, options: { current?: string | null; navigation?: boolean }): Html {
  const navigation = options.navigation !== false;
  const current = options.current ?? null;
  const account = view.account;
  const areas = areasOf(view);
  return html`<header class="ph"><div class="pw ph-in">
      <a class="brand" href="${view.links.home}" aria-label="${view.t.home(view.config.name)}">${brandMark(view)}<b class="trunc">${view.config.name}</b></a>
      ${when(navigation && areas.length > 0, () => html`<div class="wide-only">${areasMenu(view, current)}</div>`)}
      <div class="ph-r">
        ${when(
          navigation,
          () =>
            html`<a class="btn ghost icon" href="${view.links.search()}" aria-label="${view.t.quickSearch}" title="${view.t.quickSearch}"${raw(view.quickSearch ? " data-quick-open" : "")}>${icon("search")}</a>`,
        )}
        ${languageMenu(view)}
        ${themeMenu(view)}
        ${when(
          navigation,
          () =>
            html`<button class="btn ghost icon narrow" type="button" aria-expanded="false" aria-controls="pmenu" data-open-label="${view.t.openMenu}" data-close-label="${view.t.closeMenu}" aria-label="${view.t.openMenu}" data-phone-menu>${icon("menu")}</button>`,
        )}
        ${
          account
            ? html`<details class="acct" data-menu><summary aria-label="${view.t.account(account.name)}"><span class="av" aria-hidden="true" data-initial="${initialOf(account.name).slice(0, 2)}"></span><span class="name trunc wide-only">${account.name}</span>${icon("chevron-down")}</summary>
              <div class="menu"><div class="mh"><b>${account.name}</b><span>${account.email}</span></div>
                ${when(view.accountLink, () => html`<a href="${view.accountLink ?? ""}">${icon("user-round")}${view.t.accountSettings}</a>`)}
                ${when(view.appLink, () => html`<a href="${view.appLink?.href ?? ""}">${icon("external-link")}${view.appLink?.label ?? ""}</a>`)}
                <form method="post" action="${view.signOutUrl}"><button type="submit">${icon("log-out")}${view.t.signOut}</button></form>
              </div></details>`
            : when(
                view.signInUrl,
                () => html`<a class="btn sm wide-only" href="${view.signInUrl ?? ""}">${view.t.signIn}</a>`,
              )
        }
      </div>
    </div></header>
    ${when(
      navigation,
      () => html`<div class="pmenu" id="pmenu" hidden><div class="pw">
      ${searchForm(view, "phone-search", "", { button: false })}
      <nav aria-label="${view.t.categoriesNavigation}">${areas.map(
        (area) =>
          html`<a href="${view.links.category(area.id)}">${folderIcon(area, 32)}<span class="trunc">${area.title}</span><span class="n">${view.t.articleCount(area.articles)}</span></a>`,
      )}</nav>
      ${when(!account && view.signInUrl, () => html`<p class="gap-top"><a class="btn primary" href="${view.signInUrl ?? ""}">${icon("log-in")}${view.t.signIn}</a></p>`)}
    </div></div>`,
    )}`;
}

function quickSearchDialog(view: PortalView): Html | null {
  const { t } = view;
  return when(
    view.quickSearch,
    () =>
      html`<div class="qs-back" hidden data-quick data-endpoint="${view.quickSearch ?? ""}" data-topics="${t.quickTopics}" data-articles="${t.quickArticles}" data-none="${t.quickNone("{query}")}" data-failed="${t.quickFailed}" data-all-one="${t.quickAll(1)}" data-all-other="${t.quickAll(QUICK_COUNT_MARK).replace(String(QUICK_COUNT_MARK), "{count}")}">
      <div class="qs" role="dialog" aria-modal="true" aria-label="${t.quickSearch}">
        <form class="qs-in" role="search" action="${view.links.searchAction}" method="get">${icon("search")}
          <input name="q" type="search" autocomplete="off" maxlength="200" aria-label="${t.searchLabel}" placeholder="${t.searchPlaceholder}" role="combobox" aria-expanded="false" aria-controls="qs-list" aria-autocomplete="list">
          <button class="kbd" type="button" data-quick-close><span aria-hidden="true">Esc</span><span class="sr">${t.quickClose}</span></button></form>
        <div class="qs-list" id="qs-list" role="listbox" aria-label="${t.quickSearch}"></div>
        <p class="qs-msg" role="status" hidden></p>
        <div class="qs-foot"><span>${t.quickMove}</span><span>${t.quickOpen}</span><a href="${view.links.searchAction}" data-quick-all hidden></a></div>
      </div></div>`,
  );
}

function footer(view: PortalView): Html {
  return html`<footer class="pfoot"><div class="pw"><div class="in">
    <span>${view.config.name}</span><span aria-hidden="true">·</span><a href="${view.links.contact()}">${view.t.contact}</a>
    ${when(view.config.poweredBy, () => html`<span class="by">${view.t.poweredBy}</span>`)}
  </div></div></footer>`;
}

export function layout(
  view: PortalView,
  options: {
    title: string;
    current?: string | null;
    navigation?: boolean;
    robots?: string;
    overlay?: Html;
  },
  content: Html,
): string {
  const title =
    options.title === view.config.name ? view.config.name : `${options.title} · ${view.config.name}`;
  const robots = options.robots ?? (view.config.audience === "public" ? "index,follow" : "noindex,nofollow");
  return `<!doctype html>${
    html`<html lang="${view.lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="${robots}">
<title>${title}</title>
${favicon(view)}
${view.alternates.map((alternate) => html`<link rel="alternate" hreflang="${alternate.hreflang}" href="${alternate.href}">`)}
<script src="${view.assets.theme}"></script>
<link rel="stylesheet" href="${view.assets.style}">
<style nonce="${view.nonce}">${raw(view.brandStyle)}</style>
<script src="${view.assets.script}" defer></script>
</head><body><a class="skip" href="#content">${view.t.skipToContent}</a><div class="page">
${header(view, options)}
<main id="content" tabindex="-1">${when(view.maintenance, () => html`<div class="pw"><p class="maintnote" role="status">${icon("wrench")}<span>${view.t.maintenance}${when(Boolean(view.maintenance?.message), () => html` <strong>${view.maintenance?.message ?? ""}</strong>`)}</span></p></div>`)}${when(view.note, () => html`<div class="pw"><p class="langnote" role="note" lang="${view.note?.lang ?? ""}">${icon("languages")}${view.note?.text ?? ""}</p></div>`)}${content}</main>
${footer(view)}
</div>${options.overlay ?? ""}${quickSearchDialog(view)}<div class="toast" role="status" aria-live="polite" hidden data-toast></div></body></html>`
      .value
  }`;
}

function articleRow(view: PortalView, article: PortalArticleSummary, options: { below?: string } = {}): Html {
  const path = pathOf(view, article.folderIds, options.below);
  return html`<li><a href="${view.links.article(article)}"><span class="doc" aria-hidden="true">${icon("file-text")}</span><span class="g"><span class="t">${article.title}</span>${onlyIn(view, article)}${metaLine([kindText(view, article.type), path, html`${view.t.updatedOnShort(shortDate(view, article.updatedAt))}`])}</span>${icon("chevron-right", "chev")}</a></li>`;
}

function areaGrid(view: PortalView): Html {
  return html`<div class="areas">${areasOf(view).map(
    (area) =>
      html`<a class="area" href="${view.links.category(area.id)}">${folderIcon(area, 40)}<b class="clamp2" title="${area.title}">${area.title}</b><span class="n">${view.t.articleCount(area.articles)}</span></a>`,
  )}</div>`;
}

export function startPage(
  view: PortalView,
  data: { mostRead: PortalArticleSummary[]; recent: PortalArticleSummary[]; frequent: string[] },
): string {
  const { t, config } = view;
  const empty = view.categories.length === 0 && data.recent.length === 0;
  return layout(
    view,
    { title: config.name },
    html`<section class="hero"><div class="pw">
      <h1>${config.welcomeHeading || t.defaultHeading}</h1>
      ${when(config.welcomeText, () => html`<p class="lead">${config.welcomeText}</p>`)}
      ${searchForm(view, "start-search")}
      ${when(
        data.frequent.length > 0,
        () =>
          html`<div class="popular"><span>${t.frequentSearches}</span>${data.frequent.map(
            (term) => html`<a class="pill" href="${view.links.search(term)}">${term}</a>`,
          )}</div>`,
      )}
    </div></section>
    <div class="pw">
      ${
        empty
          ? html`<section class="empty" aria-labelledby="empty-heading"><h2 class="h3" id="empty-heading">${t.emptyHeading}</h2><p>${view.account ? t.emptyTextSignedIn : t.emptyText}</p>${when(view.signInUrl, () => html`<p class="row gap-top"><a class="btn primary" href="${view.signInUrl ?? ""}">${icon("log-in")}${t.signIn}</a></p>`)}</section>`
          : html`
      ${when(
        view.categories.length > 0,
        () =>
          html`<section class="sec" aria-labelledby="topics-heading"><h2 class="h2" id="topics-heading">${t.topicsHeading}</h2>${areaGrid(view)}</section>`,
      )}
      <div class="sec${data.mostRead.length > 0 && data.recent.length > 0 ? " cols2" : ""}">
        ${when(data.mostRead.length > 0, () => html`<section aria-labelledby="top-heading"><h2 class="h3" id="top-heading">${t.mostRead}</h2><ul class="alist">${data.mostRead.map((article) => articleRow(view, article))}</ul></section>`)}
        ${when(data.recent.length > 0, () => html`<section aria-labelledby="recent-heading"><h2 class="h3" id="recent-heading">${t.recentlyUpdated}</h2><ul class="alist">${data.recent.map((article) => articleRow(view, article))}</ul></section>`)}
      </div>`
      }
      <section class="help-cta" aria-labelledby="cta-heading"><h2 class="h3" id="cta-heading">${t.noAnswerHeading}</h2><p>${t.noAnswerText}</p><a class="btn primary" href="${view.links.contact()}">${icon("mail")}${t.writeUs}</a></section>
    </div>`,
  );
}

function crumbs(view: PortalView, items: { label: string; href?: string }[]): Html {
  return html`<nav class="crumbs" aria-label="${view.t.breadcrumb}"><a href="${view.links.home}">${view.config.name}</a>${items.map(
    (item) =>
      html`${icon("chevron-right")}${item.href ? html`<a href="${item.href}">${item.label}</a>` : html`<span aria-current="page">${item.label}</span>`}`,
  )}</nav>`;
}

function treeItem(view: PortalView, folder: PortalCategory, current: string | null, open: Set<string>): Html {
  const children = childrenOf(view, folder.id);
  const expanded = open.has(folder.id);
  const listId = `t-${folder.id}`;
  return html`<li><div class="trow">${
    children.length > 0
      ? html`<button class="tg" type="button" hidden data-tree-toggle aria-controls="${listId}" aria-expanded="${String(expanded)}" aria-label="${expanded ? view.t.collapse(folder.title) : view.t.expand(folder.title)}" data-expand="${view.t.expand(folder.title)}" data-collapse="${view.t.collapse(folder.title)}">${icon("chevron-right")}</button>`
      : html`<span class="tg" aria-hidden="true"></span>`
  }<a href="${view.links.category(folder.id)}"${raw(folder.id === current ? ' aria-current="page"' : "")}>${when(folder.restricted, () => html`<span class="lock" title="${view.t.restricted}">${icon("lock")}<span class="sr">${view.t.restricted}</span></span>`)}<span class="trunc" title="${folder.title}">${folder.title}</span><span class="n">${folder.articles}</span></a></div>${when(
    children.length > 0,
    () =>
      html`<ul id="${listId}"${raw(expanded ? "" : " hidden")}>${children.map((child) => treeItem(view, child, current, open))}</ul>`,
  )}</li>`;
}

function treeNav(view: PortalView, current: string | null, trail: readonly PortalCategory[]): Html | null {
  const area = trail[0];
  if (!area) return null;
  const open = new Set(trail.map((folder) => folder.id));
  return html`<div class="side"><button class="btn sm treebtn" type="button" hidden data-tree-drawer aria-expanded="false" aria-controls="ptree" data-open-label="${view.t.showTopics}" data-close-label="${view.t.hideTopics}">${icon("folder")}<span>${view.t.showTopics}</span></button>
    <nav class="ptree" id="ptree" aria-label="${view.t.topicsIn(area.title)}">
      <a class="back" href="${view.links.home}">${icon("chevron-left")}${view.t.allAreas}</a>
      <a class="troot" href="${view.links.category(area.id)}"${raw(area.id === current ? ' aria-current="page"' : "")}>${folderIcon(area, 32)}<span class="trunc" title="${area.title}">${area.title}</span><span class="n">${area.articles}</span></a>
      <ul>${childrenOf(view, area.id).map((folder) => treeItem(view, folder, current, open))}</ul>
    </nav></div>`;
}

export interface CategoryState {
  type: PortalArticleFilter | null;
  sort: ArticleSort;
  page: number;
  deep: boolean;
}

function categoryQuery(state: CategoryState, changes: Partial<CategoryState>): string {
  const next = { ...state, ...changes };
  const params = new URLSearchParams();
  if (next.deep) params.set("deep", "1");
  if (next.type) params.set("type", next.type);
  if (next.sort !== "views") params.set("sort", next.sort);
  if (next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

function contactLine(view: PortalView, folder: PortalCategory): Html | null {
  return when(
    folder.contactEmail,
    () =>
      html`<p class="contactline">${icon("mail")}${view.t.contactLine(folder.title)} <a href="${mailto(folder.contactEmail ?? "", folder.title)}">${folder.contactEmail ?? ""}</a></p>`,
  );
}

export function categoryPage(
  view: PortalView,
  category: PortalCategory,
  list: ArticlePage,
  state: CategoryState,
  pageSize: number,
): string {
  const { t } = view;
  const trail = ancestorsOf(view.categories, category);
  const subfolders = childrenOf(view, category.id);
  const path = view.links.category(category.id);
  const dynamic = !view.static;
  const filters: [PortalArticleFilter | null, string][] = [
    [null, t.filters.all],
    ["howTo", t.filters.howTo],
    ["troubleshooting", t.filters.troubleshooting],
  ];
  const pages = Math.max(1, Math.ceil(list.total / pageSize));
  const empty =
    state.type !== null
      ? t.noArticlesOfType
      : subfolders.length > 0 && !state.deep
        ? t.noDirectArticles
        : t.noArticlesOfType;
  return layout(
    view,
    { title: category.title, current: trail[0]?.id ?? category.id },
    html`<div class="pw split">
      ${treeNav(view, category.id, trail)}
      <div class="main">
      ${crumbs(
        view,
        trail.map((entry) =>
          entry.id === category.id
            ? { label: entry.title }
            : { label: entry.title, href: view.links.category(entry.id) },
        ),
      )}
      <header class="chead">${category.restricted ? html`<span class="cicon s40" aria-hidden="true">${icon("lock")}</span>` : folderIcon(category, 40)}<h1>${category.title}</h1></header>
      ${when(category.description, () => html`<div class="intro">${introduction(category.description)}</div>`)}
      ${contactLine(view, category)}
      ${when(
        subfolders.length > 0,
        () =>
          html`<section class="sec s8" aria-labelledby="subs-heading"><h2 class="h4" id="subs-heading">${t.topicsIn(category.title)}</h2><div class="subgrid">${subfolders.map(
            (sub) => {
              const below = childrenOf(view, sub.id).length;
              return html`<a class="subtile" href="${view.links.category(sub.id)}">${sub.restricted ? html`<span class="cicon s32" aria-hidden="true">${icon("lock")}</span>` : folderIcon(sub, 32)}<span class="g"><b class="trunc" title="${sub.title}">${sub.title}</b><span class="n">${t.articleCount(sub.articles)}${when(below > 0, () => html` · ${t.subtopicCount(below)}`)}</span></span></a>`;
            },
          )}</div></section>`,
      )}
      <section class="sec s8" aria-labelledby="list-heading">
        <div class="listbar"><h2 class="h4" id="list-heading">${state.deep ? t.allArticlesIn(category.title) : t.articlesIn(category.title)} <span class="cnt">${list.total}</span></h2>
          ${when(
            dynamic,
            () => html`<div class="chips">
            ${when(
              subfolders.length > 0,
              () =>
                html`<a class="pill" href="${path}${categoryQuery(state, { deep: !state.deep, page: 1 })}" aria-pressed="${String(state.deep)}" role="button">${state.deep ? icon("check") : null}${t.includeSubtopics}</a>`,
            )}
            ${when(
              list.typeCounts.howTo + list.typeCounts.troubleshooting > 0,
              () =>
                html`<nav class="pills" aria-label="${t.articleTypeGroup}">${filters.map(
                  ([type, label]) =>
                    html`<a class="pill" href="${path}${categoryQuery(state, { type, page: 1 })}"${raw(state.type === type ? ' aria-current="true"' : "")}>${label}</a>`,
                )}</nav>`,
            )}
            <form method="get" action="${path}" data-autosubmit>
              ${when(state.deep, () => html`<input type="hidden" name="deep" value="1">`)}
              ${when(state.type, () => html`<input type="hidden" name="type" value="${state.type ?? ""}">`)}
              <span class="sel"><label class="sr" for="sort">${t.sortLabel}</label><select id="sort" name="sort">${(
                ["views", "updated", "title"] as const
              ).map(
                (sort) =>
                  html`<option value="${sort}"${raw(state.sort === sort ? " selected" : "")}>${t.sorts[sort]}</option>`,
              )}</select>${icon("chevron-down")}</span>
              <noscript><button class="btn" type="submit">${t.sortLabel}</button></noscript>
            </form></div>`,
          )}
        </div>
        ${
          list.articles.length === 0
            ? html`<p class="hint emptyline">${empty}</p>`
            : html`<ul class="alist">${list.articles.map((article) => articleRow(view, article, { below: category.id }))}</ul>`
        }
        ${when(
          dynamic && pages > 1,
          () => html`<nav class="more" aria-label="${t.pageOf(state.page, pages)}">
          ${when(state.page > 1, () => html`<a class="btn" href="${path}${categoryQuery(state, { page: state.page - 1 })}">${t.previous}</a>`)}
          <span class="hint">${t.pageOf(state.page, pages)}</span>
          ${when(state.page < pages, () => html`<a class="btn" href="${path}${categoryQuery(state, { page: state.page + 1 })}">${t.moreArticles}</a>`)}
        </nav>`,
        )}
      </section>
      </div>
    </div>`,
  );
}

export function decorateArticleHtml(markup: string, base: string, root: string = base): string {
  return markup
    .replaceAll(`${PORTAL_BASE_PLACEHOLDER}/files/`, `${root}/files/`)
    .replaceAll(`${PORTAL_BASE_PLACEHOLDER}/`, `${base}/`)
    .replace(
      /(<section class="ld-section"[^>]*?data-icon="([a-z0-9-]+)"[^>]*><h2 id="[^"]*">)/g,
      (_match, opening: string, name: string) =>
        hasIcon(name) ? `${opening}<span class="hb" aria-hidden="true">${icon(name).value}</span>` : opening,
    );
}

export function articleUrl(view: PortalView, article: { number: number; slug: string }): string | null {
  return view.links.share(article);
}

function contactBlock(view: PortalView, contact: string | null, mail: string | null, subject: string): Html {
  const { t } = view;
  return contact && mail
    ? html`<div class="row"><a class="btn" href="${mail}" data-mail>${icon("mail")}${t.mailButton}</a><button class="btn ghost" type="button" data-copy="${contact}" data-copied="${t.copied}" data-copy-failed="${t.copyFailed(contact)}">${icon("copy")}${t.copyAddress}</button></div>
                  <p class="hint">${t.contactHint(contact, subject)}</p>`
    : html`<p class="hint">${t.noContact}</p>`;
}

export function articlePage(
  view: PortalView,
  article: PortalArticle,
  data: { related: PortalArticleSummary[]; similar: PortalArticleSummary[]; editUrl: string | null },
): string {
  const { t } = view;
  const folders = folderTrail(view.categories, article.folderIds);
  const subject = t.mailSubject(article.title);
  const contact = article.contactEmail;
  const shared = articleUrl(view, article);
  const mail = contact ? mailto(contact, subject, shared ? t.mailBody(shared) : undefined) : null;
  const toc = article.headings.filter((heading) => heading.level <= 2);
  const trail = folders.map((folder) => ({ label: folder.title, href: view.links.category(folder.id) }));
  const others = article.fallback
    ? []
    : view.languageLinks.filter(
        (link) => !link.current && article.alternates.some((entry) => entry.language === link.language),
      );
  return layout(
    view,
    { title: article.title, current: folders[0]?.id ?? null },
    html`<div class="pw split">
      ${treeNav(view, folders.at(-1)?.id ?? null, folders)}
      <div class="main">
      ${crumbs(view, trail)}
      <div class="art">
        <article>
          <header class="ahead">
            <div class="row1">${when(article.type, () => html`<span class="kind ${article.type ?? ""}">${icon(article.type ? TYPE_ICONS[article.type] : "file-text")}${article.type ? t.types[article.type] : ""}</span>`)}
              ${when(data.editUrl, () => html`<span class="editbox"><span class="hint wide-only">${t.editHint}</span><a class="btn sm" href="${data.editUrl ?? ""}">${icon("square-pen")}${t.edit}</a></span>`)}</div>
            <h1 lang="${article.language}">${article.title}</h1>
            ${when(article.lead, () => html`<p class="lead" lang="${article.language}">${article.lead}</p>`)}
            <div class="meta"><span>${icon("history")}${changedOn(view, article)}</span>
              ${others.map((link) => html`<a href="${link.href}" hreflang="${link.language}">${icon("globe")}${t.alsoIn(languageName(link.language, view.lang))}</a>`)}
              ${when(shared && !view.static, () => html`<button class="linkbtn" type="button" data-copy="${shared ?? ""}" data-copied="${t.linkCopied}" data-copy-failed="${t.linkCopyFailed(shared ?? "")}">${icon("copy")}${t.copyLink}</button>`)}</div>
          </header>
          ${when(
            toc.length > 1,
            () =>
              html`<details class="toc-m"><summary>${t.onThisPage}${icon("chevron-down")}</summary><nav aria-label="${t.onThisPage}">${toc.map(
                (heading) => html`<a href="#${heading.id}">${heading.title}</a>`,
              )}</nav></details>`,
          )}
          <div class="body" lang="${article.language}">${raw(decorateArticleHtml(article.html, view.base, view.root))}</div>
          ${
            view.static
              ? html`<section class="fb" id="feedback" aria-labelledby="contact-heading"><div class="contact"><h2 class="h4" id="contact-heading">${t.contactHeading}</h2>${contactBlock(view, contact, mail, subject)}</div></section>`
              : html`<section class="fb" id="feedback" aria-labelledby="feedback-heading" data-feedback="${article.itemId}" data-endpoint="${view.root}/feedback">
            <div class="q"><h2 id="feedback-heading">${t.helpfulQuestion}</h2>
              <div class="row" data-step="ask"><button class="btn sm" type="button" data-rate="yes">${icon("thumbs-up")}${t.yes}</button><button class="btn sm" type="button" data-rate="no">${icon("thumbs-down")}${t.no}</button></div></div>
            <p class="hint" data-step="ask">${t.ratingHint}</p>
            <p class="thanks" data-step="thanks" hidden>${icon("circle-check")}${t.thanks}</p>
            <div class="field" data-step="text" hidden><label for="missing">${t.missingLabel}</label><textarea class="ta" id="missing" maxlength="2000" placeholder="${t.missingPlaceholder}" aria-describedby="missing-hint"></textarea><span class="hint" id="missing-hint">${t.missingHint}</span></div>
            <div class="row" data-step="text" hidden><button class="btn primary" type="button" data-send>${t.sendHint}</button><button class="btn ghost" type="button" data-skip>${t.skipHint}</button></div>
            <p class="thanks" data-step="sent" hidden>${icon("circle-check")}<span data-sent-text data-with-text="${t.sentThanksWithText}">${t.sentThanks}</span></p>
            <div class="alert inline" role="alert" data-step="failed" hidden>${icon("circle-alert")}<div><p data-failed-text data-too-long="${t.feedbackTooLong}">${t.feedbackFailed}</p><p class="gap-top"><button class="btn" type="button" data-retry>${icon("refresh-cw")}${t.retry}</button></p></div></div>
            <div class="contact">
              <h3>${t.contactHeading}</h3>
              ${contactBlock(view, contact, mail, subject)}
            </div>
          </section>`
          }
          ${when(
            data.related.length > 0,
            () =>
              html`<section class="related" aria-labelledby="related-heading"><h2 class="h4" id="related-heading">${t.relatedTroubleshooting}</h2><ul class="alist">${data.related.map((entry) => articleRow(view, entry))}</ul></section>`,
          )}
          ${when(
            data.similar.length > 0,
            () =>
              html`<section class="related" aria-labelledby="similar-heading"><h2 class="h4" id="similar-heading">${t.similarArticles}</h2><ul class="alist">${data.similar.map((entry) => articleRow(view, entry))}</ul></section>`,
          )}
        </article>
        <aside><nav class="toc" aria-label="${t.onThisPage}">
          ${when(toc.length > 0, () => html`<h2>${t.onThisPage}</h2>${toc.map((heading) => html`<a href="#${heading.id}">${heading.title}</a>`)}`)}
          <div class="tocfoot">${when(!view.static, () => html`<a href="#feedback">${icon("message-circle-question")}${t.giveFeedback}</a>`)}${when(mail, () => html`<a href="${mail ?? ""}">${icon("mail")}${t.writeUs}</a>`)}</div>
        </nav></aside>
      </div>
      </div>
    </div>`,
  );
}

function areaChoice(view: PortalView, subject: string): Html {
  const { t } = view;
  const options = [
    ...areasOf(view)
      .filter((category) => category.contactEmail)
      .map((category) => ({
        label: category.title,
        icon: category.icon,
        email: category.contactEmail ?? "",
      })),
    ...(view.config.contactEmail
      ? [{ label: t.areaOther, icon: "circle-help", email: view.config.contactEmail }]
      : []),
  ];
  if (options.length === 0) return html`<p class="hint">${t.noContact}</p>`;
  return html`<ul class="maillist">${options.map(
    (option) =>
      html`<li>${folderIcon({ title: option.label, icon: option.icon }, 32)}<span class="g"><b class="trunc" title="${option.label}">${option.label}</b><span class="m">${option.email}</span></span>
        <span class="row"><a class="btn sm" href="${mailto(option.email, subject)}">${icon("mail")}${t.mailButton}</a>${when(!view.static, () => html`<button class="btn sm ghost" type="button" data-copy="${option.email}" data-copied="${t.copied}" data-copy-failed="${t.copyFailed(option.email)}" aria-label="${t.copyAddress}: ${option.label}">${icon("copy")}${t.copy}</button>`)}</span></li>`,
  )}</ul>`;
}

function excerpt(parts: { text: string; highlighted: boolean }[]): Html {
  return html`${parts.map((part) => (part.highlighted ? html`<mark>${part.text}</mark>` : html`${part.text}`))}`;
}

export interface SearchState {
  query: string;
  categoryId: string | null;
  type: PortalArticleFilter | null;
}

function searchQuery(state: SearchState, changes: Partial<SearchState>): string {
  const next = { ...state, ...changes };
  const params = new URLSearchParams({ q: next.query });
  if (next.categoryId) params.set("category", next.categoryId);
  if (next.type) params.set("type", next.type);
  return `?${params.toString()}`;
}

export function searchPage(
  view: PortalView,
  state: SearchState,
  result: PortalSearchResult,
  more: string | null,
  mostRead: PortalArticleSummary[],
): string {
  const { t } = view;
  if (result.total === 0 && !state.categoryId && !state.type)
    return noResultsPage(view, state, result, mostRead);
  const path = `${view.base}/search`;
  const allCount = result.categories.reduce((sum, entry) => sum + entry.count, 0);
  const typeFilters: [PortalArticleFilter | null, string, number][] = [
    [null, t.filters.all, result.typeCounts.all],
    ["howTo", t.filters.howTo, result.typeCounts.howTo],
    ["troubleshooting", t.filters.troubleshooting, result.typeCounts.troubleshooting],
  ];
  return layout(
    view,
    { title: t.resultsFor(result.total, state.query), robots: "noindex,follow" },
    html`<div class="pw">
      <div class="shead">${searchForm(view, "search", state.query)}</div>
      ${when(result.suggestion, () => html`<p class="suggest">${t.didYouMean} <a href="${view.links.search(result.suggestion ?? "")}">${result.suggestion ?? ""}</a></p>`)}
      <div class="scount"><h1>${t.resultsFor(result.total, state.query)}</h1>
        <nav class="pills" aria-label="${t.filterByCategory}">
          <a class="pill" href="${path}${searchQuery(state, { categoryId: null })}"${raw(state.categoryId === null ? ' aria-current="true"' : "")}>${t.filters.all} <span class="n">${allCount || result.total}</span></a>
          ${result.categories.map((entry) => {
            const category = categoryOf(view, entry.id);
            return category
              ? html`<a class="pill" href="${path}${searchQuery(state, { categoryId: entry.id })}"${raw(state.categoryId === entry.id ? ' aria-current="true"' : "")}>${category.title} <span class="n">${entry.count}</span></a>`
              : null;
          })}
        </nav></div>
      ${when(
        result.typeCounts.howTo + result.typeCounts.troubleshooting > 0,
        () =>
          html`<nav class="pills" aria-label="${t.articleTypeGroup}">${typeFilters.map(
            ([type, label, count]) =>
              html`<a class="pill" href="${path}${searchQuery(state, { type })}"${raw(state.type === type ? ' aria-current="true"' : "")}>${label} <span class="n">${count}</span></a>`,
          )}</nav>`,
      )}
      <div class="sgrid">
        <div>
          ${
            result.results.length === 0
              ? html`<p class="hint">${t.noArticlesOfType}</p>`
              : html`<ul class="res">${result.results.map((hit) => {
                  const path = pathOf(view, hit.folderIds);
                  const other = hit.language !== view.lang;
                  return html`<li${raw(other ? ` lang="${hit.language}"` : "")}><span class="path" lang="${view.lang}">${kindText(view, hit.type)}${when(hit.type && path, () => html`<span class="dot"></span>`)}${path}${when(other, () => html`<span class="ltag">${icon("languages")}${languageName(hit.language, view.lang)}</span>`)}</span>
                    <a class="t" href="${view.links.article(hit)}">${hit.title}</a>
                    ${when(hit.excerpt.length > 0, () => html`<p>${excerpt(hit.excerpt)}</p>`)}
                    <span class="path" lang="${view.lang}">${icon("history")}${changedOn(view, hit)}</span></li>`;
                })}</ul>`
          }
          ${when(more, () => html`<div class="more"><a class="btn" href="${more ?? ""}">${t.moreArticles}</a></div>`)}
        </div>
        <aside class="aside-card" aria-labelledby="not-right"><h2 id="not-right">${t.notRightHeading}</h2><p>${t.notRightText}</p><div><a class="btn" href="${view.links.contact(state.query)}">${icon("mail")}${t.contactByArea}</a></div></aside>
      </div>
    </div>`,
  );
}

function noResultsPage(
  view: PortalView,
  state: SearchState,
  result: PortalSearchResult,
  mostRead: PortalArticleSummary[],
): string {
  const { t } = view;
  return layout(
    view,
    { title: t.noResultsHeading(state.query), robots: "noindex,follow" },
    html`<div class="pw"><div class="center">
      <div class="shead flush spaced">${searchForm(view, "search", state.query)}</div>
      <span class="cicon s56" aria-hidden="true">${icon("search-x")}</span>
      <h1>${t.noResultsHeading(state.query)}</h1>
      <p class="lead">${t.noResultsLead}</p>
      ${when(result.suggestion, () => html`<p class="suggest">${t.didYouMean} <a href="${view.links.search(result.suggestion ?? "")}">${result.suggestion ?? ""}</a></p>`)}
      <div class="tips"><div><b>${t.tipSpelling}</b>${t.tipSpellingText}</div><div><b>${t.tipGeneral}</b>${t.tipGeneralText}</div>
        <div><b>${t.tipBrowse}</b>${areasOf(view).map((category, index) => html`${index > 0 ? ", " : ""}<a href="${view.links.category(category.id)}">${category.title}</a>`)}</div></div>
      <section class="panel" aria-labelledby="area-heading"><h2 id="area-heading">${t.areaHeading}</h2><p>${t.areaText}</p>
        ${areaChoice(view, t.searchSubject(state.query))}
        <p class="hint">${t.zeroResultsCounted}</p></section>
      ${when(mostRead.length > 0, () => html`<section class="sec s14" aria-labelledby="top-heading"><h2 class="h3" id="top-heading">${t.mostRead}</h2><ul class="alist">${mostRead.map((article) => articleRow(view, article))}</ul></section>`)}
    </div></div>`,
  );
}

export function searchFailedPage(view: PortalView, query: string): string {
  const { t } = view;
  return layout(
    view,
    { title: t.searchFailedHeading, robots: "noindex,follow" },
    html`<div class="pw"><div class="center">
      <div class="shead flush">${searchForm(view, "search", query)}</div>
      <div class="alert" role="alert">${icon("circle-alert")}<div><b>${t.searchFailedHeading}</b><p>${t.searchFailedText(query)}</p>
        <p class="gap-top"><a class="btn primary" href="${view.links.search(query)}">${icon("refresh-cw")}${t.searchAgain}</a></p></div></div>
      ${when(view.categories.length > 0, () => html`<section class="sec s14" aria-labelledby="topics-heading"><h2 class="h3" id="topics-heading">${t.topicsHeading}</h2>${areaGrid(view)}</section>`)}
    </div></div>`,
  );
}

export function emptySearchPage(view: PortalView): string {
  const { t } = view;
  return layout(
    view,
    { title: t.searchLabel, robots: "noindex,follow" },
    html`<div class="pw"><div class="center"><div class="shead flush">${searchForm(view, "search", "", { error: true })}</div></div></div>`,
  );
}

export function contactPage(view: PortalView, query: string): string {
  const { t } = view;
  return layout(
    view,
    { title: t.writeUs },
    html`<div class="pw"><div class="center">
      <h1>${t.noAnswerHeading}</h1>
      <p class="lead">${t.noAnswerText}</p>
      <section class="panel" aria-labelledby="area-heading"><h2 id="area-heading">${query ? t.areaHeading : t.contactAreaHeading}</h2><p>${query ? t.areaText : t.contactAreaText}</p>
        ${areaChoice(view, query ? t.searchSubject(query) : view.config.name)}</section>
    </div></div>`,
  );
}

export function notFoundPage(view: PortalView): string {
  const { t } = view;
  const contact = view.config.contactEmail;
  if (!view.account && view.signInUrl && !view.static) {
    return layout(
      view,
      { title: t.signInRestrictedHeading, robots: "noindex,nofollow" },
      html`<div class="pw"><div class="center">
        <section class="signcard" aria-labelledby="restricted-heading"><p class="kindline">${icon("lock")}${t.restricted}</p>
          <h1 id="restricted-heading">${t.signInRestrictedHeading}</h1>
          <p class="lead">${t.signInRestrictedText}</p>
          <p class="gap-top"><a class="btn primary" href="${view.signInUrl}">${icon("log-in")}${t.signIn}</a></p></section>
        ${when(view.categories.length > 0, () => html`<section class="sec s14" aria-labelledby="topics-heading"><h2 class="h3" id="topics-heading">${t.notFoundBrowse}</h2>${areaGrid(view)}</section>`)}
      </div></div>`,
    );
  }
  return layout(
    view,
    { title: t.notFoundHeading, robots: "noindex,nofollow" },
    html`<div class="pw"><div class="center">
      <span class="cicon s56" aria-hidden="true">${icon("file-question")}</span>
      <h1>${t.notFoundHeading}</h1>
      <p class="lead">${t.notFoundLead}</p>
      <div class="gap-top-lg">${searchForm(view, "search")}</div>
      ${when(view.categories.length > 0, () => html`<section class="sec s14" aria-labelledby="topics-heading"><h2 class="h3" id="topics-heading">${t.notFoundBrowse}</h2>${areaGrid(view)}</section>`)}
      <p class="hint note">${
        contact
          ? html`${t.notFoundLink} <a href="${mailto(contact, t.outdatedLinkSubject)}">${contact}</a>`
          : t.notFoundLinkNoContact
      }</p>
    </div></div>`,
  );
}

export interface PortalSignInMethod {
  label: string;
  action: string | null;
  href: string | null;
}

export function signInPage(
  view: PortalView,
  data: { methods: PortalSignInMethod[]; failed: boolean },
): string {
  const { t, config } = view;
  const last = data.methods.length - 1;
  return layout(
    view,
    {
      title: t.signIn,
      navigation: false,
      robots: "noindex,nofollow",
      overlay: html`<div class="dlg-back"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="signin-heading" aria-describedby="signin-lead">
      <span class="logo">${brandMark(view)}<b>${config.name}</b></span>
      <h1 id="signin-heading">${t.signInHeading}</h1>
      <p class="lead" id="signin-lead">${t.signInReturn(t.signInLead(config.name))}</p>
      ${when(data.failed, () => html`<div class="alert inline" role="alert">${icon("circle-alert")}<div><p>${t.signInFailed}</p></div></div>`)}
      ${
        data.methods.length === 0
          ? html`<p class="hint">${t.signInNoMethod}</p>`
          : html`<div class="methods">${data.methods.map((method, index) =>
              method.action
                ? html`<form method="post" action="${method.action}"><button class="btn lg${index === last ? " primary" : ""}" type="submit">${icon("key-round")}${method.label}</button></form>`
                : html`<a class="btn lg${index === last ? " primary" : ""}" href="${method.href ?? ""}">${icon("mail")}${method.label}</a>`,
            )}</div>`
      }
      ${when(config.contactEmail, () => html`<p class="fine">${t.signInProblems} <a href="${mailto(config.contactEmail ?? "", t.signIn)}">${config.contactEmail ?? ""}</a></p>`)}
    </div></div>`,
    },
    html`<div class="gated"></div>`,
  );
}

export function signedOutPage(view: PortalView): string {
  const { t } = view;
  return layout(
    view,
    { title: t.signedOutHeading, navigation: false, robots: "noindex,nofollow" },
    html`<div class="signin"><div class="card">
      <span class="logo">${brandMark(view)}</span>
      <h1>${t.signedOutHeading}</h1>
      <p class="lead">${t.signedOutLead}</p>
      <div class="methods">
        ${when(view.signInUrl, () => html`<a class="btn lg primary" href="${view.signInUrl ?? ""}">${icon("log-in")}${t.signInAgain}</a>`)}
        <a class="btn lg" href="${view.links.home}">${t.backToStart}</a>
      </div>
    </div></div>`,
  );
}

export function consentPage(
  view: PortalView,
  consent: { domain: string; action: string; fields: Record<string, string>; cancelUrl: string },
): string {
  const { t } = view;
  return layout(
    view,
    { title: t.consentHeading(consent.domain), navigation: false, robots: "noindex,nofollow" },
    html`<div class="signin"><div class="card">
      <span class="logo">${brandMark(view)}</span>
      <h1>${t.consentHeading(consent.domain)}</h1>
      <p class="lead">${t.consentLead(consent.domain)}</p>
      <form class="methods" method="post" action="${consent.action}">
        ${Object.entries(consent.fields).map(([name, value]) => html`<input type="hidden" name="${name}" value="${value}">`)}
        <button class="btn lg primary" type="submit">${icon("log-in")}${t.consentContinue}</button>
        <a class="btn lg" href="${consent.cancelUrl}">${t.consentCancel}</a>
      </form>
    </div></div>`,
  );
}

export function errorPage(view: PortalView, retryUrl: string): string {
  const { t } = view;
  return layout(
    view,
    { title: t.errorHeading, navigation: false, robots: "noindex,nofollow" },
    html`<div class="pw"><div class="center">
      <div class="alert" role="alert">${icon("circle-alert")}<div><b>${t.errorHeading}</b><p>${t.errorText}</p>
        <p class="gap-top"><a class="btn primary" href="${retryUrl}">${icon("refresh-cw")}${t.reload}</a></p></div></div>
    </div></div>`,
  );
}

const COUNT_MARK = 987654321;

export function staticSearchPage(view: PortalView, data: StaticSearchData): string {
  const { t } = view;
  return layout(
    view,
    { title: t.searchLabel, robots: "noindex,follow" },
    html`<div class="pw">
      <div class="shead">${searchForm(view, "search")}</div>
      <div data-static-search data-index="${data.index}" data-base="${data.base}" data-fallback-index="${data.fallbackIndex ?? ""}" data-fallback-base="${data.fallbackBase ?? ""}" data-fallback-language="${data.fallbackLanguage}" data-fallback-label="${languageName(data.fallbackLanguage, view.lang)}" data-results-one="${t.resultsFor(1, "{query}")}" data-results-other="${t.resultsFor(COUNT_MARK, "{query}").replace(String(COUNT_MARK), "{count}")}" data-results-none="${t.noResultsHeading("{query}")}" data-typehow-to="${t.types.howTo}" data-typetroubleshooting="${t.types.troubleshooting}">
        <div class="scount"><h1 data-heading hidden></h1></div>
        <ul class="res" data-results hidden></ul>
        <div class="center" data-empty hidden><span class="cicon s56" aria-hidden="true">${icon("search-x")}</span><p class="lead">${t.noResultsLead}</p>
          <div class="tips"><div><b>${t.tipSpelling}</b>${t.tipSpellingText}</div><div><b>${t.tipGeneral}</b>${t.tipGeneralText}</div>
            <div><b>${t.tipBrowse}</b>${areasOf(view).map(
              (category, index) =>
                html`${index > 0 ? ", " : ""}<a href="${view.links.category(category.id)}">${category.title}</a>`,
            )}</div></div>
          <p class="gap-top"><a class="btn" href="${view.links.contact()}">${icon("mail")}${t.contactByArea}</a></p></div>
        <div class="alert" role="alert" data-failed hidden>${icon("circle-alert")}<div><b>${t.searchFailedHeading}</b><p>${t.staticSearchFailed}</p></div></div>
        <noscript><p class="hint">${t.staticSearchNeedsScript}</p></noscript>
      </div>
    </div>
    <script src="${view.root}/_assets/minisearch.js" defer></script>
    <script src="${view.root}/_assets/static-search.js" defer></script>`,
  );
}

export interface QuickSearchResult {
  topics: { title: string; path: string; count: number; href: string }[];
  articles: { title: string; path: string; type: string | null; href: string }[];
  total: number;
  all: string;
}

export function quickSearchResult(
  view: PortalView,
  query: string,
  result: PortalSearchResult,
  limit: number,
): QuickSearchResult {
  const needle = query.toLocaleLowerCase(view.lang);
  const topics = view.categories
    .filter((folder) => needle !== "" && folder.title.toLocaleLowerCase(view.lang).includes(needle))
    .slice(0, QUICK_TOPICS)
    .map((folder) => ({
      title: folder.title,
      path: shortenPath(
        ancestorsOf(view.categories, folder)
          .slice(0, -1)
          .map((entry) => entry.title),
      ),
      count: folder.articles,
      href: view.links.category(folder.id),
    }));
  const articles = result.results.slice(0, limit).map((hit) => ({
    title: hit.title,
    path: shortenPath(folderTrail(view.categories, hit.folderIds).map((folder) => folder.title)),
    type: hit.type ? view.t.types[hit.type] : null,
    href: view.links.article(hit),
  }));
  return { topics, articles, total: result.total, all: view.links.search(query) };
}
