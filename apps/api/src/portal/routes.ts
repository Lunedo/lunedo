import { randomBytes } from "node:crypto";
import {
  type AccountServices,
  ANONYMOUS,
  accountPrincipal,
  articlePage,
  articlePath,
  brandValues,
  type CategoryState,
  categoryPage,
  clientSubject,
  contactPage,
  currentRequestContext,
  emptySearchPage,
  errorPage,
  FEEDBACK_MAX_LENGTH,
  fontFile,
  generateToken,
  hostOf,
  interfaceLanguage,
  type LanguageLink,
  languageName,
  messagesFor,
  notFoundPage,
  PORTAL_ASSETS,
  PORTAL_PAGE_SIZE,
  type PortalArticleFilter,
  type PortalConfig,
  type PortalSignInMethod,
  type PortalView,
  type Principal,
  portalAppLinkNameSetting,
  portalCss,
  portalLinks,
  portalScript,
  RELATED_LIMIT,
  type SearchCursor,
  type SearchState,
  type Session,
  type SettingsService,
  START_LIST_LIMIT,
  searchFailedPage,
  searchPage,
  sessionLifetimeSetting,
  signedOutPage,
  signInPage,
  startPage,
} from "@pagehall/server";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiContext } from "../context.js";
import { sendAttachment } from "../files/serve.js";
import { COOKIES, clearCookie, readCookie, setCookie } from "../http/cookies.js";
import { ownOrigin } from "../http/csrf.js";
import { instanceUrlOf } from "../http/instance-url.js";

const FLOW_MAX_AGE_SECONDS = 10 * 60;
const FEEDBACK_BODY_LIMIT = 16 * 1024;
const FEEDBACK_LIMIT = 30;
const FEEDBACK_WINDOW_SECONDS = 600;
const SEARCH_COUNT_LIMIT = 60;
const SEARCH_COUNT_WINDOW_SECONDS = 600;
const ARTICLE = /^\/(\d{1,9})(?:-([a-z0-9-]{0,200}))?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SORTS = ["views", "updated", "title"] as const;
const FILTERS: readonly PortalArticleFilter[] = ["howTo", "troubleshooting"];

interface Target {
  config: PortalConfig;
  root: string;
  base: string;
  language: string;
  domain: string | null;
  origin: string;
  rest: string;
  instanceUrl: string;
  settings: SettingsService;
}

interface Viewer {
  principal: Principal;
  session: Session | null;
  account: { name: string; email: string; type: string } | null;
}

function pageSecurityHeaders(reply: FastifyReply, nonce: string, frames: readonly string[] = []): void {
  reply.header(
    "content-security-policy",
    [
      "default-src 'none'",
      ...(frames.length > 0 ? [`frame-src ${frames.join(" ")}`] : []),
      "script-src 'self'",
      `style-src 'self' 'nonce-${nonce}'`,
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; "),
  );
  reply.header("x-content-type-options", "nosniff");
  reply.header("referrer-policy", "strict-origin-when-cross-origin");
  reply.header("cache-control", "private, no-cache");
}

function safeReturn(value: unknown, fallback: string): string {
  return typeof value === "string" && /^\/(?!\/)[^\\\s]{0,1999}$/.test(value) ? value : fallback;
}

function queryOf(request: FastifyRequest): URLSearchParams {
  const index = request.url.indexOf("?");
  return new URLSearchParams(index === -1 ? "" : request.url.slice(index + 1));
}

function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string | null): SearchCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<SearchCursor>;
    return typeof parsed.score === "number" &&
      typeof parsed.updatedAt === "string" &&
      typeof parsed.sourceId === "string" &&
      UUID.test(parsed.sourceId) &&
      !Number.isNaN(Date.parse(parsed.updatedAt))
      ? { score: parsed.score, updatedAt: parsed.updatedAt, sourceId: parsed.sourceId }
      : null;
  } catch {
    return null;
  }
}

async function readBody(request: FastifyRequest, limit: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.raw) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > limit) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function queryLanguage(target: Target, value: string | null): string | null {
  return value && value !== target.language && target.config.languages.includes(value as never)
    ? value
    : null;
}

function sameOrigin(request: FastifyRequest, origin: string): boolean {
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  return request.headers.origin === origin;
}

