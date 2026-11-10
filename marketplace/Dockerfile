# syntax=docker/dockerfile:1.7
# Keyring Notes 마켓 서버 이미지: 저장소 폴더(/srv/market)의 index.json 을 시작할 때와 주기마다 다시 만들고(pkg index, 멱등)
# /index.json 과 /packages/... 를 정적으로 내준다(pkg serve — server/src/marketServe.ts). 앱 이미지와 따로다.
# 공식 패키지는 이 저장소 marketplace/packages/ 를 싣는다. 개인 마켓은 자기 폴더를 /srv/market/packages 에 마운트해 덮는다.
#
#   docker build -f marketplace/Dockerfile -t keyring-notes-market .     # 저장소 맨 위에서
ARG NODE_IMAGE=node:22-bookworm-slim

# ── 빌드: core·서버만(웹 화면은 필요 없다) ──
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY server/package.json server/
COPY web/package.json web/
COPY app/package.json app/
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca npm_config_cafile=/run/secrets/extra_ca; fi; \
    corepack enable && pnpm install --frozen-lockfile --filter "@keyring-notes/server..."
COPY packages packages
COPY server server
RUN pnpm --filter @keyring-notes/core build && pnpm --filter @keyring-notes/server build

# ── 실행에 필요한 서버 의존성만 ──
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY server/package.json server/
COPY web/package.json web/
COPY app/package.json app/
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca npm_config_cafile=/run/secrets/extra_ca; fi; \
    corepack enable && pnpm install --frozen-lockfile --prod --filter "@keyring-notes/server..."

# ── 실행 ──
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    MARKET_HOST=0.0.0.0 \
    MARKET_PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json ./
COPY packages/core/package.json packages/core/
COPY --from=deps /app/packages/core/node_modules packages/core/node_modules
COPY --from=build /app/packages/core/dist packages/core/dist
COPY server/package.json server/
COPY --from=deps /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
# index.json 은 /srv/market 에 쓴다 — packages/ 는 읽기 전용으로 마운트해도 된다
COPY --chown=node:node marketplace/packages /srv/market/packages
RUN chown node:node /srv/market
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/index.json').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/cli.js", "pkg", "serve", "/srv/market"]
