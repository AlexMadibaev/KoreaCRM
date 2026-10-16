FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN corepack enable && corepack pnpm install --frozen-lockfile
RUN corepack pnpm --filter @koreacrm/database db:generate
RUN corepack pnpm --filter @koreacrm/api build

ENV NEXT_PUBLIC_API_URL=/api
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack pnpm --filter @koreacrm/web build