export function registerPortal(fastify: FastifyInstance, context: ApiContext): void {
  fastify.addHook("onRequest", async (request, reply) => {
    const services = context.services;
    if (!services) return;
    const path = request.url.split("?")[0] ?? "/";
    const instanceUrl = (await instanceUrlOf(context)) || ownOrigin(request);
    const host = hostOf(request.hostname);
    if (host && host !== new URL(instanceUrl).hostname && (await services.portals.isPortalDomain(host))) {
      return servePortal(request, reply, services, context, { kind: "domain", host, path, instanceUrl });
    }
    if (path === "/help" || path.startsWith("/help/")) {
      return servePortal(request, reply, services, context, { kind: "path", path, instanceUrl });
    }
    return undefined;
  });
}

type Entry =
  | { kind: "domain"; host: string; path: string; instanceUrl: string }
  | { kind: "path"; path: string; instanceUrl: string };

async function servePortal(
  request: FastifyRequest,
  reply: FastifyReply,
  services: AccountServices,
  context: ApiContext,
  entry: Entry,
): Promise<FastifyReply> {
  const settings = context.settings;
  if (!settings) return bareNotFound(reply);
  const assetPath = entry.kind === "domain" ? entry.path : entry.path.replace(/^\/help/, "");
  if (assetPath.startsWith("/_assets/")) return serveAsset(reply, assetPath.slice("/_assets/".length));
  let target: Target;
  if (entry.kind === "domain") {
    const config = await services.portals.byDomain(entry.host);
    if (!config) return bareNotFound(reply);
    target = {
      config,
      root: "",
      base: "",
      language: config.defaultLanguage,
      domain: entry.host,
      origin: `https://${entry.host}`,
      rest: entry.path,
      instanceUrl: entry.instanceUrl,
      settings,
    };
  } else {
    const [, , segment = "", ...restParts] = entry.path.split("/");
    if (!segment) return bareNotFound(reply);
    const found = await services.portals.byPath(segment);
    if (!found) return bareNotFound(reply);
    const rest = restParts.length > 0 ? `/${restParts.join("/")}` : "/";
    if (found.type === "moved") {
      const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
      return reply
        .code(301)
        .header("cache-control", "no-cache")
        .redirect(`/help/${found.path}${rest}${query}`);
    }
    target = {
      config: found.config,
      root: `/help/${found.config.path}`,
      base: `/help/${found.config.path}`,
      language: found.config.defaultLanguage,
      domain: null,
      origin: new URL(entry.instanceUrl).origin,
      rest,
      instanceUrl: entry.instanceUrl,
      settings,
    };
  }
  const prefix = /^\/([a-z]{2})(\/.*)?$/.exec(target.rest);
  const prefixed = prefix?.[1];
  if (prefixed && target.config.languages.length > 1 && target.config.languages.includes(prefixed as never)) {
    const remainder = (prefix?.[2] ?? "/").replace(/^[/\\]+/, "/");
    if (prefixed === target.config.defaultLanguage) {
      const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
      return reply
        .code(301)
        .header("cache-control", "no-cache")
        .redirect(`${target.root}${remainder}${query}`);
    }
    target.language = prefixed;
    target.base = `${target.root}/${prefixed}`;
    target.rest = remainder;
  }
  const viewer = await resolveViewer(request, services, target);
  try {
    return await route(request, reply, services, context, target, viewer);
  } catch (error) {
    request.log.error({ err: error }, "A portal page failed");
    const view = await buildView(services, target, viewer, { categories: false });
    pageSecurityHeaders(reply, view.nonce, view.frameSources);
    return reply
      .code(500)
      .type("text/html; charset=utf-8")
      .send(errorPage(view, `${target.base}${target.rest}`));
  }
}

function serveAsset(reply: FastifyReply, name: string): FastifyReply {
  reply.header("x-content-type-options", "nosniff");
  if (name === PORTAL_ASSETS.style) {
    return reply
      .header("cache-control", "public, max-age=31536000, immutable")
      .type("text/css; charset=utf-8")
      .send(portalCss);
  }
  if (name === PORTAL_ASSETS.script) {
    return reply
      .header("cache-control", "public, max-age=31536000, immutable")
      .type("text/javascript; charset=utf-8")
      .send(portalScript);
  }
  const font = name.startsWith("fonts/") ? fontFile(name.slice("fonts/".length)) : null;
  if (font)
    return reply.header("cache-control", "public, max-age=31536000, immutable").type("font/woff2").send(font);
  return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
}

