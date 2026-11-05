# syntax=docker/dockerfile:1

# ===========================
# Base Image
# ===========================
FROM node:20-alpine AS base

WORKDIR /app

RUN apk add --no-cache libc6-compat

# ===========================
# Install Dependencies
# ===========================
FROM base AS deps

COPY package*.json ./

RUN npm ci

# ===========================
# Build Application
# ===========================
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* vars are compiled into the client bundle and the middleware at
# build time, and .dockerignore excludes .env* files, so they come in as build args.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
ARG NEXT_PUBLIC_ROOT_DOMAIN
ARG NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
ENV NEXT_PUBLIC_ROOT_DOMAIN=$NEXT_PUBLIC_ROOT_DOMAIN
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL

RUN npm run build

# ===========================
# Production Runtime
# ===========================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Docker sets HOSTNAME to the container ID, and the standalone server binds to
# it. Force all interfaces so in-container health checks can reach 127.0.0.1.
ENV HOSTNAME=0.0.0.0
ENV LOG_DIR=/app/logs

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

RUN mkdir -p /app/.next/cache /app/logs && \
    chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
