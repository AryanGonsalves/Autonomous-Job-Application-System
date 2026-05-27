#!/bin/bash
echo "========================================"
echo " Job Apply Bot - Starting Servers"
echo "========================================"
echo

cd "$(dirname "$0")"

if [ ! -f .env ]; then
    echo "ERROR: .env file not found."
    echo "Run ./setup.sh first."
    exit 1
fi

echo "Starting API Server (port 3000)..."
cd artifacts/api-server && pnpm dev &
API_PID=$!
cd "$(dirname "$0")"
sleep 3

echo "Starting Dashboard (port 5173)..."
cd artifacts/job-dashboard && pnpm dev &
DASH_PID=$!
cd "$(dirname "$0")"

echo
echo "========================================"
echo " Both servers are running!"
echo
echo " Dashboard: http://localhost:5173"
echo " API:       http://localhost:3000/api"
echo
echo " Press Ctrl+C to stop both servers."
echo "========================================"

# Wait and clean up on exit
trap "kill $API_PID $DASH_PID 2>/dev/null; echo 'Servers stopped.'" EXIT
wait
