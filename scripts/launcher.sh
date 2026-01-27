#!/bin/bash
# =============================================================================
# nirs4all webapp - Unified Launcher (Linux/macOS/WSL)
# =============================================================================
# Commands:
#   start <mode>  - Start servers (web:dev, web:prod, desktop:dev, desktop:prod)
#   stop          - Stop all running servers
#   restart       - Restart servers (stop + start)
#   clean         - Stop servers and clean build artifacts
#   status        - Show server status
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Config
PORT_FRONTEND=5173
PORT_BACKEND=8000
NIRS4ALL_VENV="$PROJECT_ROOT/../.venv"
PID_DIR="/tmp/nirs4all"
LOG_DIR="/tmp/nirs4all"

# Ensure directories exist
mkdir -p "$PID_DIR" "$LOG_DIR"

# =============================================================================
# Helper Functions
# =============================================================================

print_header() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}  nirs4all webapp - $1${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
}

print_usage() {
    echo -e "${YELLOW}Usage:${NC} $0 <command> [options]"
    echo ""
    echo -e "${YELLOW}Commands:${NC}"
    echo -e "  ${GREEN}start${NC} <mode>     Start servers"
    echo -e "  ${GREEN}stop${NC}             Stop all running servers"
    echo -e "  ${GREEN}restart${NC} [mode]   Restart servers (default: web:dev)"
    echo -e "  ${GREEN}clean${NC}            Stop servers and clean build artifacts"
    echo -e "  ${GREEN}status${NC}           Show server status"
    echo ""
    echo -e "${YELLOW}Modes:${NC}"
    echo -e "  ${GREEN}web:dev${NC}          Web development (Vite + FastAPI with hot reload)"
    echo -e "  ${GREEN}web:prod${NC}         Web production (FastAPI serves built frontend)"
    echo -e "  ${GREEN}desktop:dev${NC}      Desktop development (Electron + Vite dev server)"
    echo -e "  ${GREEN}desktop:prod${NC}     Desktop production (Electron + built frontend)"
    echo ""
    echo -e "${YELLOW}Options:${NC}"
    echo -e "  ${GREEN}--no-build${NC}       Skip frontend build (for prod modes)"
    echo -e "  ${GREEN}--help, -h${NC}       Show this help message"
    echo ""
    echo -e "${YELLOW}Examples:${NC}"
    echo -e "  $0 start web:dev"
    echo -e "  $0 stop"
    echo -e "  $0 restart web:dev"
    echo -e "  $0 clean"
    echo ""
}