function bareNotFound(reply: FastifyReply): FastifyReply {
  reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  reply.header("x-content-type-options", "nosniff");
  return reply
    .code(404)
    .type("text/html; charset=utf-8")
    .send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Not found</title></head><body><h1>This help does not exist</h1><p>The address may be outdated. Check the link or ask the people who sent it.</p></body></html>',
    );
}

async function resolveViewer(
  request: FastifyRequest,
  services: AccountServices,
  target: Target,
): Promise<Viewer> {
  const session = target.domain
    ? await resolveDomainSession(request, services, target.domain)
    : await resolveInstanceSession(request, services);
  if (!session) return { principal: ANONYMOUS, session: null, account: null };
  const account = await services.portalReader.account(session.accountId);
  if (!account) return { principal: ANONYMOUS, session: null, account: null };
  const principal = accountPrincipal(session.accountId);
  const context = currentRequestContext();
  if (context) context.actor = principal;
  return { principal, session, account };
}

async function resolveInstanceSession(
  request: FastifyRequest,
  services: AccountServices,
): Promise<Session | null> {
  const token = readCookie(request, COOKIES.session);
  if (!token) return null;
  const session = await services.sessions.resolve(token);
  return session?.kind === "full" ? session : null;
}

async function resolveDomainSession(
  request: FastifyRequest,
  services: AccountServices,
  domain: string,
): Promise<Session | null> {
  const token = readCookie(request, COOKIES.portal);
  return token ? services.portalSessions.resolve(token, domain) : null;
}

function languageBase(target: Target, language: string): string {
  return language === target.config.defaultLanguage ? target.root : `${target.root}/${language}`;
}

function languageLinks(target: Target, href: (language: string) => string): LanguageLink[] {
  if (target.config.languages.length < 2) return [];
  return [...target.config.languages]
    .sort((a, b) =>
      a === target.config.defaultLanguage ? -1 : b === target.config.defaultLanguage ? 1 : a.localeCompare(b),
    )
    .map((language) => ({
      language,
      label: languageName(language, language),
      href: href(language),
      current: language === target.language,
    }));
}

function alternatesOf(
  target: Target,
  entries: { language: string; path: string }[],
): { hreflang: string; href: string }[] {
  if (target.config.audience !== "public" || target.config.languages.length < 2 || entries.length === 0)
    return [];
  const fallback = entries.find((entry) => entry.language === target.config.defaultLanguage) ?? entries[0];
  return [
    ...entries.map((entry) => ({ hreflang: entry.language, href: `${target.origin}${entry.path}` })),
    ...(fallback ? [{ hreflang: "x-default", href: `${target.origin}${fallback.path}` }] : []),
  ];
}

function pageLanguages(target: Target, rest: string): Pick<PortalView, "languageLinks" | "alternates"> {
  return {
    languageLinks: languageLinks(target, (language) => `${languageBase(target, language)}${rest}`),
    alternates: alternatesOf(
      target,
      target.config.languages.map((language) => ({
        language,
        path: `${languageBase(target, language)}${rest}`,
      })),
    ),
  };
}

