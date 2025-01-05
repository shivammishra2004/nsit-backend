FROM node:18-slim

# Switch to root user for installations
USER root

# Install initial dependencies
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

# Install dependencies (this will also run the postinstall script)
RUN npm install

# Copy app source
COPY . .

# Expose port
EXPOSE 3000

# Start the application
CMD [ "npm", "start" ]