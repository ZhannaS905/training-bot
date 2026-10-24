# Separate Training Test deployment only.
FROM node:22-bookworm-slim
WORKDIR /opt/training-test
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY memory-training-test.cjs ./
COPY src/api.js src/schedule.js src/memory-test-webhook.js src/test-bot-identity.js src/memory-training-test.js src/test-publication-attempts.js src/fitpp-test-bridge.js src/fitpp-poll-sync.js src/fitpp-optimistic.js src/fitpp-ram.js ./src/
COPY certs/russian-trusted-root-ca.pem ./certs/
ENV NODE_ENV=production BOT_MODE=test CHAT_IDS=-80345864298680 \
    AUTO_PUBLISH=false TEST_ALLOW_SEND=false TEST_ALLOW_EDIT=false TEST_ALLOW_DELETE=false \
    NODE_EXTRA_CA_CERTS=/opt/training-test/certs/russian-trusted-root-ca.pem
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "/opt/training-test/memory-training-test.cjs"]
