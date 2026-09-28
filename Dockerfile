# Monorepo-root build context (see docker-compose.yaml / turbo).
# Run: docker build -f misun-academy-server/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache tini
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY misun-academy-server/package.json ./misun-academy-server/package.json
COPY misun-academy-client/package.json ./misun-academy-client/package.json
COPY Esun-Point-Client/package.json ./Esun-Point-Client/package.json
RUN pnpm install --frozen-lockfile

FROM base AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 5000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "ma-server", "run", "dev"]

FROM base AS builder
COPY . .
RUN pnpm --filter ma-server build

# Production deps only (devDeps like jest/tsx stay in builder).
FROM node:22-alpine AS production
RUN apk add --no-cache tini wget && addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY misun-academy-server/package.json ./misun-academy-server/package.json
COPY misun-academy-client/package.json ./misun-academy-client/package.json
COPY Esun-Point-Client/package.json ./Esun-Point-Client/package.json
RUN corepack enable && pnpm install --frozen-lockfile --prod --filter ma-server...
COPY --from=builder /app/misun-academy-server/dist ./misun-academy-server/dist
COPY --from=builder /app/misun-academy-server/openapi.json ./misun-academy-server/openapi.json
ENV NODE_ENV=production
USER app
EXPOSE 5000
# generous start-period: first boot waits out DB retry backoff
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/ready || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "misun-academy-server/dist/server.js"]
