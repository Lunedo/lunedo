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
import { type Html, html, raw, when } from "./html.js";
import { hasIcon, icon } from "./icons.js";
import { languageName, type PortalMessages } from "./messages.js";

export const VISIBLE_TOP_CATEGORIES = 5;
const TYPE_ICONS = { howTo: "list-ordered", troubleshooting: "triangle-alert" } as const;

export interface PortalAccount {
  name: string;
  email: string;
}

export interface LanguageLink {
  language: string;
  label: string;
  href: string;
  current: boolean;
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
  frameSources: string[];
  origin: string;
  nonce: string;
  assets: { style: string; script: string };
  brandStyle: string;
  logoUrl: string | null;
  account: PortalAccount | null;
  appLink: { label: string; href: string } | null;
  accountLink: string | null;
  signInUrl: string | null;
  signOutUrl: string;
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

export interface TopBar {
  links: PortalCategory[];
  more: PortalCategory[];
  collapsed: boolean;
}

export function topBar(categories: readonly PortalCategory[], threshold: number): TopBar {
  const top = categories.filter((category) => category.parentId === null);
  if (top.length >= threshold) return { links: [], more: top, collapsed: true };
  return {
    links: top.slice(0, VISIBLE_TOP_CATEGORIES),
    more: top.slice(VISIBLE_TOP_CATEGORIES),
    collapsed: false,
  };
}

export function initialOf(title: string): string {
  const trimmed = title.trim();
  return [...trimmed].length <= 3 ? trimmed : ([...trimmed][0] ?? "").toUpperCase();
}

function longDate(view: PortalView, date: Date): string {
  return new Intl.DateTimeFormat(view.t.locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: view.config.timeZone,
  }).format(date);
}

function changedOn(view: PortalView, article: { updatedAt: Date; reviewedAt: Date | null }): string {
  return article.reviewedAt
    ? view.t.reviewedOnLong(longDate(view, article.reviewedAt))
    : view.t.updatedOnLong(longDate(view, article.updatedAt));
}

function shortDate(view: PortalView, date: Date): string {
  return new Intl.DateTimeFormat(view.t.locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: view.config.timeZone,
  }).format(date);
}

function categoryIcon(category: { title: string; icon: string | null }, size: number): Html {
  return hasIcon(category.icon)
    ? html`<span class="cicon s${size}" aria-hidden="true">${icon(category.icon)}</span>`
    : html`<span class="cicon s${size}" aria-hidden="true">${initialOf(category.title)}</span>`;
}

function categoryOf(view: PortalView, id: string | null): PortalCategory | undefined {
  return id ? view.categories.find((category) => category.id === id) : undefined;
}

function kindText(view: PortalView, type: PortalArticleSummary["type"]): Html | null {
  return type
    ? html`<span class="tkind ${type}">${icon(TYPE_ICONS[type])}${view.t.types[type]}</span>`
    : null;
}

function typeBadge(type: PortalArticleSummary["type"]): Html {
  return html`<span class="tybadge ${type ?? ""}" aria-hidden="true">${icon(type ? TYPE_ICONS[type] : "file-text")}</span>`;
}

