# Use the official Node.js image
FROM node:16-slim

# Install dependencies required by Playwright
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libxcomposite1 \
    libxrandr2 \
    libxdamage1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpangoft2-1.0-0 \
    libxshmfence1 \
    fonts-noto-color-emoji \
    libgstgl-1.0.so.0 \
    libgstcodecparsers-1.0.so.0 \
    libavif.so.15 \
    libenchant-2.so.2 \
    libsecret-1.so.0 \
    libmanette-0.2.so.0 \
    libGLESv2.so.2 \
    libdrm2 \
    libgbm1 \
    libx11-xcb1 \
    libu2f-udev \
    libpci3 \
    libxtst6 \
    libxss1 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    --no-install-recommends && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy application code
COPY . .

# Install Node.js dependencies
RUN npm install

# Install Playwright browsers
RUN npx playwright install

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
