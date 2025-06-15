# Stage 1: Builder
FROM mcr.microsoft.com/playwright:v1.45.0-jammy AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy source code
COPY tsconfig.json ./
COPY src ./src
COPY config ./config

# Build the application
RUN npm install -g typescript && \
    npm run build

# Stage 2: Production
FROM gcr.io/distroless/nodejs20-debian12:nonroot

# Copy browser binaries from builder
COPY --from=builder --chown=nonroot:nonroot /ms-playwright /ms-playwright

# Set environment variable for Playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Set working directory
WORKDIR /app

# Copy application files from builder
COPY --from=builder --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /app/dist ./dist
COPY --from=builder --chown=nonroot:nonroot /app/config ./config
COPY --from=builder --chown=nonroot:nonroot /app/package*.json ./

# Create data directory for session storage
RUN mkdir -p /app/data && chown -R nonroot:nonroot /app/data

# Set volume for persistent data
VOLUME ["/app/data"]

# Expose ports
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "require('http').get('http://localhost:3000/livez', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"]

# Set user
USER nonroot

# Start the application
CMD ["dist/index.js"] 