function brandMark(view: PortalView): Html {
  return view.logoUrl
    ? html`<img src="${view.logoUrl}" alt="">`
    : html`<span class="mark" aria-hidden="true">${initialOf(view.config.name)}</span>`;
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

function header(
  view: PortalView,
  options: { current?: string | null; search?: boolean; navigation?: boolean },
): Html {
  const bar = topBar(view.categories, view.config.topBarThreshold);
  const navigation = options.navigation !== false;
  const current = options.current ?? null;
  const link = (category: PortalCategory) =>
    html`<a href="${view.links.category(category.id)}"${raw(category.id === current ? ' aria-current="page"' : "")}>${category.title}</a>`;
  const dropdown = (label: string, items: PortalCategory[]) =>
    html`<details class="dd" data-menu><summary>${label}${icon("chevron-down")}</summary>
      <div class="menu">${items.map(
        (category) =>
          html`<a href="${view.links.category(category.id)}">${categoryIcon(category, 32)}<span class="trunc" title="${category.title}">${category.title}</span></a>`,
      )}</div></details>`;
  const account = view.account;
  return html`<header class="ph"><div class="pw ph-in">
      <a class="brand" href="${view.links.home}" aria-label="${view.t.home(view.config.name)}">${brandMark(view)}<b class="trunc">${view.config.name}</b></a>
      ${when(
        navigation && view.categories.length > 0,
        () => html`<nav class="nav" aria-label="${view.t.categoriesNavigation}">
          ${bar.links.map(link)}
          ${when(bar.more.length > 0, () => dropdown(bar.collapsed ? view.t.topics : view.t.allTopics, bar.more))}
        </nav>`,
      )}
      <div class="ph-r">
        ${when(
          navigation && options.search !== false,
          () => html`<form class="hsearch" role="search" action="${view.links.searchAction}" method="get" data-search>
            <label class="sr" for="header-search">${view.t.searchLabel}</label>${icon("search")}
            <input id="header-search" name="q" type="search" placeholder="${view.t.searchLabel}" autocomplete="off" maxlength="200">
          </form>`,
        )}
        ${when(
          view.languageLinks.length > 1,
          () =>
            html`<details class="dd lang" data-menu><summary aria-label="${view.t.languageCurrent(view.languageLinks.find((link) => link.current)?.label ?? "")}">${icon("languages")}<span class="wide">${view.languageLinks.find((link) => link.current)?.label ?? ""}</span>${icon("chevron-down")}</summary>
              <div class="menu" role="list" aria-label="${view.t.languageMenu}">${view.languageLinks.map(
                (link) =>
                  html`<a href="${link.href}" hreflang="${link.language}" lang="${link.language}"${raw(link.current ? ' aria-current="true"' : "")}><span class="trunc" title="${link.label}">${link.label}</span>${when(link.current, () => icon("check", "cur"))}</a>`,
              )}</div></details>`,
        )}
        ${when(
          navigation,
          () =>
            html`<button class="btn ghost icon narrow" type="button" aria-expanded="false" aria-controls="pmenu" data-open-label="${view.t.openMenu}" data-close-label="${view.t.closeMenu}" aria-label="${view.t.openMenu}" data-phone-menu>${icon("menu")}</button>`,
        )}
        ${
          account
            ? html`<details class="acct" data-menu><summary aria-label="${view.t.account(account.name)}"><span class="av" aria-hidden="true">${initialOf(account.name).slice(0, 2)}</span><span class="name trunc">${account.name.split(" ")[0]}</span>${icon("chevron-down")}</summary>
              <div class="menu"><div class="mh"><b>${account.name}</b><span>${account.email}</span></div>
                ${when(view.accountLink, () => html`<a href="${view.accountLink ?? ""}">${icon("user-round")}${view.t.accountSettings}</a>`)}
                ${when(view.appLink, () => html`<a href="${view.appLink?.href ?? ""}">${icon("external-link")}${view.appLink?.label ?? ""}</a>`)}
                <form method="post" action="${view.signOutUrl}"><button type="submit">${icon("log-out")}${view.t.signOut}</button></form>
              </div></details>`
            : when(
                navigation && view.signInUrl,
                () =>
                  html`<a class="btn ghost" href="${view.signInUrl ?? ""}" aria-label="${view.t.signIn}">${icon("log-in")}<span class="wide">${view.t.signIn}</span></a>`,
              )
        }
      </div>
    </div></header>
    ${when(
      navigation,
      () => html`<div class="pmenu" id="pmenu" hidden><div class="pw">
      ${searchForm(view, "phone-search", "", { button: false })}
      <nav aria-label="${view.t.categoriesNavigation}">${view.categories
        .filter((category) => category.parentId === null)
        .map(
          (category) =>
            html`<a href="${view.links.category(category.id)}">${categoryIcon(category, 32)}<span class="trunc">${category.title}</span><span class="n">${view.t.articleCount(category.articles)}</span></a>`,
        )}</nav></div></div>`,
    )}`;
}

function footer(view: PortalView): Html {
  const contact = view.config.contactEmail;
  return html`<footer class="pfoot"><div class="pw"><div class="in">
    <span>${view.config.name}</span>
    ${when(contact, () => html`<a href="${mailto(contact ?? "", view.config.name)}">${view.t.footerContact(contact ?? "")}</a>`)}
    ${when(view.config.poweredBy, () => html`<span class="by">${icon("book-open")}${view.t.poweredBy}</span>`)}
  </div></div></footer>`;
}

export function layout(
  view: PortalView,
  options: {
    title: string;
    current?: string | null;
    search?: boolean;
    navigation?: boolean;
    robots?: string;
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
${view.alternates.map((alternate) => html`<link rel="alternate" hreflang="${alternate.hreflang}" href="${alternate.href}">`)}
<link rel="stylesheet" href="${view.assets.style}">
<style nonce="${view.nonce}">${raw(view.brandStyle)}</style>
<script src="${view.assets.script}" defer></script>
</head><body><a class="skip" href="#content">${view.t.skipToContent}</a><div class="page">
${header(view, options)}
<main id="content" tabindex="-1">${when(view.note, () => html`<div class="pw"><p class="langnote" role="note" lang="${view.note?.lang ?? ""}">${icon("languages")}${view.note?.text ?? ""}</p></div>`)}${content}</main>
${footer(view)}
</div><div class="toast" role="status" aria-live="polite" hidden data-toast></div></body></html>`.value
  }`;
}

function rankRow(view: PortalView, article: PortalArticleSummary, index: number): Html {
  const category = categoryOf(view, article.categoryId);
  return html`<li><a href="${view.links.article(article)}"><span class="rank">${index + 1}</span><span class="g"><span class="t">${article.title}</span><span class="m">${kindText(view, article.type)}${when(article.type && category, () => html`<span class="dot"></span>`)}${category?.title ?? ""}</span></span>${icon("chevron-right", "chev")}</a></li>`;
}

function recentRow(view: PortalView, article: PortalArticleSummary): Html {
  return html`<li><a href="${view.links.article(article)}"><span class="g"><span class="t">${article.title}</span><span class="m">${kindText(view, article.type)}${when(article.type, () => html`<span class="dot"></span>`)}${view.t.updatedOnShort(shortDate(view, article.updatedAt))}</span></span>${icon("chevron-right", "chev")}</a></li>`;
}

function topicTiles(view: PortalView, mini: boolean): Html {
  const top = view.categories.filter((category) => category.parentId === null);
  return html`<div class="tiles">${top.map((category) =>
    mini
      ? html`<a class="tile mini" href="${view.links.category(category.id)}">${categoryIcon(category, 40)}<h3>${category.title}</h3><span class="m">${view.t.articleCount(category.articles)}</span></a>`
      : html`<a class="tile" href="${view.links.category(category.id)}">${categoryIcon(category, 56)}<h3>${category.title}</h3>${when(category.description, () => html`<p>${category.description}</p>`)}<span class="foot"><span>${view.t.articleCount(category.articles)}</span><span class="go" aria-hidden="true">${icon("arrow-right")}</span></span></a>`,
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
    { title: config.name, search: false },
    html`<section class="hero"><div class="pw">
      <p class="eyebrow">${icon("life-buoy")}${config.name}</p>
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
          html`<section class="sec" aria-labelledby="topics-heading"><div class="sec-h"><h2 id="topics-heading">${t.topicsHeading}</h2></div>${topicTiles(view, false)}</section>`,
      )}
      <div class="sec cols2">
        ${when(data.mostRead.length > 0, () => html`<section aria-labelledby="top-heading"><h2 class="h3" id="top-heading">${t.mostRead}</h2><ol class="rlist">${data.mostRead.map((article, index) => rankRow(view, article, index))}</ol></section>`)}
        ${when(data.recent.length > 0, () => html`<section aria-labelledby="recent-heading"><h2 class="h3" id="recent-heading">${t.recentlyUpdated}</h2><ul class="rlist">${data.recent.map((article) => recentRow(view, article))}</ul></section>`)}
      </div>`
      }
      <section class="help-cta" aria-labelledby="cta-heading"><span class="cicon s56" aria-hidden="true">${icon("message-circle-question")}</span><h2 class="h2" id="cta-heading">${t.noAnswerHeading}</h2><p>${t.noAnswerText}</p><div class="row"><a class="btn primary" href="${view.links.contact()}">${icon("mail")}${t.writeUs}</a></div></section>
    </div>`,
  );
}

