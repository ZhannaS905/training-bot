# Training Test only. Select this file explicitly for the separate test instance.
FROM node:22-bookworm-slim

# BotHost can mount /app from its checkout. Keep executable code outside it.
WORKDIR /opt/training-test
COPY package.json package-lock.json ./
RUN node -e "if (process.versions.node.split('.')[0] !== '22') process.exit(1)" \
    && npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# Explicit allowlist: no .env, real state, logs, local test runners or wrappers.
COPY bothost-test.cjs ./
COPY src/api.js src/store.js src/webhook.js src/test-bot-identity.js src/bothost-test-api.js src/bothost-test-config.js src/bothost-test-runtime.js src/bothost-test-storage.js src/bothost-test-tls.js ./src/
COPY certs/russian-trusted-root-ca.pem ./certs/
RUN chmod 644 bothost-test.cjs src/*.js certs/russian-trusted-root-ca.pem \
    && node -e "require('./src/bothost-test-tls').validateCertificate()" \
    && mkdir -p /app/data \
    && chown node:node /app/data

ENV NODE_ENV=production \
    BOT_MODE=test \
    CHAT_IDS=-80345864298680 \
    PORT=3000 \
    HOST=0.0.0.0 \
    STATE_DIR=/app/data/training-test/live \
    AUTO_PUBLISH=false \
    TEST_ALLOW_SEND=false \
    TEST_ALLOW_EDIT=false \
    TEST_ALLOW_DELETE=false \
    NODE_TLS_REJECT_UNAUTHORIZED=1 \
    NODE_EXTRA_CA_CERTS=/opt/training-test/certs/russian-trusted-root-ca.pem

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "/opt/training-test/bothost-test.cjs"]
