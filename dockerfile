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