async function buildView(
  services: AccountServices,
  target: Target,
  viewer: Viewer,
  options: {
    categories?: boolean;
    language?: string;
    languages?: Pick<PortalView, "languageLinks" | "alternates">;
    note?: PortalView["note"];
  } = {},
): Promise<PortalView> {
  const { config } = target;
  const lang = options.language ?? target.language;
  const t = messagesFor(interfaceLanguage(lang));
  const brand = brandValues(config.brand);
  const categories =
    options.categories === false
      ? []
      : await services.portalReader.categories(viewer.principal, config, target.language);
  let appLink: PortalView["appLink"] = null;
  if (
    viewer.account &&
    viewer.account.type !== "portal" &&
    (await services.portalReader.seesSpaces(viewer.principal))
  ) {
    const label = (await target.settings.get(portalAppLinkNameSetting, {})) || t.appLinkDefault;
    appLink = { label, href: `${target.instanceUrl}/` };
  }
  const logoUrl = config.logoRef
    ? `${target.root}/logo?v=${config.logoRef}`
    : config.organizationLogoRef
      ? `${target.root}/logo?v=o${config.organizationLogoRef}`
      : null;
  const assetBase = target.domain ? "/_assets" : "/help/_assets";
  return {
    config,
    t,
    lang,
    root: target.root,
    base: target.base,
    links: portalLinks(target.base, target.origin),
    static: false,
    ...(options.languages ?? pageLanguages(target, target.rest)),
    note: options.note ?? null,
    frameSources: await services.embeds.frameSources(),
    origin: target.origin,
    nonce: randomBytes(16).toString("base64"),
    assets: { style: `${assetBase}/${PORTAL_ASSETS.style}`, script: `${assetBase}/${PORTAL_ASSETS.script}` },
    brandStyle: `:root{--kb:${brand.light}}@media (prefers-color-scheme:dark){:root{--kb:${brand.dark}}}`,
    logoUrl,
    account: viewer.account ? { name: viewer.account.name, email: viewer.account.email } : null,
    appLink,
    signInUrl: viewer.account
      ? null
      : `${target.root}/sign-in?return=${encodeURIComponent(`${target.base}${target.rest}`)}`,
    signOutUrl: `${target.root}/sign-out`,
    categories,
  };
}

function sendPage(reply: FastifyReply, view: PortalView, markup: string, status = 200): FastifyReply {
  pageSecurityHeaders(reply, view.nonce, view.frameSources);
  return reply.code(status).type("text/html; charset=utf-8").send(markup);
}

async function route(
  request: FastifyRequest,
  reply: FastifyReply,
  services: AccountServices,
  context: ApiContext,
  target: Target,
  viewer: Viewer,
): Promise<FastifyReply> {
  const { rest, config } = target;
  const method = request.method;
  if (method === "POST") {
    if (!sameOrigin(request, target.origin)) {
      return reply.code(403).type("text/plain; charset=utf-8").send("The request came from another site");
    }
    if (rest === "/sign-out") return signOut(reply, services, target, viewer);
    if (rest === "/feedback") return feedback(request, reply, services, target, viewer);
    return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
  }
  if (method !== "GET" && method !== "HEAD") {
    return reply
      .code(405)
      .header("allow", "GET, HEAD, POST")
      .type("text/plain; charset=utf-8")
      .send("Method not allowed");
  }
  const query = queryOf(request);
  if (rest === "/logo") return logo(reply, services, config);
  if (rest.startsWith("/files/"))
    return file(request, reply, services, target, viewer, rest.slice("/files/".length));
  if (target.domain) {
    if (rest === "/sign-in") return startHandoff(reply, target, query);
    if (rest === "/_portal/callback") return finishHandoff(request, reply, services, target, query);
  } else {
    if (rest === "/sign-in") return signInScreen(reply, services, target, viewer, query, false);
    if (rest.startsWith("/sign-in/provider/")) {
      return startProvider(
        request,
        reply,
        services,
        context,
        target,
        viewer,
        rest.slice("/sign-in/provider/".length),
        query,
      );
    }
    if (rest === "/authorize") return authorize(request, reply, services, target, viewer, query);
  }
  if (rest === "/signed-out") {
    const view = await buildView(services, target, viewer, { categories: false });
    return sendPage(reply, view, signedOutPage(view));
  }
  if (!viewer.account && config.audience !== "public") {
    if (target.domain) {
      return reply.code(303).redirect(`/sign-in?return=${encodeURIComponent(request.url)}`);
    }
    return signInScreen(reply, services, target, viewer, new URLSearchParams({ return: request.url }), false);
  }
  if (!(await services.portalReader.admits(viewer.principal, config))) return bareNotFound(reply);
  const view = await buildView(services, target, viewer);
  if (rest === "/" || rest === "") return start(reply, services, target, viewer, view);
  if (rest === "/search") return search(request, reply, services, target, viewer, view, query);
  if (rest === "/contact")
    return sendPage(reply, view, contactPage(view, (query.get("q") ?? "").slice(0, 200)));
  const topic = /^\/topics\/([0-9a-f-]{36})$/i.exec(rest);
  if (topic?.[1]) return category(reply, services, target, viewer, view, topic[1].toLowerCase(), query);
  const article = ARTICLE.exec(rest);
  if (article?.[1])
    return articleRoute(request, reply, services, target, viewer, view, Number(article[1]), article[2] ?? "");
  return sendPage(reply, view, notFoundPage(view), 404);
}