function crumbs(view: PortalView, items: { label: string; href?: string }[]): Html {
  return html`<nav class="crumbs" aria-label="${view.t.breadcrumb}"><a href="${view.links.home}">${view.config.name}</a>${items.map(
    (item) =>
      html`${icon("chevron-right")}${item.href ? html`<a href="${item.href}">${item.label}</a>` : html`<span aria-current="page">${item.label}</span>`}`,
  )}</nav>`;
}

export interface CategoryState {
  type: PortalArticleFilter | null;
  sort: ArticleSort;
  page: number;
}

function categoryQuery(state: CategoryState, changes: Partial<CategoryState>): string {
  const next = { ...state, ...changes };
  const params = new URLSearchParams();
  if (next.type) params.set("type", next.type);
  if (next.sort !== "views") params.set("sort", next.sort);
  if (next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function categoryPage(
  view: PortalView,
  category: PortalCategory,
  list: ArticlePage,
  state: CategoryState,
  pageSize: number,
): string {
  const { t } = view;
  const parent = categoryOf(view, category.parentId);
  const subcategories = view.categories.filter((entry) => entry.parentId === category.id);
  const path = view.links.category(category.id);
  const dynamic = !view.static;
  const filters: [PortalArticleFilter | null, string, number][] = [
    [null, t.filters.all, list.typeCounts.all],
    ["howTo", t.filters.howTo, list.typeCounts.howTo],
    ["troubleshooting", t.filters.troubleshooting, list.typeCounts.troubleshooting],
  ];
  const pages = Math.max(1, Math.ceil(list.total / pageSize));
  return layout(
    view,
    { title: category.title, current: parent?.id ?? category.id },
    html`<div class="pw">
      ${crumbs(view, parent ? [{ label: parent.title, href: view.links.category(parent.id) }, { label: category.title }] : [{ label: category.title }])}
      <header class="chead">${categoryIcon(category, 72)}<div><h1>${category.title}</h1>
        ${when(category.description, () => html`<p class="lead">${category.description}</p>`)}
        ${when(category.contactEmail, () => html`<p class="contactline">${icon("mail")}${t.contactLine(category.title)} <a href="${mailto(category.contactEmail ?? "", category.title)}">${category.contactEmail ?? ""}</a></p>`)}
      </div></header>
      ${when(
        subcategories.length > 0,
        () =>
          html`<section class="sec s14" aria-labelledby="subs-heading"><h2 class="sr" id="subs-heading">${t.subcategories}</h2><div class="subgrid">${subcategories.map(
            (sub) =>
              html`<a class="subtile" href="${view.links.category(sub.id)}">${categoryIcon(sub, 40)}<b>${sub.title}</b>${when(sub.description, () => html`<span class="d">${sub.description}</span>`)}<span class="n">${t.articleCount(sub.articles)}</span></a>`,
          )}</div></section>`,
      )}
      <section class="sec s16" aria-labelledby="list-heading">
        <div class="listbar"><h2 id="list-heading">${t.allArticlesIn(category.title)}</h2>
          ${when(
            dynamic && list.typeCounts.howTo + list.typeCounts.troubleshooting > 0,
            () =>
              html`<nav class="pills" aria-label="${t.articleTypeGroup}">${filters.map(
                ([type, label, count]) =>
                  html`<a class="pill" href="${path}${categoryQuery(state, { type, page: 1 })}"${raw(state.type === type ? ' aria-current="true"' : "")}>${label} <span class="n">${count}</span></a>`,
              )}</nav>`,
          )}
          ${when(
            dynamic,
            () => html`<form method="get" action="${path}" data-autosubmit>
            ${when(state.type, () => html`<input type="hidden" name="type" value="${state.type ?? ""}">`)}
            <span class="sel"><label class="sr" for="sort">${t.sortLabel}</label><select id="sort" name="sort">${(
              ["views", "updated", "title"] as const
            ).map(
              (sort) =>
                html`<option value="${sort}"${raw(state.sort === sort ? " selected" : "")}>${t.sorts[sort]}</option>`,
            )}</select>${icon("chevron-down")}</span>
            <noscript><button class="btn" type="submit">${t.sortLabel}</button></noscript>
          </form>`,
          )}
        </div>
        ${
          list.articles.length === 0
            ? html`<p class="hint">${t.noArticlesOfType}</p>`
            : html`<ul class="alist">${list.articles.map((article) => {
                const sub = categoryOf(view, article.subcategoryId);
                return html`<li><a href="${view.links.article(article)}">${typeBadge(article.type)}<span class="g"><span class="t">${article.title}</span><span class="m">${article.type ? t.types[article.type] : ""}${when(article.type && sub, () => html`<span class="dot"></span>`)}${sub?.title ?? ""}${when(article.type || sub, () => html`<span class="dot"></span>`)}${t.updatedOnShort(shortDate(view, article.updatedAt))}</span></span>${icon("chevron-right", "chev")}</a></li>`;
              })}</ul>`
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
    </div>`,
  );
}

export function decorateArticleHtml(markup: string, base: string, root: string = base): string {
  return markup
    .replaceAll(`${PORTAL_BASE_PLACEHOLDER}/files/`, `${root}/files/`)
    .replaceAll(`${PORTAL_BASE_PLACEHOLDER}/`, `${base}/`)
    .replace(
      /(<section class="ph-section"[^>]*?data-icon="([a-z0-9-]+)"[^>]*><h2 id="[^"]*">)/g,
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
  const category = categoryOf(view, article.categoryId);
  const sub = categoryOf(view, article.subcategoryId);
  const subject = t.mailSubject(article.title);
  const contact = article.contactEmail;
  const shared = articleUrl(view, article);
  const mail = contact ? mailto(contact, subject, shared ? t.mailBody(shared) : undefined) : null;
  const toc = article.headings.filter((heading) => heading.level <= 2);
  const trail = [
    ...(category ? [{ label: category.title, href: view.links.category(category.id) }] : []),
    ...(sub ? [{ label: sub.title, href: view.links.category(sub.id) }] : []),
  ];
  return layout(
    view,
    { title: article.title, current: article.categoryId },
    html`<div class="pw">
      ${crumbs(view, trail)}
      <div class="art">
        <article>
          <header class="ahead">
            <div class="row1">${when(article.type, () => html`<span class="kind ${article.type ?? ""}">${icon(article.type ? TYPE_ICONS[article.type] : "file-text")}${article.type ? t.types[article.type] : ""}</span>`)}
              ${when(data.editUrl, () => html`<span class="editbox"><span class="hint wide">${t.editHint}</span><a class="btn" href="${data.editUrl ?? ""}">${icon("square-pen")}${t.edit}</a></span>`)}</div>
            <h1>${article.title}</h1>
            ${when(article.lead, () => html`<p class="lead">${article.lead}</p>`)}
            <div class="meta"><span>${icon("history")}${changedOn(view, article)}</span></div>
          </header>
          ${when(
            toc.length > 1,
            () =>
              html`<details class="toc-m"><summary>${t.onThisPage}${icon("chevron-down")}</summary><nav aria-label="${t.onThisPage}">${toc.map(
                (heading) => html`<a href="#${heading.id}">${heading.title}</a>`,
              )}</nav></details>`,
          )}
          <div class="body" lang="${article.language}">${raw(decorateArticleHtml(article.html, view.base, view.root))}</div>
          ${when(
            data.related.length > 0,
            () =>
              html`<section class="related" aria-labelledby="related-heading"><h2 class="h3" id="related-heading">${t.relatedTroubleshooting}</h2><ul class="linkrows">${data.related.map(
                (entry) =>
                  html`<li><a href="${view.links.article(entry)}">${typeBadge(entry.type)}<span class="g"><span class="t">${entry.title}</span></span>${icon("chevron-right", "chev")}</a></li>`,
              )}</ul></section>`,
          )}
          ${
            view.static
              ? html`<section class="fb" id="feedback" aria-labelledby="contact-heading"><div class="contact"><h2 class="h3" id="contact-heading">${t.contactHeading}</h2>${contactBlock(view, contact, mail, subject)}</div></section>`
              : html`<section class="fb" id="feedback" aria-labelledby="feedback-heading" data-feedback="${article.itemId}" data-endpoint="${view.root}/feedback">
            <div class="q"><h2 id="feedback-heading">${t.helpfulQuestion}</h2>
              <div class="row" data-step="ask"><button class="btn" type="button" data-rate="yes">${icon("thumbs-up")}${t.yes}</button><button class="btn" type="button" data-rate="no">${icon("thumbs-down")}${t.no}</button></div></div>
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
            data.similar.length > 0,
            () =>
              html`<section class="related" aria-labelledby="similar-heading"><h2 class="h3" id="similar-heading">${t.similarArticles}</h2><div class="relgrid">${data.similar.map(
                (entry) =>
                  html`<a href="${view.links.article(entry)}">${typeBadge(entry.type)}${entry.title}<span class="m">${entry.type ? t.types[entry.type] : ""}${when(entry.type && categoryOf(view, entry.subcategoryId ?? entry.categoryId), () => raw(" · "))}${categoryOf(view, entry.subcategoryId ?? entry.categoryId)?.title ?? ""}</span></a>`,
              )}</div></section>`,
          )}
        </article>
        <aside><nav class="toc" aria-label="${t.onThisPage}">
          ${when(toc.length > 0, () => html`<h2>${t.onThisPage}</h2>${toc.map((heading) => html`<a href="#${heading.id}">${heading.title}</a>`)}`)}
          <div class="tocfoot">${when(!view.static, () => html`<a href="#feedback">${icon("message-circle-question")}${t.giveFeedback}</a>`)}${when(mail, () => html`<a href="${mail ?? ""}">${icon("mail")}${t.writeUs}</a>`)}</div>
        </nav></aside>
      </div>
    </div>`,
  );
}

function areaChoice(view: PortalView, subject: string): Html {
  const { t } = view;
  const options = [
    ...view.categories
      .filter((category) => category.parentId === null && category.contactEmail)
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
  return html`<div class="mailgrid">${options.map(
    (option) =>
      html`<a href="${mailto(option.email, subject)}" title="${option.email}">${categoryIcon({ title: option.label, icon: option.icon }, 40)}<span class="g"><b>${option.label}</b><span class="m">${option.email}</span></span>${icon("arrow-up-right", "chev")}</a>`,
  )}</div>`;
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
    { title: t.resultsFor(result.total, state.query), search: false, robots: "noindex,follow" },
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
                  const category = categoryOf(view, hit.categoryId);
                  const sub = categoryOf(view, hit.subcategoryId);
                  const other = hit.language !== view.lang;
                  return html`<li${raw(other ? ` lang="${hit.language}"` : "")}><span class="path" lang="${view.lang}">${kindText(view, hit.type)}${when(hit.type && category, () => html`<span class="dot"></span>`)}${category?.title ?? ""}${when(sub, () => html` › ${sub?.title ?? ""}`)}${when(other, () => html`<span class="ltag">${icon("languages")}${languageName(hit.language, view.lang)}</span>`)}</span>
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
  const top = view.categories.filter((category) => category.parentId === null);
  return layout(
    view,
    { title: t.noResultsHeading(state.query), search: false, robots: "noindex,follow" },
    html`<div class="pw"><div class="center">
      <div class="shead flush spaced">${searchForm(view, "search", state.query)}</div>
      <span class="cicon s56" aria-hidden="true">${icon("search-x")}</span>
      <h1>${t.noResultsHeading(state.query)}</h1>
      <p class="lead">${t.noResultsLead}</p>
      ${when(result.suggestion, () => html`<p class="suggest">${t.didYouMean} <a href="${view.links.search(result.suggestion ?? "")}">${result.suggestion ?? ""}</a></p>`)}
      <div class="tips"><div><b>${t.tipSpelling}</b>${t.tipSpellingText}</div><div><b>${t.tipGeneral}</b>${t.tipGeneralText}</div>
        <div><b>${t.tipBrowse}</b>${top.map((category, index) => html`${index > 0 ? ", " : ""}<a href="${view.links.category(category.id)}">${category.title}</a>`)}</div></div>
      <section class="panel" aria-labelledby="area-heading"><h2 id="area-heading">${t.areaHeading}</h2><p>${t.areaText}</p>
        ${areaChoice(view, t.searchSubject(state.query))}
        <p class="hint">${t.zeroResultsCounted}</p></section>
      ${when(mostRead.length > 0, () => html`<section class="sec s14" aria-labelledby="top-heading"><h2 class="h3" id="top-heading">${t.mostRead}</h2><ol class="rlist">${mostRead.map((article, index) => rankRow(view, article, index))}</ol></section>`)}
    </div></div>`,
  );
}

export function searchFailedPage(view: PortalView, query: string): string {
  const { t } = view;
  return layout(
    view,
    { title: t.searchFailedHeading, search: false, robots: "noindex,follow" },
    html`<div class="pw"><div class="center">
      <div class="shead flush">${searchForm(view, "search", query)}</div>
      <div class="alert" role="alert">${icon("circle-alert")}<div><b>${t.searchFailedHeading}</b><p>${t.searchFailedText(query)}</p>
        <p class="gap-top"><a class="btn primary" href="${view.links.search(query)}">${icon("refresh-cw")}${t.searchAgain}</a></p></div></div>
      ${when(view.categories.length > 0, () => html`<section class="sec s14" aria-labelledby="topics-heading"><h2 class="h3" id="topics-heading">${t.topicsHeading}</h2>${topicTiles(view, true)}</section>`)}
    </div></div>`,
  );
}

export function emptySearchPage(view: PortalView): string {
  const { t } = view;
  return layout(
    view,
    { title: t.searchLabel, search: false, robots: "noindex,follow" },
    html`<div class="pw"><div class="center"><div class="shead flush">${searchForm(view, "search", "", { error: true })}</div></div></div>`,
  );
}

export function contactPage(view: PortalView, query: string): string {
  const { t } = view;
  return layout(
    view,
    { title: t.writeUs },
    html`<div class="pw"><div class="center">
      <span class="cicon s56" aria-hidden="true">${icon("message-circle-question")}</span>
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
  return layout(
    view,
    { title: t.notFoundHeading, robots: "noindex,nofollow" },
    html`<div class="pw"><div class="center">
      <span class="cicon s56" aria-hidden="true">${icon("file-question")}</span>
      <h1>${t.notFoundHeading}</h1>
      <p class="lead">${t.notFoundLead}</p>
      <div class="gap-top-lg">${searchForm(view, "search")}</div>
      ${when(view.categories.length > 0, () => html`<section class="sec s14" aria-labelledby="topics-heading"><h2 class="h3" id="topics-heading">${t.notFoundBrowse}</h2>${topicTiles(view, true)}</section>`)}
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
  return layout(
    view,
    { title: t.signIn, navigation: false, robots: "noindex,nofollow" },
    html`<div class="signin"><div class="card">
      <span class="logo">${brandMark(view)}</span>
      <h1>${t.signInHeading}</h1>
      <p class="lead">${t.signInReturn(t.signInLead(config.name))}</p>
      ${when(data.failed, () => html`<div class="alert inline" role="alert">${icon("circle-alert")}<div><p>${t.signInFailed}</p></div></div>`)}
      ${
        data.methods.length === 0
          ? html`<p class="hint">${t.signInNoMethod}</p>`
          : html`<div class="methods">${data.methods.map((method, index) =>
              method.action
                ? html`<form method="post" action="${method.action}"><button class="btn lg${index === 0 ? " primary" : ""}" type="submit">${icon("key-round")}${method.label}</button></form>`
                : html`<a class="btn lg${index === 0 ? " primary" : ""}" href="${method.href ?? ""}">${icon("mail")}${method.label}</a>`,
            )}</div>`
      }
      ${when(config.contactEmail, () => html`<p class="fine">${t.signInProblems} <a href="${mailto(config.contactEmail ?? "", t.signIn)}">${config.contactEmail ?? ""}</a></p>`)}
    </div></div>`,
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
    { title: t.searchLabel, search: false, robots: "noindex,follow" },
    html`<div class="pw">
      <div class="shead">${searchForm(view, "search")}</div>
      <div data-static-search data-index="${data.index}" data-base="${data.base}" data-fallback-index="${data.fallbackIndex ?? ""}" data-fallback-base="${data.fallbackBase ?? ""}" data-fallback-language="${data.fallbackLanguage}" data-fallback-label="${languageName(data.fallbackLanguage, view.lang)}" data-results-one="${t.resultsFor(1, "{query}")}" data-results-other="${t.resultsFor(COUNT_MARK, "{query}").replace(String(COUNT_MARK), "{count}")}" data-results-none="${t.noResultsHeading("{query}")}" data-typehow-to="${t.types.howTo}" data-typetroubleshooting="${t.types.troubleshooting}">
        <div class="scount"><h1 data-heading hidden></h1></div>
        <ul class="res" data-results hidden></ul>
        <div class="center" data-empty hidden><span class="cicon s56" aria-hidden="true">${icon("search-x")}</span><p class="lead">${t.noResultsLead}</p>
          <div class="tips"><div><b>${t.tipSpelling}</b>${t.tipSpellingText}</div><div><b>${t.tipGeneral}</b>${t.tipGeneralText}</div>
            <div><b>${t.tipBrowse}</b>${view.categories
              .filter((category) => category.parentId === null)
              .map((category, index) => html`${index > 0 ? ", " : ""}<a href="${view.links.category(category.id)}">${category.title}</a>`)}</div></div>
          <p class="gap-top"><a class="btn" href="${view.links.contact()}">${icon("mail")}${t.contactByArea}</a></p></div>
        <div class="alert" role="alert" data-failed hidden>${icon("circle-alert")}<div><b>${t.searchFailedHeading}</b><p>${t.staticSearchFailed}</p></div></div>
        <noscript><p class="hint">${t.staticSearchNeedsScript}</p></noscript>
      </div>
    </div>
    <script src="${view.root}/_assets/minisearch.js" defer></script>
    <script src="${view.root}/_assets/static-search.js" defer></script>`,
  );
}
