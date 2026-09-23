FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
