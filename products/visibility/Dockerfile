FROM node:22-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium
COPY --chown=node:node . .
USER node
ENV HOST=0.0.0.0 NODE_ENV=production PORT=4100
EXPOSE 4100
CMD ["node", "src/server.js"]
