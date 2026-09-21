# Multi-stage build. The app runs via tsx (matching the dev flow), so the runtime image keeps
# the source + all deps (tsx is a devDependency). worker/api/client are the same image with a
# different command (set by docker-compose).

FROM node:26-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Installs all deps incl. tsx and the @temporalio/core-bridge prebuilt native binary.
RUN npm ci

FROM node:26-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
# Default command; docker-compose overrides it for the api and client services.
CMD ["npm", "run", "worker"]
