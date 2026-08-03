# --- Stage 1: Install dependencies ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# --- Stage 2: Build Next.js + bundle server ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build:all

# --- Stage 3: Production runtime ---
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

# Copy dependencies (production only)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.ts ./

EXPOSE 3000

CMD ["node", "dist-server/combined.cjs"]
