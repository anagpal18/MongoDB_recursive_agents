"""Raindrop setup. Events go to Raindrop cloud (RAINDROP_WRITE_KEY) and, when `raindrop workshop` is running,
are mirrored to the local Workshop daemon (localhost:5899) automatically by the SDK."""
import os
import atexit

import raindrop.analytics as raindrop

_ready = False


def init() -> None:
    global _ready
    if _ready:
        return
    raindrop.init(os.getenv("RAINDROP_WRITE_KEY"), tracing_enabled=True)
    # Debug logs on while setting up: a skipped event (e.g. missing user_id) is otherwise silent.
    # Set RAINDROP_DEBUG=0 once events are confirmed in the dashboard.
    raindrop.set_debug_logs(os.getenv("RAINDROP_DEBUG", "1") == "1")
    atexit.register(raindrop.shutdown)
    _ready = True