async function start(
  reply: FastifyReply,
  services: AccountServices,
  target: Target,
  viewer: Viewer,
  view: PortalView,
): Promise<FastifyReply> {
  const reader = services.portalReader;
  const [mostRead, recent, frequent] = await Promise.all([
    reader.articles(viewer.principal, target.config, {
      sort: "views",
      limit: START_LIST_LIMIT,
      language: target.language,
    }),
    reader.articles(viewer.principal, target.config, {
      sort: "updated",
      limit: START_LIST_LIMIT,
      language: target.language,
    }),
    reader.frequentSearches(viewer.principal, target.config, target.language),
  ]);
  return sendPage(
    reply,
    view,
    startPage(view, {
      mostRead: mostRead.articles.filter((article) => article.views > 0),
      recent: recent.articles,
      frequent,
    }),
  );
}

async function category(
  reply: FastifyReply,
  services: AccountServices,
  target: Target,
  viewer: Viewer,
  view: PortalView,
  id: string,
  query: URLSearchParams,
): Promise<FastifyReply> {
  const found = view.categories.find((entry) => entry.id === id);
  if (!found) return sendPage(reply, view, notFoundPage(view), 404);
  const type = FILTERS.find((filter) => filter === query.get("type")) ?? null;
  const sort = SORTS.find((entry) => entry === query.get("sort")) ?? "views";
  const page = Math.min(Math.max(Number.parseInt(query.get("page") ?? "1", 10) || 1, 1), 1000);
  const state: CategoryState = { type, sort, page };
  const list = await services.portalReader.articles(viewer.principal, target.config, {
    categoryId: id,
    type,
    sort,
    limit: PORTAL_PAGE_SIZE,
    offset: (page - 1) * PORTAL_PAGE_SIZE,
    language: target.language,
  });
  return sendPage(reply, view, categoryPage(view, found, list, state, PORTAL_PAGE_SIZE));
}

async function search(
  request: FastifyRequest,
  reply: FastifyReply,
  services: AccountServices,
  target: Target,
  viewer: Viewer,
  view: PortalView,
  query: URLSearchParams,
): Promise<FastifyReply> {
  const text = (query.get("q") ?? "").trim().slice(0, 200);
  if (!text) return sendPage(reply, view, emptySearchPage(view));
  const categoryId = query.get("category");
  const state: SearchState = {
    query: text,
    categoryId: categoryId && view.categories.some((entry) => entry.id === categoryId) ? categoryId : null,
    type: FILTERS.find((filter) => filter === query.get("type")) ?? null,
  };
  const cursor = decodeCursor(query.get("after"));
  let result: Awaited<ReturnType<AccountServices["portalReader"]["search"]>>;
  try {
    result = await services.portalReader.search(viewer.principal, target.config, {
      ...state,
      cursor,
      language: target.language,
      searchedLanguage: queryLanguage(target, query.get("in")),
    });
  } catch (error) {
    request.log.error({ err: error }, "A portal search failed");
    return sendPage(reply, view, searchFailedPage(view, text), 503);
  }
  const counted =
    !cursor &&
    (
      await services.rateLimiter.consume(
        `portal-search:client:${clientSubject(request.ip)}`,
        SEARCH_COUNT_LIMIT,
        SEARCH_COUNT_WINDOW_SECONDS,
      )
    ).allowed;
  if (counted) {
    await services.portalStatistics
      .recordSearch(target.config.spaceId, {
        term: text,
        results: result.total,
        categoryId: state.categoryId,
      })
      .catch((error: unknown) => request.log.warn({ err: error }, "A portal search was not counted"));
  }
  const params = new URLSearchParams({ q: text });
  if (state.categoryId) params.set("category", state.categoryId);
  if (state.type) params.set("type", state.type);
  if (result.language !== target.language) params.set("in", result.language);
  if (result.nextCursor) params.set("after", encodeCursor(result.nextCursor));
  const more = result.nextCursor ? `${target.base}/search?${params.toString()}` : null;
  const mostRead =
    result.total === 0
      ? (
          await services.portalReader.articles(viewer.principal, target.config, {
            sort: "views",
            limit: 4,
            language: target.language,
          })
        ).articles
      : [];
  const shownView =
    result.language === target.language
      ? view
      : {
          ...view,
          note: {
            text: view.t.searchFallbackNote(
              languageName(target.language, interfaceLanguage(target.language)),
              languageName(result.language, interfaceLanguage(target.language)),
            ),
            lang: target.language,
          },
        };
  return sendPage(reply, shownView, searchPage(shownView, state, result, more, mostRead));
}

