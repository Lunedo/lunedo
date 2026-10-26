# syntax=docker/dockerfile:1

# Optional render container: headless Chromium that turns Lunedo's print-ready HTML into PDF.
FROM node:24.22.1-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_store_dir=/pnpm/store
WORKDIR /repo
COPY package.json ./
RUN corepack enable && corepack install

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@lunedo/render --filter=@lunedo/web
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter=@lunedo/render deploy --prod /out/render
RUN node scripts/page-files.ts apps/web/dist print.html /out/viewer

FROM node:24.22.1-bookworm-slim AS runtime
ARG VERSION=dev
LABEL org.opencontainers.image.title="Lunedo render" \
      org.opencontainers.image.description="Optional PDF renderer for Lunedo" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}"
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    LUNEDO_VERSION=${VERSION} \
    RENDER_BROWSER=/usr/bin/chromium \
    RENDER_VIEWER_DIR=/app/viewer
WORKDIR /app
COPY --from=build --chown=root:root /out/render ./render
COPY --from=build --chown=root:root /out/viewer ./viewer
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "/app/render/dist/main.js"]
