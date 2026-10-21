# ---- build the React client ------------------------------------------------
FROM node:22-alpine AS client
WORKDIR /app
COPY shared ./shared
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci
COPY client ./client
RUN cd client && npm run build

# ---- test image (server + dev deps) -----------------------------------------
FROM node:22-alpine AS test
WORKDIR /app
COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci
COPY server ./server
WORKDIR /app/server
CMD ["npm", "test"]

# ---- runtime image: Express API + built client -------------------------------
FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production
COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY --from=client /app/client/dist ./client/dist
EXPOSE 3000
CMD ["node", "server/src/index.js"]