async function articleRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  services: AccountServices,
  target: Target,
  viewer: Viewer,
  view: PortalView,
  number: number,
  slug: string,
): Promise<FastifyReply> {
  const reader = services.portalReader;
  const lookup = await reader.article(viewer.principal, target.config, number, slug, target.language);
  if (!lookup) return sendPage(reply, view, notFoundPage(view), 404);
  if (lookup.type === "redirect") {
    const other = await services.portals.config(lookup.spaceId);
    if (!other) return sendPage(reply, view, notFoundPage(view), 404);
    const address = other.domain
      ? `https://${other.domain}${articlePath("", lookup)}`
      : `${target.instanceUrl}${articlePath(`/help/${other.path}`, lookup)}`;
    return reply.code(301).header("cache-control", "no-cache").redirect(address);
  }
  const { article } = lookup;
  if (slug !== article.slug && !article.fallback) {
    return reply.code(301).header("cache-control", "no-cache").redirect(articlePath(target.base, article));
  }
  if (article.fallback && slug !== "" && !article.alternates.some((entry) => entry.slug === slug)) {
    return reply
      .code(301)
      .header("cache-control", "no-cache")
      .redirect(articlePath(target.base, { number: article.number, slug: "" }));
  }
  const readerLanguage = interfaceLanguage(target.language);
  const articleView = await buildView(services, target, viewer, {
    language: article.language,
    languages: {
      languageLinks: languageLinks(target, (language) => {
        const alternate = article.alternates.find((entry) => entry.language === language);
        return articlePath(languageBase(target, language), alternate ?? { number: article.number, slug: "" });
      }),
      alternates: alternatesOf(
        target,
        article.alternates.map((entry) => ({
          language: entry.language,
          path: articlePath(languageBase(target, entry.language), entry),
        })),
      ),
    },
    note: article.fallback
      ? {
          text: messagesFor(readerLanguage).fallbackNote(
            languageName(target.language, readerLanguage),
            languageName(article.language, readerLanguage),
          ),
          lang: target.language,
        }
      : null,
  });
  await services.portalStatistics
    .recordView(target.config.spaceId, article.itemId)
    .catch((error: unknown) => request.log.warn({ err: error }, "A portal article view was not counted"));
  const scope = article.subcategoryId ?? article.categoryId;
  const related =
    article.type === "howTo" && scope
      ? (
          await reader.articles(viewer.principal, target.config, {
            categoryId: scope,
            type: "troubleshooting",
            limit: RELATED_LIMIT,
            exclude: [article.itemId],
            language: target.language,
          })
        ).articles
      : [];
  const exclude = [article.itemId, ...related.map((entry) => entry.itemId)];
  let similar = scope
    ? (
        await reader.articles(viewer.principal, target.config, {
          categoryId: scope,
          limit: RELATED_LIMIT,
          exclude,
          language: target.language,
        })
      ).articles
    : [];
  if (similar.length === 0 && article.subcategoryId && article.categoryId) {
    similar = (
      await reader.articles(viewer.principal, target.config, {
        categoryId: article.categoryId,
        limit: RELATED_LIMIT,
        exclude,
        language: target.language,
      })
    ).articles;
  }
  const editUrl = article.canEdit
    ? `${target.instanceUrl}/spaces/${encodeURIComponent(article.spaceKey)}/pages/${article.itemId}?edit=true`
    : null;
  return sendPage(reply, articleView, articlePage(articleView, article, { related, similar, editUrl }));
}

