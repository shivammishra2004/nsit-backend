# Use Microsoft's Playwright image that comes with all dependencies
FROM mcr.microsoft.com/playwright:v1.41.0-focal

# Create app directory
WORKDIR /app

# Install node dependencies
COPY package*.json ./
RUN npm install

# Copy app source
COPY . .

# Install additional Tesseract dependencies
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Expose port
EXPOSE 3000

# Start the application
CMD [ "npm", "start" ]