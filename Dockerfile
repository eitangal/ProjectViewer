# Build Stage for Frontend & Backend
FROM node:22-bookworm AS builder

WORKDIR /app

# Install git and build essentials
RUN apt-get update && apt-get install -y git build-essential python3 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production Runner
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Install git and curl (required for bare repository operations & healthchecks)
RUN apt-get update && apt-get install -y git ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN git config --system --add safe.directory '*'

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/var/lib/gitportal/data

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/backend ./src/backend

EXPOSE 3000

VOLUME ["/var/lib/gitportal/data"]

CMD ["node", "--import", "tsx", "src/backend/server.ts"]