async function signInScreen(
  reply: FastifyReply,
  services: AccountServices,
  target: Target,
  viewer: Viewer,
  query: URLSearchParams,
  failed: boolean,
): Promise<FastifyReply> {
  const fallback = `${target.base}/`;
  const returnTo = safeReturn(query.get("return"), fallback);
  if (viewer.account && !failed) return reply.code(303).redirect(returnTo);
  const view = await buildView(services, target, viewer, { categories: false });
  const t = view.t;
  const methods: PortalSignInMethod[] = [];
  if (target.domain) {
    methods.push({ label: t.signIn, action: null, href: `/sign-in?return=${encodeURIComponent(returnTo)}` });
  } else {
    for (const provider of await services.identityProviders.signInProviders()) {
      if (provider.type === "ldap") continue;
      methods.push({
        label: t.signInWith(provider.name),
        action: null,
        href: `${target.base}/sign-in/provider/${provider.id}?return=${encodeURIComponent(returnTo)}`,
      });
    }
    methods.push({
      label: t.signInWithEmail,
      action: null,
      href: `/sign-in?redirect=${encodeURIComponent(returnTo)}`,
    });
  }
  return sendPage(reply, view, signInPage(view, { methods, failed }));
}

async function startProvider(
  request: FastifyRequest,
  reply: FastifyReply,
  services: AccountServices,
  context: ApiContext,
  target: Target,
  viewer: Viewer,
  providerId: string,
  query: URLSearchParams,
): Promise<FastifyReply> {
  const returnTo = safeReturn(query.get("return"), `${target.base}/`);
  if (!UUID.test(providerId)) return signInScreen(reply, services, target, viewer, query, true);
  try {
    const started = await services.providerSignIn.start({
      providerId: providerId.toLowerCase(),
      purpose: "signIn",
      baseUrl: target.instanceUrl,
      returnTo,
      clientIp: request.ip,
    });
    setCookie(reply, COOKIES.providerFlow, started.browserToken, FLOW_MAX_AGE_SECONDS);
    return reply.code(303).header("cache-control", "no-store").redirect(started.url);
  } catch (error) {
    context.logger.warn({ err: error }, "A portal sign-in could not start");
    return signInScreen(reply, services, target, viewer, query, true);
  }
}

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  services: AccountServices,
  target: Target,
  viewer: Viewer,
  query: URLSearchParams,
): Promise<FastifyReply> {
  const domain = query.get("domain");
  const state = query.get("state") ?? "";
  const returnTo = safeReturn(query.get("return"), "/");
  if (!domain || domain !== target.config.domain) {
    const view = await buildView(services, target, viewer);
    return sendPage(reply, view, notFoundPage(view), 404);
  }
  if (!viewer.session) {
    return signInScreen(reply, services, target, viewer, new URLSearchParams({ return: request.url }), false);
  }
  const code = await services.portalSessions.issueHandoff(viewer.session, domain, state);
  if (!code)
    return signInScreen(reply, services, target, viewer, new URLSearchParams({ return: request.url }), true);
  const params = new URLSearchParams({ code, state, return: returnTo });
  return reply
    .code(303)
    .header("cache-control", "no-store")
    .redirect(`https://${domain}/_portal/callback?${params.toString()}`);
}

function startHandoff(reply: FastifyReply, target: Target, query: URLSearchParams): FastifyReply {
  const returnTo = safeReturn(query.get("return"), "/");
  const state = generateToken();
  setCookie(reply, COOKIES.portalFlow, state, FLOW_MAX_AGE_SECONDS);
  const params = new URLSearchParams({ domain: target.domain ?? "", state, return: returnTo });
  return reply
    .code(303)
    .header("cache-control", "no-store")
    .redirect(`${target.instanceUrl}/help/${target.config.path}/authorize?${params.toString()}`);
}

