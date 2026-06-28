FROM docker.io/oven/bun:1.3.11-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM docker.io/oven/bun:1.3.11-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN bun run build

FROM docker.io/library/node:22-alpine AS runner
WORKDIR /app

ARG SIGNALFORGE_BUILD_SHA=unknown

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV SIGNALFORGE_BUILD_SHA=${SIGNALFORGE_BUILD_SHA}

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=deps --chown=nextjs:nextjs /app/node_modules/ws ./node_modules/ws

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
