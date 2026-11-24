FROM ubuntu:24.04

ARG NODE_VERSION=24.21.0
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libcurl4t64 libfreetype6 libpng16-16t64 libsdl2-2.0-0 unzip xz-utils \
    && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
      | grep " node-v${NODE_VERSION}-linux-x64.tar.xz$" | sha256sum -c - \
    && tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz" -C /usr/local --strip-components=1 \
    && rm "node-v${NODE_VERSION}-linux-x64.tar.xz"

WORKDIR /app
RUN npm install --ignore-scripts --no-audit @geastack/html-renderer@0.0.5 playwright@1.65.1 \
    && npx playwright install --with-deps --no-shell chromium \
    && node node_modules/@geastack/html-renderer/lib/install.mjs \
    && useradd --create-home render \
    && rm -rf /var/lib/apt/lists/*

COPY fixtures/card/ fixtures/card/
COPY fixtures/promo/ fixtures/promo/
COPY fixtures/shared/fonts/ fixtures/shared/fonts/
COPY fixtures/shared/images/gea-logo.png fixtures/shared/images/gea-logo.png
COPY deploy/cloudflare/benchmark/src/benchmark-server.mjs deploy/cloudflare/benchmark/src/benchmark-server.mjs

USER render
EXPOSE 8080
CMD ["node", "deploy/cloudflare/benchmark/src/benchmark-server.mjs"]
