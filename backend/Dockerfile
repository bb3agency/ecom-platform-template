FROM node:22-alpine AS builder
WORKDIR /app

# Alpine needs build tools for native module compilation (musl libc vs glibc)
RUN apk add --no-cache python3 make g++ libc6-compat

COPY package*.json ./
RUN npm ci

COPY . .
# Prisma generate validates the datasource URL format but does not connect.
# Provide a dummy URL so the schema validation passes during the build.
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV DATABASE_URL=${DATABASE_URL}
RUN npx prisma generate
RUN npm run build

# Prune devDependencies so only production deps are copied to final image
RUN npm prune --omit=dev

FROM node:22-alpine AS production
WORKDIR /app

# Remove npm from production image — not needed at runtime and bundles vulnerable picomatch
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/tsconfig.production.json ./tsconfig.production.json
COPY --from=builder /app/bootstrap-backend.js ./bootstrap-backend.js
COPY --from=builder /app/bootstrap-workers.js ./bootstrap-workers.js
COPY --from=builder /app/scripts/lib ./scripts/lib
# Operational recovery scripts that must be available in the production image
# (invoked via `docker exec <container> node scripts/<name>.js` during incidents).
# Keep this list short — these are NOT for everyday use, only for break-glass.
COPY --from=builder /app/scripts/resume-paused-queues.js ./scripts/resume-paused-queues.js

RUN addgroup -S app && adduser -S app -G app \
  && chown -R app:app /app
USER app

CMD ["node", "bootstrap-backend.js"]

