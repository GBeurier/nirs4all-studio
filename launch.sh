#!/bin/bash
# =============================================================================
# nirs4all webapp - Unified Launcher
# =============================================================================
# Launch modes:
#   web:dev      - Web development (Vite + FastAPI with hot reload)
#   web:prod     - Web production (built frontend served by FastAPI)
#   desktop:dev  - Desktop development (pywebview + Vite dev server)
#   desktop:prod - Desktop production (pywebview + FastAPI)
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
MODE=""
NO_BUILD=false
PORT_FRONTEND=5173
PORT_BACKEND=8000

# =============================================================================
# Helper Functions
# =============================================================================

print_header() {
    echo ""
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}           ${GREEN}nirs4all webapp - Launcher${NC}                       ${CYAN}║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_usage() {
    echo -e "${YELLOW}Usage:${NC} $0 <mode> [options]"
    echo ""
    echo -e "${YELLOW}Modes:${NC}"
    echo -e "  ${GREEN}web:dev${NC}       Start web development servers (Vite + FastAPI)"
    echo -e "  ${GREEN}web:prod${NC}      Start web production server (FastAPI serves built frontend)"
    echo -e "  ${GREEN}desktop:dev${NC}   Start desktop app with Vite dev server"
    echo -e "  ${GREEN}desktop:prod${NC}  Start desktop app with embedded backend"
    echo ""
    echo -e "${YELLOW}Options:${NC}"
    echo -e "  ${GREEN}--no-build${NC}    Skip frontend build (for web:prod)"
    echo -e "  ${GREEN}--help, -h${NC}    Show this help message"
    echo ""
    echo -e "${YELLOW}Examples:${NC}"
    echo -e "  $0 web:dev          # Start dev servers"
    echo -e "  $0 web:prod         # Build and serve production"
    echo -e "  $0 desktop:dev      # Desktop with hot reload"
    echo -e "  $0 desktop:prod     # Standalone desktop app"
    echo ""
}

check_venv() {
    if [ ! -d ".venv" ]; then
        echo -e "${RED}Error: Virtual environment not found (.venv)${NC}"
        echo -e "${YELLOW}Create it with: python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt${NC}"
        exit 1
    fi
}

check_node_modules() {
    if [ ! -d "node_modules" ]; then
        echo -e "${RED}Error: node_modules not found${NC}"
        echo -e "${YELLOW}Run: npm install${NC}"
        exit 1
    fi
}

stop_servers() {
    echo -e "${YELLOW}Stopping existing servers...${NC}"

    # Kill processes gracefully first, then forcefully
    pkill -f "vite" 2>/dev/null || true
    pkill -f "node.*nirs4all_webapp" 2>/dev/null || true
    pkill -f "uvicorn main:app" 2>/dev/null || true
    pkill -f "python main.py" 2>/dev/null || true
    pkill -f "python launcher.py" 2>/dev/null || true

    # Force kill any processes on common dev ports
    for port in $PORT_FRONTEND $PORT_BACKEND; do
        fuser -k $port/tcp 2>/dev/null || true
    done

    sleep 1
    echo -e "${GREEN}✓ Servers stopped${NC}"
}

wait_for_backend() {
    echo -e "${BLUE}Waiting for backend to be ready...${NC}"
    local max_retries=30
    local retry=0

    while [ $retry -lt $max_retries ]; do
        if curl -s "http://127.0.0.1:$PORT_BACKEND/api/health" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Backend ready${NC}"
            return 0
        fi
        retry=$((retry + 1))
        sleep 0.5
    done

    echo -e "${RED}Warning: Backend not responding after ${max_retries} retries${NC}"
    return 1
}

wait_for_frontend() {
    echo -e "${BLUE}Waiting for frontend to be ready...${NC}"
    local max_retries=30
    local retry=0

    while [ $retry -lt $max_retries ]; do
        if curl -s "http://127.0.0.1:$PORT_FRONTEND" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Frontend ready${NC}"
            return 0
        fi
        retry=$((retry + 1))
        sleep 0.5
    done

    echo -e "${RED}Warning: Frontend not responding after ${max_retries} retries${NC}"
    return 1
}

# =============================================================================
# Launch Modes
# =============================================================================

launch_web_dev() {
    echo -e "${GREEN}🚀 Starting Web Development Mode${NC}"
    echo ""

    check_venv
    check_node_modules
    stop_servers

    # Start backend with multiple workers for better concurrency
    echo -e "${BLUE}Starting backend (FastAPI)...${NC}"
    source .venv/bin/activate
    .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port $PORT_BACKEND --workers 2 --log-level warning > /tmp/nirs4all_backend.log 2>&1 &
    BACKEND_PID=$!
    echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"

    wait_for_backend

    # Start frontend
    echo -e "${BLUE}Starting frontend (Vite)...${NC}"
    npm run dev > /tmp/nirs4all_frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"

    wait_for_frontend

    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ Web Development servers running${NC}"
    echo -e "  ${CYAN}Frontend:${NC} http://localhost:$PORT_FRONTEND"
    echo -e "  ${CYAN}Backend:${NC}  http://localhost:$PORT_BACKEND"
    echo -e "  ${CYAN}API Docs:${NC} http://localhost:$PORT_BACKEND/docs"
    echo ""
    echo -e "  ${YELLOW}Logs:${NC}"
    echo -e "    Backend:  /tmp/nirs4all_backend.log"
    echo -e "    Frontend: /tmp/nirs4all_frontend.log"
    echo ""
    echo -e "  ${YELLOW}Stop with:${NC} ./stop.sh"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
}

