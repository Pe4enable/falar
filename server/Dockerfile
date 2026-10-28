# Без npm-зависимостей: только встроенные node:http + node:sqlite (нужен Node >= 22).
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json index.js ./
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/data.db
EXPOSE 8080
CMD ["node", "index.js"]
