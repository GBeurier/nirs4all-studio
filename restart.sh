#!/bin/bash
# Script to clean and restart frontend + backend servers

echo "🛑 Stopping all servers..."

# Kill Vite/Node processes
pkill -9 -f "vite" 2>/dev/null
pkill -9 -f "node.*nirs4all_webapp" 2>/dev/null
pkill -9 -f "esbuild" 2>/dev/null

# Kill Python backend
pkill -9 -f "uvicorn main:app" 2>/dev/null
pkill -9 -f "python main.py" 2>/dev/null

# Force kill any processes on common dev ports
for port in 5173 5174 5175 5176 5177 8000; do
    fuser -k $port/tcp 2>/dev/null
done

# Wait for processes to terminate
sleep 1

# Verify ports are free
echo "🔍 Checking ports..."
for port in 5173 8000; do
    if lsof -i :$port -t >/dev/null 2>&1; then
        echo "⚠️  Port $port still in use, force killing..."
        lsof -i :$port -t | xargs kill -9 2>/dev/null
    fi
done

sleep 1
echo "✅ Servers stopped"

# Start backend
echo "🚀 Starting backend..."
cd /home/delete/nirs_ui_workspace/nirs4all_webapp
source .venv/bin/activate
python main.py &
sleep 2

# Start frontend
echo "🚀 Starting frontend..."
npm run dev &

echo "✅ All servers restarted!"
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://localhost:8000"
