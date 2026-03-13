#!/bin/bash
# ═══════════════════════════════════════════════════════
# TalkingMaps Deploy Script — talkingmaps.eu
# ═══════════════════════════════════════════════════════
set -e

DEPLOY_DIR="/opt/talkingmaps"
REPO_URL=""  # Set your git repo URL if using git pull

echo "═══════════════════════════════════════════"
echo "  TalkingMaps — Deploy to Production"
echo "═══════════════════════════════════════════"

# Check we're running as root or with sudo
if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo: sudo bash deploy.sh"
    exit 1
fi

# 1. Create deploy directory
echo "[1/6] Setting up directory..."
mkdir -p "$DEPLOY_DIR"

# If this is the first run, copy everything
if [ ! -f "$DEPLOY_DIR/docker-compose.yml" ]; then
    echo "  First deploy — copying files..."
    cp -r . "$DEPLOY_DIR/"
else
    echo "  Updating existing deploy..."
    # Update code but preserve .env and volumes
    rsync -av --exclude='.env' --exclude='.git' --exclude='node_modules' \
          --exclude='__pycache__' --exclude='.env.production' \
          . "$DEPLOY_DIR/"
fi

cd "$DEPLOY_DIR"

# 2. Setup .env
if [ ! -f .env ]; then
    if [ -f .env.production ]; then
        cp .env.production .env
        echo "  .env created from .env.production"
        echo ""
        echo "  ⚠️  IMPORTANT: Edit .env before continuing!"
        echo "     nano $DEPLOY_DIR/.env"
        echo ""
        echo "  Change at minimum:"
        echo "    - ADMIN_PASSWORD"
        echo "    - Verify POSTGRES_PASSWORD and DATABASE_URL match"
        echo ""
        read -p "  Press Enter after editing .env (or Ctrl+C to abort)..."
    else
        echo "  ERROR: No .env or .env.production found!"
        exit 1
    fi
fi

# 3. Remove dev override if present
if [ -f docker-compose.override.yml ]; then
    echo "[2/6] Removing dev override..."
    rm docker-compose.override.yml
fi

# 4. Build and start
echo "[3/6] Building containers..."
docker compose build --no-cache

echo "[4/6] Starting services..."
docker compose up -d

# 5. Wait for health
echo "[5/6] Waiting for services to be ready..."
for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:8080/health > /dev/null 2>&1; then
        echo "  ✓ TalkingMaps is running on port 8080"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "  ✗ Timeout — check logs: docker compose logs"
        exit 1
    fi
    sleep 2
done

# 6. Status
echo "[6/6] Status:"
docker compose ps
echo ""
echo "═══════════════════════════════════════════"
echo "  Deploy complete!"
echo ""
echo "  Local:  http://127.0.0.1:8080"
echo "  Public: https://talkingmaps.eu (via NPM)"
echo ""
echo "  NPM Configuration:"
echo "    Domain: talkingmaps.eu"
echo "    Forward: http://127.0.0.1:8080"
echo "    SSL: Request Let's Encrypt certificate"
echo "    Websockets: OFF"
echo "    Block exploits: ON"
echo ""
echo "  Useful commands:"
echo "    docker compose logs -f          # View logs"
echo "    docker compose restart backend  # Restart backend"
echo "    docker compose down             # Stop all"
echo "    docker compose up -d            # Start all"
echo "═══════════════════════════════════════════"
