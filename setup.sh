#!/bin/bash
echo "========================================"
echo " Job Apply Bot - First Time Setup"
echo "========================================"
echo

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    echo "Please download and install it from https://nodejs.org/"
    exit 1
fi
echo "[OK] Node.js found: $(node --version)"

# Check / install pnpm
if ! command -v pnpm &> /dev/null; then
    echo "Installing pnpm..."
    npm install -g pnpm
fi
echo "[OK] pnpm found: $(pnpm --version)"

echo
echo "Installing dependencies (this may take a minute)..."
cd "$(dirname "$0")"
pnpm install || { echo "ERROR: Dependency installation failed."; exit 1; }
echo "[OK] Dependencies installed"

echo
echo "Creating .env file..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "[OK] Created .env from template"
else
    echo "[OK] .env already exists, skipping"
fi

echo
echo "========================================"
echo " Setup complete!"
echo
echo " Next steps:"
echo "   1. Run ./start.sh to launch"
echo "   2. Open http://localhost:5173"
echo "   3. Go to Settings and enter your credentials"
echo "========================================"
