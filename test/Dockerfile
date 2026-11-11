# Immutable official Node image digest.
ARG NODE_IMAGE=node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
FROM ${NODE_IMAGE}
RUN apk add --no-cache openssl git
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
# Seed the registry cache needed to install the package into empty consumers.
# All SDK requests in this harness are synthetic loopback fixtures.
RUN npm run test:installed
ENV npm_config_offline=true
CMD ["sh", "-c", "npm test && npm run test:installed"]
