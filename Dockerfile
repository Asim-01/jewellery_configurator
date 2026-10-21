# Multi-stage build: client → test → app.
# `docker compose up --build` builds the `app` target; `docker compose run --rm test` builds `test`.

# ---- 1. build the React client ----------------------------------------------
FROM node:22-alpine AS client
WORKDIR /app
COPY shared ./shared
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci --no-audit --no-fund
COPY client ./client
RUN cd client && npm run build

# ---- 2. test image (server + dev dependencies) -------------------------------
FROM node:22-alpine AS test
WORKDIR /app
COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --no-audit --no-fund
COPY server ./server
WORKDIR /app/server
CMD ["npm", "test"]

# ---- 3. runtime image: Express API serving the built client -------------------
FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production
COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY --from=client /app/client/dist ./client/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
