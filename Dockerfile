FROM ghcr.io/puppeteer/puppeteer:latest

USER root
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Environment instructions (Credentials file handling)
# Render Secrets can be mounted as files or passed as ENV vars.
# If using ENV vars for credentials, the code handles it.
# If using a file, it should be present or mounted.

# Start the bot
CMD ["node", "index.js"]
