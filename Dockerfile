FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependências primeiro (melhor uso de cache)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY database ./database
COPY scripts ./scripts

# Fotos enviadas ficam em /app/uploads (volume no docker-compose)
ENV UPLOAD_DIR=/app/uploads
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/saude || exit 1

CMD ["node", "server/index.js"]
