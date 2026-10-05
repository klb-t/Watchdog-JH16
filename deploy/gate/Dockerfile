# WatchDog gate (E3.20): Node built-ins only, no npm install.
FROM node:24-alpine
WORKDIR /gate
COPY server.mjs messages.json ./
USER node
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
