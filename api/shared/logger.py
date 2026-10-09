"""
Centralized logging for nirs4all webapp backend.

Replaces scattered print() calls with structured, level-based logging
using Python's built-in logging module.

Usage:
    from api.shared.logger import get_logger

    logger = get_logger(__name__)
    logger.info("Server starting on port %d", port)
    logger.warning("Could not acquire lock for %s", resource)
    logger.error("Failed to load dataset: %s", err)
"""

import logging
import sys

_configured = False


def setup_logging(level: str = "INFO") -> None:
    """Configure root logging for the webapp backend.

    Call once at startup (main.py). Subsequent calls are no-ops.
    """
    global _configured
    if _configured:
        return

    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
        force=True,
    )
    _configured = True


def get_logger(name: str) -> logging.Logger:
    """Return a logger scoped to the webapp namespace.

    Args:
        name: Module name (typically ``__name__``).
              The ``api.`` prefix is kept as-is for readability.
    """
    return logging.getLogger(name)
