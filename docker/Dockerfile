# syntax=docker/dockerfile:1

FROM node:24.22.1-bookworm-slim AS base
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
    && rm -rf /var/lib/apt/lists/* \
    && install -d -m 700 /var/lib/lunedo /var/lib/lunedo/files /var/lib/lunedo/secrets

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN --mount=type=cache,id=drawio,target=/repo/.cache/drawio \
    pnpm turbo run build --filter=@lunedo/api --filter=@lunedo/collab --filter=@lunedo/worker --filter=@lunedo/web
# The API, collaboration server and worker are bundled into /out/app/server. Only packages that load
# native code or read their own files at runtime are deployed next to them, without files that only serve
# building, type checking or documentation. Licence files stay.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter=@lunedo/runtime deploy --prod /out/app \
    && rm -f /out/app/pnpm-lock.yaml /out/app/pnpm-workspace.yaml \
    && find /out/app/node_modules/.pnpm -type f \( \
      -name "*.map" -o -name "*.d.ts" -o -name "*.d.mts" -o -name "*.d.cts" -o -name "*.tsbuildinfo" \
      -o \( -iname "*.md" ! -iname "licen*" ! -iname "notice*" ! -iname "copying*" \) \) -delete \
    && find /out/app/node_modules/.pnpm -mindepth 3 -type d \( -name test -o -name tests -o -name __tests__ \
      -o -name coverage -o -name example -o -name examples -o -name .github \) -prune \
      -exec rm -rf {} + \
    && cd /out/app/node_modules/.pnpm \
    && rm -rf pdfjs-dist@*/node_modules/pdfjs-dist/build pdfjs-dist@*/node_modules/pdfjs-dist/web \
      pdfjs-dist@*/node_modules/pdfjs-dist/image_decoders pdfjs-dist@*/node_modules/pdfjs-dist/types \
      pdfjs-dist@*/node_modules/pdfjs-dist/legacy/web pdfjs-dist@*/node_modules/pdfjs-dist/legacy/image_decoders \
      pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/*.min.mjs \
    && cd /repo \
    && node scripts/bundle-server.ts /out/app

# PostgreSQL clients for backups. pg_dump must be at least as new as the server,
# so every supported major version is shipped and the matching one is chosen at runtime.
# Only the tools are copied: the client packages would bring Perl into the image.
FROM debian:bookworm-20261020-slim AS postgres-clients
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && install -d /usr/share/postgresql-common/pgdg /out/pgdg \
    && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 postgresql-client-17 postgresql-client-18 \
    && for version in 16 17 18; do \
      install -d "/out/postgresql/$version/bin" \
      && cp "/usr/lib/postgresql/$version/bin/pg_dump" "/usr/lib/postgresql/$version/bin/pg_restore" \
        "/usr/lib/postgresql/$version/bin/psql" "/out/postgresql/$version/bin/" || exit 1; \
    done \
    && cp /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc /etc/apt/sources.list.d/pgdg.list /out/pgdg/

FROM node:24.22.1-bookworm-slim AS node
RUN apt-get update \
    && apt-get install -y --no-install-recommends binutils \
    && strip --strip-unneeded /usr/local/bin/node

FROM debian:bookworm-20261020-slim AS runtime
ARG VERSION=dev
LABEL org.opencontainers.image.title="Lunedo" \
      org.opencontainers.image.description="Self-hosted wiki, knowledge base and project planning tool" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}"
COPY --from=postgres-clients /out/pgdg/apt.postgresql.org.asc /usr/share/postgresql-common/pgdg/
COPY --from=postgres-clients /out/pgdg/pgdg.list /etc/apt/sources.list.d/
RUN mv /etc/apt/sources.list.d/pgdg.list /tmp/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && mv /tmp/pgdg.list /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends libpq5 libreadline8 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 node \
    && useradd --uid 1000 --gid node --shell /bin/bash --create-home node
COPY --from=postgres-clients /out/postgresql /usr/lib/postgresql
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN for tool in /usr/lib/postgresql/*/bin/*; do LD_BIND_NOW=1 "$tool" --version >/dev/null || exit 1; done
ENV NODE_ENV=production \
    LUNEDO_VERSION=${VERSION} \
    LUNEDO_WEB_ROOT=/app/web     LUNEDO_CHANGELOG_FILE=/app/CHANGELOG.md
RUN install -d -o node -g node -m 700 /var/lib/lunedo /var/lib/lunedo/files /var/lib/lunedo/secrets \
    /var/lib/lunedo/backups /var/lib/lunedo/work
RUN install -d -o root -g root -m 755 /data/import
WORKDIR /app
COPY --from=build --chown=root:root /out/app ./
COPY --from=build --chown=root:root /repo/apps/web/dist ./web
COPY --chown=root:root CHANGELOG.md ./CHANGELOG.md
COPY --chown=root:root --chmod=644 scripts/install.sh ./install.sh
COPY --chmod=755 docker/start.sh /usr/local/bin/lunedo
# sharp loads its prebuilt libvips for the architecture of this image; fail the build if it cannot.
RUN cd /app/server && node --input-type=module -e "await import('sharp')"
USER node
VOLUME /var/lib/lunedo
EXPOSE 3000 3001 3002
ENTRYPOINT ["lunedo"]
CMD ["all"]
