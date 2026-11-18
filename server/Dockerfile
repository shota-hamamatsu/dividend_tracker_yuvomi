# 配当管理サイドカー。リポジトリのルートをビルドコンテキストにする:
#   docker build -f server/Dockerfile -t dividend-tracker-sidecar .
FROM node:22-alpine

WORKDIR /app
# npm 依存は無い。ロジックは画面と共通の src/logic.ts を使う。
COPY package.json ./
COPY src/logic.ts ./src/logic.ts
COPY server/app.ts server/main.ts server/store.ts server/yuvomi.ts ./server/

RUN mkdir -p /data && chown node:node /data
USER node

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    YUVOMI_INTERNAL_URL=http://yuvomi:3000
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://127.0.0.1:8080/api/extensions/dividend-tracker/health || exit 1

CMD ["node", "--experimental-strip-types", "--no-warnings", "server/main.ts"]
