# syntax=docker/dockerfile:1
# One image for every process group: node dist/server.js, dist/worker.js, dist/migrate.js, dist/cli.js.
# Debian 13 (trixie) ships postgresql-client 17, matching the Postgres 17 server (D-26).
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-trixie-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./src/db/migrations
COPY package.json ./
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