check_venv() {
    if [ ! -d "$NIRS4ALL_VENV" ]; then
        echo -e "${RED}Error: Virtual environment not found ($NIRS4ALL_VENV)${NC}"
        echo -e "${YELLOW}Create it in nirs4all/ with:${NC}"
        echo "  cd ../nirs4all && python -m venv .venv && source .venv/bin/activate && pip install -e ."
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

save_pid() {
    local name=$1
    local pid=$2
    echo "$pid" > "$PID_DIR/${name}.pid"
}

get_pid() {
    local name=$1
    local pid_file="$PID_DIR/${name}.pid"
    if [ -f "$pid_file" ]; then
        cat "$pid_file"
    fi
}

clear_pid() {
    local name=$1
    rm -f "$PID_DIR/${name}.pid"
}

is_port_in_use() {
    local port=$1
    if command -v lsof &> /dev/null; then
        lsof -i :$port -t >/dev/null 2>&1
    elif command -v ss &> /dev/null; then
        ss -tuln | grep -q ":$port "
    elif command -v netstat &> /dev/null; then
        netstat -tuln | grep -q ":$port "
    else
        return 1
    fi
}

kill_port() {
    local port=$1
    if command -v fuser &> /dev/null; then
        fuser -k $port/tcp 2>/dev/null || true
    elif command -v lsof &> /dev/null; then
        lsof -i :$port -t 2>/dev/null | xargs kill -9 2>/dev/null || true
    fi
}

wait_for_service() {
    local url=$1
    local name=$2
    local max_retries=30
    local retry=0

    echo -e "${BLUE}Waiting for $name...${NC}"
    while [ $retry -lt $max_retries ]; do
        if curl -s "$url" > /dev/null 2>&1; then
            echo -e "${GREEN}  $name ready${NC}"
            return 0
        fi
        retry=$((retry + 1))
        sleep 0.5
    done
    echo -e "${YELLOW}  $name: timeout (may still be starting)${NC}"
    return 1
}

# =============================================================================
# Commands
# =============================================================================

cmd_stop() {
    print_header "Stop Servers"

    echo -e "${YELLOW}Stopping processes...${NC}"

    # Kill by name patterns
    pkill -f "vite" 2>/dev/null && echo -e "  ${GREEN}Vite stopped${NC}" || echo -e "  ${YELLOW}Vite not running${NC}"
    pkill -f "uvicorn main:app" 2>/dev/null && echo -e "  ${GREEN}Uvicorn stopped${NC}" || echo -e "  ${YELLOW}Uvicorn not running${NC}"
    pkill -f "python main.py" 2>/dev/null && echo -e "  ${GREEN}Backend stopped${NC}" || true
    pkill -f "electron" 2>/dev/null && echo -e "  ${GREEN}Electron stopped${NC}" || echo -e "  ${YELLOW}Electron not running${NC}"
    pkill -f "esbuild" 2>/dev/null || true

    sleep 1

    # Kill by ports
    echo ""
    echo -e "${YELLOW}Freeing ports...${NC}"
    for port in $PORT_FRONTEND $PORT_BACKEND; do
        if is_port_in_use $port; then
            kill_port $port
            echo -e "  ${GREEN}Port $port freed${NC}"
        else
            echo -e "  ${YELLOW}Port $port already free${NC}"
        fi
    done

    # Clear PID files
    rm -f "$PID_DIR"/*.pid

    echo ""
    echo -e "${GREEN}All servers stopped${NC}"
}

cmd_status() {
    print_header "Server Status"

    echo -e "${YELLOW}Ports:${NC}"
    if is_port_in_use $PORT_FRONTEND; then
        echo -e "  Frontend ($PORT_FRONTEND): ${GREEN}IN USE${NC}"
    else
        echo -e "  Frontend ($PORT_FRONTEND): ${YELLOW}FREE${NC}"
    fi

    if is_port_in_use $PORT_BACKEND; then
        echo -e "  Backend ($PORT_BACKEND):  ${GREEN}IN USE${NC}"
    else
        echo -e "  Backend ($PORT_BACKEND):  ${YELLOW}FREE${NC}"
    fi

    echo ""
    echo -e "${YELLOW}Processes:${NC}"
    pgrep -f "vite" > /dev/null && echo -e "  Vite:     ${GREEN}RUNNING${NC}" || echo -e "  Vite:     ${YELLOW}STOPPED${NC}"
    pgrep -f "uvicorn main:app" > /dev/null && echo -e "  Uvicorn:  ${GREEN}RUNNING${NC}" || echo -e "  Uvicorn:  ${YELLOW}STOPPED${NC}"
    pgrep -f "electron" > /dev/null && echo -e "  Electron: ${GREEN}RUNNING${NC}" || echo -e "  Electron: ${YELLOW}STOPPED${NC}"

    echo ""
    echo -e "${YELLOW}Logs:${NC}"
    echo "  Backend:  $LOG_DIR/backend.log"
    echo "  Frontend: $LOG_DIR/frontend.log"
    echo "  Desktop:  $LOG_DIR/desktop.log"
}

cmd_clean() {
    print_header "Clean"

    cmd_stop

    echo ""
    echo -e "${YELLOW}Cleaning build artifacts...${NC}"
    rm -rf dist dist-electron backend-dist build release .vite
    rm -f "$LOG_DIR"/*.log
    echo -e "${GREEN}Build artifacts cleaned${NC}"
}

start_web_dev() {
    print_header "Web Development"

    check_venv
    check_node_modules
    cmd_stop

    # Start backend
    echo -e "${BLUE}Starting backend (FastAPI)...${NC}"
    source "$NIRS4ALL_VENV/bin/activate"
    "$NIRS4ALL_VENV/bin/python" -m uvicorn main:app --host 127.0.0.1 --port $PORT_BACKEND --reload --log-level warning > "$LOG_DIR/backend.log" 2>&1 &
    save_pid "backend" $!
    echo -e "${GREEN}  Backend started (PID: $!)${NC}"

    wait_for_service "http://127.0.0.1:$PORT_BACKEND/api/health" "Backend"

    # Start frontend
    echo -e "${BLUE}Starting frontend (Vite)...${NC}"
    npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
    save_pid "frontend" $!
    echo -e "${GREEN}  Frontend started (PID: $!)${NC}"

    wait_for_service "http://127.0.0.1:$PORT_FRONTEND" "Frontend"

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Web Development servers running${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo -e "  Frontend: ${CYAN}http://localhost:$PORT_FRONTEND${NC}"
    echo -e "  Backend:  ${CYAN}http://localhost:$PORT_BACKEND${NC}"
    echo -e "  API Docs: ${CYAN}http://localhost:$PORT_BACKEND/docs${NC}"
    echo ""
    echo -e "  Logs: $LOG_DIR/"
    echo -e "  Stop: ${YELLOW}./scripts/launcher.sh stop${NC}"
    echo ""
}

start_web_prod() {
    local no_build=$1
    print_header "Web Production"

    check_venv
    check_node_modules
    cmd_stop

    # Build frontend if needed
    if [ "$no_build" != "true" ]; then
        echo -e "${BLUE}Building frontend...${NC}"
        npm run build
        echo -e "${GREEN}  Frontend built${NC}"
    fi

    if [ ! -d "dist" ]; then
        echo -e "${RED}Error: dist/ not found. Run without --no-build${NC}"
        exit 1
    fi

    # Start production server
    echo -e "${BLUE}Starting production server...${NC}"
    source "$NIRS4ALL_VENV/bin/activate"
    export NIRS4ALL_PRODUCTION=true
    "$NIRS4ALL_VENV/bin/python" main.py > "$LOG_DIR/backend.log" 2>&1 &
    save_pid "backend" $!
    echo -e "${GREEN}  Server started (PID: $!)${NC}"

    wait_for_service "http://127.0.0.1:$PORT_BACKEND/api/health" "Server"

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Web Production server running${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo -e "  Application: ${CYAN}http://localhost:$PORT_BACKEND${NC}"
    echo -e "  API Docs:    ${CYAN}http://localhost:$PORT_BACKEND/docs${NC}"
    echo ""
    echo -e "  Log: $LOG_DIR/backend.log"
    echo -e "  Stop: ${YELLOW}./scripts/launcher.sh stop${NC}"
    echo ""
}

start_desktop_dev() {
    print_header "Desktop Development (Electron)"

    check_venv
    check_node_modules
    cmd_stop

    echo -e "${BLUE}Launching Electron in development mode...${NC}"
    npm run dev:electron 2>&1 | tee "$LOG_DIR/desktop.log"

    echo -e "${GREEN}Desktop window closed${NC}"
}

start_desktop_prod() {
    local no_build=$1
    print_header "Desktop Production (Electron)"

    check_venv
    check_node_modules
    cmd_stop

    # Build if needed
    if [ "$no_build" != "true" ]; then
        echo -e "${BLUE}Building Electron app...${NC}"
        npm run build:electron
        echo -e "${GREEN}  Electron app built${NC}"
    fi

    if [ ! -d "dist-electron" ]; then
        echo -e "${RED}Error: dist-electron/ not found. Run without --no-build${NC}"
        exit 1
    fi

    echo -e "${BLUE}Launching Electron...${NC}"
    npm run electron:preview 2>&1 | tee "$LOG_DIR/desktop.log"

    echo -e "${GREEN}Desktop window closed${NC}"
}

# =============================================================================
# Interactive Menu
# =============================================================================

interactive_menu() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}  nirs4all webapp - Launcher${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    echo -e "  1) ${GREEN}web:dev${NC}        (Vite + FastAPI)"
    echo -e "  2) ${GREEN}web:prod${NC}       (FastAPI serves build)"
    echo -e "  3) ${GREEN}desktop:dev${NC}    (Electron + Vite)"
    echo -e "  4) ${GREEN}desktop:prod${NC}   (Electron + build)"
    echo -e "  5) ${GREEN}stop${NC}"
    echo -e "  6) ${GREEN}status${NC}"
    echo -e "  0) Exit"
    echo ""
    read -p "Choose [0-6]: " MENU_CHOICE
    case "$MENU_CHOICE" in
        0) exit 0 ;;
        1) start_web_dev ;;
        2) start_web_prod ;;
        3) start_desktop_dev ;;
        4) start_desktop_prod ;;
        5) cmd_stop ;;
        6) cmd_status ;;
        *) interactive_menu ;;
    esac
}

# =============================================================================
# Main
# =============================================================================

COMMAND=""
MODE=""
NO_BUILD=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        start|stop|restart|clean|status)
            COMMAND=$1
            shift
            ;;
        web:dev|web:prod|desktop:dev|desktop:prod)
            MODE=$1
            shift
            ;;
        --no-build)
            NO_BUILD=true
            shift
            ;;
        --help|-h)
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

# Execute command
case $COMMAND in
    start)
        if [ -z "$MODE" ]; then
            echo -e "${RED}Error: No mode specified${NC}"
            echo "Usage: $0 start <mode>"
            echo "Modes: web:dev, web:prod, desktop:dev, desktop:prod"
            exit 1
        fi
        case $MODE in
            web:dev) start_web_dev ;;
            web:prod) start_web_prod $NO_BUILD ;;
            desktop:dev) start_desktop_dev ;;
            desktop:prod) start_desktop_prod $NO_BUILD ;;
        esac
        ;;
    stop)
        cmd_stop
        ;;
    restart)
        MODE=${MODE:-web:dev}
        case $MODE in
            web:dev) start_web_dev ;;
            web:prod) start_web_prod $NO_BUILD ;;
            desktop:dev) start_desktop_dev ;;
            desktop:prod) start_desktop_prod $NO_BUILD ;;
        esac
        ;;
    clean)
        cmd_clean
        ;;
    status)
        cmd_status
        ;;
    "")
        interactive_menu
        ;;
    *)
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        print_usage
        exit 1
        ;;
esac
