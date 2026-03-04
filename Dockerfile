FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS dev
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["sh", "docker/entrypoint.dev.sh"]

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run prisma:generate && npm run build && npm prune --omit=dev

FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
COPY --from=build /app/docker ./docker

RUN chown -R app:app /app

USER app
EXPOSE 8009
CMD ["sh", "docker/entrypoint.prod.sh"]
