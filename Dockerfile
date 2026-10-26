# Separate Training Test deployment only. Direct mode requires explicit approval.
FROM node:22-bookworm-slim
WORKDIR /opt/training-test
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY direct-sdk/package.json direct-sdk/package-lock.json ./direct-sdk/
RUN npm ci --prefix direct-sdk --omit=dev --ignore-scripts --no-audit --no-fund --engine-strict
COPY memory-training-test.cjs direct-preflight.cjs direct-training-test.cjs ./
COPY fitpp-notification-preview.cjs fitpp-notification-test.cjs ./
COPY training-test-autopost-state.cjs ./
COPY src/ ./src/
COPY direct-core/ ./direct-core/
COPY certs/russian-trusted-root-ca.pem ./certs/
ENV NODE_ENV=production BOT_MODE=test CHAT_IDS=-80345864298680 \
    AUTO_PUBLISH=false TEST_ALLOW_SEND=false TEST_ALLOW_EDIT=false TEST_ALLOW_DELETE=false \
    FITPP_DIRECT_ENABLED=false FITPP_DIRECT_WRITES_ENABLED=false OWNER_DIALOG_ENABLED=false \
    CONTACT_LINK_ENABLED=true CONTACT_LINK_REPLY_ENABLED=true CONTACT_LINK_WRITES_ENABLED=true \
    NODE_EXTRA_CA_CERTS=/opt/training-test/certs/russian-trusted-root-ca.pem
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "/opt/training-test/direct-training-test.cjs"]
