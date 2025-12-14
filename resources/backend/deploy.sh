#!/bin/bash

# Flocca Backend Deployment Script
# Usage: ./deploy.sh

APP_DIR="/apps/flocca-backend"

echo "🚀 Starting Flocca Deployment..."

# 1. Ensure Directory Exists
if [ ! -d "$APP_DIR" ]; then
    echo "Creating directory $APP_DIR..."
    sudo mkdir -p $APP_DIR
    sudo chown $USER:$USER $APP_DIR
fi

# 2. Check source (Assuming we are pulling the specific subfolder or rsyncing)
# For simplicity, if this script is inside the repo, we assume git pull happens at root.
# But if deployment is isolated, we might rely on git.

echo "📦 Pulling latest changes..."
git pull origin main

# 3. Docker Deployment
echo "🐳 Building and Updating Containers..."
cd resources/backend

# Use --no-deps to rebuild image but not immediately stop the running one if possible,
# though standard compose up -d will recreate.
# Data is safe because of the named volume 'postgres_data' in docker-compose.yml.

docker compose up -d --build

# 4. Run Migrations
echo "🗄️  Running Database Migrations..."
# Wait for DB to be healthy
sleep 5
docker compose exec backend npx prisma migrate deploy

echo "✅ Deployment Complete! Backend running on port 4000."
