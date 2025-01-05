FROM node:18-slim

# Install dependencies for Playwright and Tesseract
RUN apt-get update && apt-get install -y \
    wget \
    python3 \
    build-essential \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install app dependencies
RUN npm install

# Install Playwright browsers and dependencies
RUN npx playwright install chromium
RUN npx playwright install-deps chromium --with-deps

# Copy app source
COPY . .

# Expose port
EXPOSE 3000

# Start the application
CMD [ "npm", "start" ]