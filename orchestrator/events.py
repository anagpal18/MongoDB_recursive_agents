"""Event bus: every event goes to Atlas `events` AND to every WebSocket subscriber.
Shape = the frozen contract in 00_OVERVIEW_shared.md (fields may be added, never renamed)."""
import asyncio
import threading

import data

TYPES = {"attack_started", "attack_blocked", "canary_leaked", "fix_proposed", "fix_accepted",
         "fix_rejected_cheating", "fix_rejected", "attack_evolved", "score_update", "signal_resolved"}

_subscribers: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = set()
_lock = threading.Lock()
persist = True  # demo mode can turn off Atlas writes


def subscribe(loop: asyncio.AbstractEventLoop) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    with _lock:
        _subscribers.add((loop, q))
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    with _lock:
        for sub in [s for s in _subscribers if s[1] is q]:
            _subscribers.discard(sub)


def emit(type: str, *, round: int, harness_version: str, detail: str, attack_id: str | None = None,
         layer: str | None = None, canary_id: str | None = None, score: dict | None = None, **extra) -> dict:
    assert type in TYPES, type
    event = {"type": type, "ts": data.now(), "round": round, "attack_id": attack_id, "layer": layer,
             "canary_id": canary_id, "harness_version": harness_version, "detail": detail}
    if score is not None:
        event["score"] = score
    event.update(extra)
    event = {k: v for k, v in event.items() if v is not None}
    if persist:
        data.log_event(event)
    print(f"[event] r{round} {type:<22} {attack_id or '':<8} {layer or '':<11} {detail}", flush=True)
    publish(event)
    return event


def publish(event: dict) -> None:
    with _lock:
        subs = list(_subscribers)
    for loop, q in subs:
        loop.call_soon_threadsafe(q.put_nowait, event)
