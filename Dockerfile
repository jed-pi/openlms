# Woodhouse Park Training — container image for Coolify (or any Docker host).
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source + the SCORM packages (the server unzips + seeds these on first run).
COPY . .

# Coolify injects PORT and proxies HTTPS to it. The app reads process.env.PORT.
EXPOSE 3000
CMD ["node", "server.js"]
