# Werewolf — single image that builds the client and runs the Fastify+WS server,
# which serves the built client on one port. Mirrors the homelab Node-service shape.
FROM node:22-bookworm-slim

WORKDIR /app

# Install all workspace deps (server runs via tsx, client builds via vite).
# Every workspace named in the root package.json needs its manifest here or
# `npm ci` refuses the install — including arena, which never runs in
# production but is part of the lockfile.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/arena/package.json packages/arena/
COPY games/werewolf/package.json games/werewolf/
COPY games/foulplay/package.json games/foulplay/
RUN npm ci

# Build the client into packages/client/dist (served by the server).
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
