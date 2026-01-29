# Napp Trapp - Control Cursor IDE from your mobile phone
# Multi-stage build for optimal image size

# Stage 1: Build the client
FROM node:20-alpine AS client-builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build the server with native dependencies
FROM node:20-alpine AS server-builder

# Install build dependencies for native modules (better-sqlite3, node-pty)
RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --only=production

# Stage 3: Production image
FROM node:20-alpine

# Install runtime dependencies for node-pty
RUN apk add --no-cache python3

WORKDIR /app

# Copy server files
COPY --from=server-builder /app/server/node_modules ./node_modules
COPY server/src ./src
COPY server/bin ./bin
COPY server/.env.example ./.env.example

# Copy built client
COPY --from=client-builder /app/client/dist ./client-dist

# Create data directory
RUN mkdir -p /data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3847
ENV NAPPTRAPP_DATA_DIR=/data
ENV NAPPTRAPP_CLI=true

# Expose the port
EXPOSE 3847

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3847/qr || exit 1

# Run the server
CMD ["node", "src/index.js"]
