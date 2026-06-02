FROM node:20-slim

WORKDIR /app

# Copy workspace manifests first so dependency install is a separate cacheable layer
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/reader-battery/package.json packages/reader-battery/
COPY packages/reader-solar/package.json packages/reader-solar/
COPY packages/reader-starter/package.json packages/reader-starter/
COPY packages/ui-fb/package.json packages/ui-fb/

# Skip optional native deps (BLE / serial) — mock mode never loads them
RUN npm ci --omit=optional

# Copy source; packages/ui/dist is committed and served by the Express app
COPY . .

# Force all readers to mock — no BLE hardware available in Cloud Run
ENV BATTERY_DRIVER=mock \
    SOLAR_DRIVER=mock \
    STARTER_DRIVER=mock

EXPOSE 8080

CMD ["node", "packages/server/src/index.js"]
