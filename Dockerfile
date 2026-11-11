# House of Stix control room: a small Next.js standalone server.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8200 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# The tool list is read from here at runtime; mount your own over it to change it.
COPY services.yaml ./services.yaml
# Calendar events are saved here (a Docker volume, so they survive rebuilds).
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8200
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8200/ >/dev/null || exit 1
CMD ["node", "server.js"]
