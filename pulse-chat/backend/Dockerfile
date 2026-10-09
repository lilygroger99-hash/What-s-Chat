FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# firebase-admin is an optionalDependency (only needed if PUSH_ENABLED=true); it is kept.
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=4 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
# Migrations run inside the process at boot, guarded by a Postgres advisory lock.
CMD ["node", "src/server.js"]
