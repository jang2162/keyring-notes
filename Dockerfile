# syntax=docker/dockerfile:1.7
# Keyring Notes 이미지. 데이터(볼트·설정·백업)는 모두 /data 볼륨에 둔다.
#
#   docker build -t keyring-notes .
#
# 사내 프록시처럼 TLS를 다시 서명하는 환경에서 빌드할 때는 그 CA를 비밀로 넘긴다(이미지에는 남지 않는다):
#   docker build --secret id=extra_ca,src=/path/to/ca.pem -t keyring-notes .
ARG NODE_IMAGE=node:22-bookworm-slim
ARG RUNTIME_IMAGE=${NODE_IMAGE}

# ── 빌드: 웹(Vite)과 서버(TypeScript) ──
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca npm_config_cafile=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund
COPY server server
COPY web web
RUN npm run build

# ── 실행에 필요한 서버 의존성만 ──
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca npm_config_cafile=/run/secrets/extra_ca; fi; \
    npm ci --omit=dev --workspace server --no-audit --no-fund

# ── 실행 ──
FROM ${RUNTIME_IMAGE}
# 변경 이력은 git CLI로 남긴다(기반 이미지에 없을 때만 설치)
RUN command -v git >/dev/null 2>&1 || \
    (apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*)
ENV NODE_ENV=production \
    KEYRING_DATA=/data \
    KEYRING_HOST=0.0.0.0 \
    KEYRING_PORT=8787 \
    KEYRING_WEB_DIST=/app/web/dist
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json ./
COPY server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY --chmod=755 docker/keyring /usr/local/bin/keyring
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/dist/index.js"]
