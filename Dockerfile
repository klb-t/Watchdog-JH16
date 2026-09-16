# syntax=docker/dockerfile:1

# Two stages so the shipped image carries no compiler and no build cache.
# better-sqlite3 is a native module, so the builder needs a toolchain; pinning
# the same Node minor in both stages matters, because a native module built
# against one ABI will not load on another.
FROM node:20-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Dependencies first, so editing source does not invalidate the install layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The build is also the last honest checkpoint before an image exists: if the
# type check or the tests fail, no deployable artifact is produced.
RUN npm run lint && npm run test && npm run build

# Strip development dependencies from the tree that gets copied forward.
RUN npm prune --omit=dev


FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Runs unprivileged. The node image already provides this user.
RUN mkdir -p /mnt/watchdog && chown -R node:node /mnt/watchdog

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

# Configuration and fixtures are data the running system reads: presets, method
# specs, reference scores, replication targets and the frozen JH2016 fixtures.
# Without them the server starts and every run fails at config load.
COPY --from=build --chown=node:node /app/config ./config
COPY --from=build --chown=node:node /app/fixtures ./fixtures

USER node

# Cloud Run supplies PORT; this default is for `docker run` locally.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.cjs"]
