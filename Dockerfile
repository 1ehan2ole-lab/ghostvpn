# GhostVPN - production image
# Сборка: docker build -t ghostvpn .
# Запуск:  docker compose up -d

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      unzip ca-certificates curl iproute2 tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Ядро Xray (скачивается релизом с GitHub)
RUN npm run xray:install && chmod +x vendor/xray/xray

VOLUME ["/app/data"]
EXPOSE 8080 443/tcp 443/udp

CMD ["node", "server/index.js"]
