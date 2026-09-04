FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Runtime data, not build output: the prompt loader reads these at boot and
# falls back to the .example copies when no customisation is mounted.
COPY prompts ./prompts
COPY knowledge ./knowledge
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
