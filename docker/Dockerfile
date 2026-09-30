# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_store_dir=/pnpm/store
WORKDIR /repo
COPY package.json ./
RUN corepack enable && corepack install

# Development image for docker/compose.dev.yml. The repository is mounted at /repo.
FROM base AS dev
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@pagehall/api --filter=@pagehall/collab --filter=@pagehall/worker --filter=@pagehall/web
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    for app in api collab worker; do \
      pnpm --filter="@pagehall/$app" deploy --prod "/out/$app" || exit 1; \
    done

FROM node:24-bookworm-slim AS runtime
ARG VERSION=dev
LABEL org.opencontainers.image.title="Pagehall" \
      org.opencontainers.image.description="Self-hosted wiki, knowledge base and project planning tool" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production \
    PAGEHALL_WEB_ROOT=/app/web
WORKDIR /app
COPY --from=build --chown=root:root /out/api ./api
COPY --from=build --chown=root:root /out/collab ./collab
COPY --from=build --chown=root:root /out/worker ./worker
COPY --from=build --chown=root:root /repo/apps/web/dist ./web
COPY --chmod=755 docker/start.sh /usr/local/bin/pagehall
USER node
EXPOSE 3000 3001 3002
ENTRYPOINT ["pagehall"]
CMD ["all"]
