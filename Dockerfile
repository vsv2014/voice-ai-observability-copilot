# Single-image build: compiles the Vue frontend and serves it from the Express
# backend, so one container hosts both the dashboard and the /api.
# Works on any container host (Koyeb, Railway, Fly, Render).
FROM node:20-slim

WORKDIR /app

# Build the frontend
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm install
COPY client ./client
RUN cd client && npm run build

# Install backend deps
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm install --omit=dev
COPY server ./server

ENV GHL_MODE=mock
ENV LLM_PROVIDER=groq
ENV GROQ_MODEL=llama-3.3-70b-versatile
ENV PORT=8000
EXPOSE 8000

# GROQ_API_KEY is provided at runtime by the host's secret env var.
CMD ["node", "server/src/index.js"]
