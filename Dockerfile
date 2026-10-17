FROM node:24.21.0-slim AS build

RUN npm install --global npm@11.16.0

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.21.0-slim

RUN npm install --global npm@11.16.0
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex @anthropic-ai/claude-code

WORKDIR /app
COPY --from=build /app/out/mcp ./out/mcp
COPY --from=build /app/out/ui ./out/ui

WORKDIR /app/out/mcp
RUN npm install --omit=dev

WORKDIR /app
EXPOSE 3700

CMD ["node", "out/mcp/cli.js", "serve"]
