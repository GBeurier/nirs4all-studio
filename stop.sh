#!/bin/bash
# =============================================================================
# nirs4all webapp - Stop All Servers
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}           ${RED}nirs4all webapp - Stop Servers${NC}                    ${CYAN}║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Ports to clean up
PORTS=(5173 5174 5175 5176 5177 8000)

echo -e "${YELLOW}🛑 Stopping all nirs4all processes...${NC}"
echo ""

# Kill Vite/Node processes
echo -e "  ${BLUE}Stopping Vite/Node...${NC}"
pkill -f "vite" 2>/dev/null && echo -e "    ${GREEN}✓ Vite stopped${NC}" || echo -e "    ${YELLOW}○ Vite not running${NC}"
pkill -f "node.*nirs4all_webapp" 2>/dev/null && echo -e "    ${GREEN}✓ Node stopped${NC}" || true
pkill -f "esbuild" 2>/dev/null || true

# Kill Python backend
echo -e "  ${BLUE}Stopping Python backend...${NC}"
pkill -f "uvicorn main:app" 2>/dev/null && echo -e "    ${GREEN}✓ Uvicorn stopped${NC}" || echo -e "    ${YELLOW}○ Uvicorn not running${NC}"
pkill -f "python main.py" 2>/dev/null && echo -e "    ${GREEN}✓ Backend stopped${NC}" || true

# Kill desktop launcher
echo -e "  ${BLUE}Stopping desktop launcher...${NC}"
pkill -f "python launcher.py" 2>/dev/null && echo -e "    ${GREEN}✓ Desktop stopped${NC}" || echo -e "    ${YELLOW}○ Desktop not running${NC}"

# Wait for graceful shutdown
sleep 1

# Force kill any remaining processes on dev ports
echo ""
echo -e "${YELLOW}🔍 Cleaning up ports...${NC}"
for port in "${PORTS[@]}"; do
    if lsof -i :$port -t >/dev/null 2>&1; then
        echo -e "  ${BLUE}Force killing processes on port $port...${NC}"
        fuser -k $port/tcp 2>/dev/null || lsof -i :$port -t | xargs kill -9 2>/dev/null || true
        echo -e "    ${GREEN}✓ Port $port freed${NC}"
    fi
done

# Final verification
sleep 0.5
echo ""
echo -e "${YELLOW}🔍 Verifying...${NC}"

all_clear=true
for port in 5173 8000; do
    if lsof -i :$port -t >/dev/null 2>&1; then
        echo -e "  ${RED}⚠ Port $port still in use${NC}"
        all_clear=false
    else
        echo -e "  ${GREEN}✓ Port $port is free${NC}"
    fi
done

echo ""
if [ "$all_clear" = true ]; then
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ All servers stopped successfully${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
else
    echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
    echo -e "${RED}⚠ Some processes may still be running${NC}"
    echo -e "${YELLOW}Try: sudo fuser -k 5173/tcp 8000/tcp${NC}"
    echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
fi
echo ""
