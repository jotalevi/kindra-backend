FROM node:20-bullseye AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src

RUN npm run build

FROM node:20-bullseye AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3012
ENV DATABASE_ROOT=/database

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src/database /database

RUN npm prune --omit=dev

EXPOSE 3012

CMD ["node", "dist/index.js"]