launch_web_prod() {
    echo -e "${GREEN}🚀 Starting Web Production Mode${NC}"
    echo ""

    check_venv
    check_node_modules
    stop_servers

    # Build frontend if needed
    if [ "$NO_BUILD" = false ]; then
        echo -e "${BLUE}Building frontend...${NC}"
        npm run build
        echo -e "${GREEN}✓ Frontend built${NC}"
    else
        echo -e "${YELLOW}Skipping frontend build (--no-build)${NC}"
    fi

    # Check if dist exists
    if [ ! -d "dist" ]; then
        echo -e "${RED}Error: dist/ directory not found. Run without --no-build${NC}"
        exit 1
    fi

    # Start backend (serves static files in production)
    echo -e "${BLUE}Starting production server...${NC}"
    source .venv/bin/activate
    export NIRS4ALL_PRODUCTION=true
    python main.py > /tmp/nirs4all_prod.log 2>&1 &
    BACKEND_PID=$!
    echo -e "${GREEN}✓ Production server started (PID: $BACKEND_PID)${NC}"

    wait_for_backend

    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ Web Production server running${NC}"
    echo -e "  ${CYAN}Application:${NC} http://localhost:$PORT_BACKEND"
    echo -e "  ${CYAN}API Docs:${NC}    http://localhost:$PORT_BACKEND/docs"
    echo ""
    echo -e "  ${YELLOW}Log:${NC} /tmp/nirs4all_prod.log"
    echo -e "  ${YELLOW}Stop with:${NC} ./stop.sh"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
}

launch_desktop_dev() {
    echo -e "${GREEN}🖥️  Starting Desktop Development Mode${NC}"
    echo ""

    check_venv
    check_node_modules
    stop_servers

    source .venv/bin/activate

    # Start backend and frontend in parallel for faster startup
    echo -e "${BLUE}Starting backend (FastAPI) and frontend (Vite) in parallel...${NC}"

    # Set desktop mode for optimizations (skip CORS, etc.)
    export NIRS4ALL_DESKTOP=true

    # Start backend with multiple workers
    .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port $PORT_BACKEND --workers 2 --log-level warning > /tmp/nirs4all_backend.log 2>&1 &
    BACKEND_PID=$!

    # Start frontend immediately (don't wait for backend)
    npm run dev > /tmp/nirs4all_frontend.log 2>&1 &
    FRONTEND_PID=$!

    echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"
    echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"

    # Wait for both servers in parallel
    echo -e "${BLUE}Waiting for servers to be ready...${NC}"
    backend_ready=false
    frontend_ready=false

    for i in {1..30}; do
        if ! $backend_ready && curl -s "http://127.0.0.1:$PORT_BACKEND/api/health" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Backend ready${NC}"
            backend_ready=true
        fi
        if ! $frontend_ready && curl -s "http://127.0.0.1:$PORT_FRONTEND" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Frontend ready${NC}"
            frontend_ready=true
        fi
        if $backend_ready && $frontend_ready; then
            break
        fi
        sleep 0.5
    done

    # Launch desktop window
    echo -e "${BLUE}Launching desktop window...${NC}"
    export VITE_DEV=true
    python launcher.py 2>&1 | tee /tmp/nirs4all_desktop.log

    echo ""
    echo -e "${GREEN}Desktop window closed${NC}"
}

launch_desktop_prod() {
    echo -e "${GREEN}🖥️  Starting Desktop Production Mode${NC}"
    echo ""

    check_venv
    check_node_modules
    stop_servers

    # Build frontend if needed
    if [ "$NO_BUILD" = false ] && [ ! -d "dist" ]; then
        echo -e "${BLUE}Building frontend...${NC}"
        npm run build
        echo -e "${GREEN}✓ Frontend built${NC}"
    fi

    # Check if dist exists
    if [ ! -d "dist" ]; then
        echo -e "${RED}Error: dist/ directory not found. Build the frontend first.${NC}"
        exit 1
    fi

    # Launch desktop app (will start its own backend)
    echo -e "${BLUE}Launching desktop application...${NC}"
    source .venv/bin/activate
    export NIRS4ALL_PRODUCTION=true
    python launcher.py 2>&1 | tee /tmp/nirs4all_desktop.log

    echo ""
    echo -e "${GREEN}Desktop window closed${NC}"
}

# =============================================================================
# Main
# =============================================================================

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        web:dev|web:prod|desktop:dev|desktop:prod)
            MODE=$1
            shift
            ;;
        --no-build)
            NO_BUILD=true
            shift
            ;;
        --help|-h)
            print_header
            print_usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            print_usage
            exit 1
            ;;
    esac
done

print_header

if [ -z "$MODE" ]; then
    echo -e "${RED}Error: No mode specified${NC}"
    print_usage
    exit 1
fi

case $MODE in
    web:dev)
        launch_web_dev
        ;;
    web:prod)
        launch_web_prod
        ;;
    desktop:dev)
        launch_desktop_dev
        ;;
    desktop:prod)
        launch_desktop_prod
        ;;
esac