async function finishHandoff(
  request: FastifyRequest,
  reply: FastifyReply,
  services: AccountServices,
  target: Target,
  query: URLSearchParams,
): Promise<FastifyReply> {
  const state = query.get("state") ?? "";
  const code = query.get("code") ?? "";
  const returnTo = safeReturn(query.get("return"), "/");
  const expected = readCookie(request, COOKIES.portalFlow);
  clearCookie(reply, COOKIES.portalFlow);
  const token =
    expected && expected === state && target.domain
      ? await services.portalSessions.redeem(code, state, target.domain)
      : null;
  if (!token) {
    return signInScreen(
      reply,
      services,
      target,
      { principal: ANONYMOUS, session: null, account: null },
      new URLSearchParams({ return: returnTo }),
      true,
    );
  }
  const minutes = await target.settings.get(sessionLifetimeSetting, {});
  setCookie(reply, COOKIES.portal, token, minutes * 60);
  return reply.code(303).header("cache-control", "no-store").redirect(returnTo);
}

async function signOut(
  reply: FastifyReply,
  services: AccountServices,
  target: Target,
  viewer: Viewer,
): Promise<FastifyReply> {
  if (viewer.session) await services.sessions.end(viewer.session.accountId, viewer.session.id, "signedOut");
  clearCookie(reply, target.domain ? COOKIES.portal : COOKIES.session);
  return reply.code(303).header("cache-control", "no-store").redirect(`${target.base}/signed-out`);
}

async function feedback(
  request: FastifyRequest,
  reply: FastifyReply,
  services: AccountServices,
  target: Target,
  viewer: Viewer,
): Promise<FastifyReply> {
  const body = await readBody(request, FEEDBACK_BODY_LIMIT);
  if (body === null) return reply.code(413).send();
  let parsed: { itemId?: unknown; helpful?: unknown; text?: unknown };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return reply.code(400).send();
  }
  const itemId =
    typeof parsed.itemId === "string" && UUID.test(parsed.itemId) ? parsed.itemId.toLowerCase() : null;
  const helpful = typeof parsed.helpful === "boolean" ? parsed.helpful : null;
  const text = typeof parsed.text === "string" ? parsed.text : null;
  if (!itemId || (helpful === null) === (text === null)) return reply.code(400).send();
  if (text !== null && [...text].length > FEEDBACK_MAX_LENGTH) return reply.code(413).send();
  const limit = await services.rateLimiter.consume(
    `portal-feedback:client:${clientSubject(request.ip)}`,
    FEEDBACK_LIMIT,
    FEEDBACK_WINDOW_SECONDS,
  );
  if (!limit.allowed) return reply.code(429).header("retry-after", String(limit.retryAfterSeconds)).send();
  if (!(await services.portalReader.readable(viewer.principal, target.config, itemId)))
    return reply.code(404).send();
  if (helpful !== null) await services.portalStatistics.recordRating(target.config.spaceId, itemId, helpful);
  if (text !== null) await services.portalStatistics.recordFeedback(target.config.spaceId, itemId, text);
  return reply.code(204).header("cache-control", "no-store").send();
}

async function file(
  request: FastifyRequest,
  reply: FastifyReply,
  services: AccountServices,
  target: Target,
  viewer: Viewer,
  attachmentId: string,
): Promise<FastifyReply> {
  const notFound = () => reply.code(404).type("text/plain; charset=utf-8").send("Not found");
  if (!UUID.test(attachmentId)) return notFound();
  const found = await services.attachments.get(ANONYMOUS, attachmentId.toLowerCase(), "published");
  if (!found || !(await services.portalReader.readable(viewer.principal, target.config, found.itemId))) {
    return notFound();
  }
  const content = await services.attachments.content(attachmentId.toLowerCase(), "published");
  if (!content) return notFound();
  const size = queryOf(request).get("size");
  const shown = await services.displayVersions.apply(content, size === "display" ? "display" : undefined);
  if (!shown) return notFound();
  try {
    return reply.send(
      await sendAttachment(request, reply, services.files, shown, { inline: true, crossOrigin: false }),
    );
  } catch {
    return reply.code(416).send();
  }
}

async function logo(
  reply: FastifyReply,
  services: AccountServices,
  config: PortalConfig,
): Promise<FastifyReply> {
  const found =
    (await services.portals.logo(config.spaceId)) ??
    (await services.organizations.logo(config.organizationId));
  if (!found) return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
  reply.header("x-content-type-options", "nosniff");
  reply.header("content-security-policy", "default-src 'none'; sandbox");
  reply.header("cache-control", "public, max-age=31536000, immutable");
  return reply.type(found.contentType).send(found.data);
}
