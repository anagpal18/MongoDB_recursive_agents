"""Task 1 — prove a fix by watching the Raindrop signal go QUIET, visible in Raindrop/Workshop itself.

The gate proves a fix in our own code. This closes the loop in the observability layer: after the gate accepts a
fix, we replay the EXACT attack that was leaking against the NEW harness, as a genuine instrumented run, and read
the real `canary_leaked` signal state. If it fired before the fix and is silent after, that transition IS the
proof — recorded by Raindrop (and mirrored into Workshop), not just asserted by us.

We NEVER fake the silence. The after-run is a real replay through the real agent; we report whatever the signal
detector actually says. If the signal still fires, we surface it honestly and do NOT emit signal_resolved.
"""
import json
import traceback
import urllib.request
import uuid

import data
import events
import scenarios as S
import telemetry
from target_agent import run_agent

CANARY_VALUES = S.CANARY_VALUES
WORKSHOP = "http://localhost:5899"             # local Workshop daemon + UI
REPLAY_AGENT = "http://localhost:61020/replay"  # the Workshop-registered replay agent (replay_server.py)
RAINDROP_APP = "https://app.raindrop.ai"        # Raindrop cloud dashboard


def _fired(signals, name="canary_leaked") -> bool:
    return any(s.get("name") == name for s in (signals or []))


def _urls(run_id: str) -> dict:
    """Where to see this run. Workshop shows it locally; Raindrop cloud has it under the write key."""
    return {"workshop": f"{WORKSHOP}/runs/{run_id}", "raindrop": f"{RAINDROP_APP}/events?eventId={run_id}"}


def _replay_via_workshop_agent(attack: dict, new_harness: dict, replay_run_id: str):
    """PREFERRED path: drive the registered Workshop replay agent over HTTP with the patched harness — the same
    mechanism Workshop's Replay button uses, with harness_version overridden to the new version. Raises on any
    failure so verify() can fall back."""
    body = json.dumps({"replayRunId": replay_run_id, "sourceRunId": attack.get("_source_run"),
                       "context": {"attack_id": attack["_id"], "harness_version": new_harness["_id"]}}).encode()
    req = urllib.request.Request(REPLAY_AGENT, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        resp = json.load(r)
    if resp.get("status") != "done":
        raise RuntimeError(resp.get("message", "replay agent did not complete"))
    return resp["event_id"], resp.get("leaked") or [], bool(resp.get("canary_fired")), "workshop_replay_agent"


def _replay_in_process(attack: dict, new_harness: dict, replay_run_id: str):
    """FALLBACK path (replay agent unreachable): run the same instrumented agent in-process against the patched
    harness. Still a genuine Raindrop run, and mirrored into Workshop via the local-debugger probe."""
    telemetry.init()
    res = run_agent(S.apply_attack(attack), new_harness, CANARY_VALUES, kind="replay",
                    attack_id=attack["_id"], event_id=replay_run_id)
    return res["event_id"], res["leaked"], _fired(res["signals"]), "in_process_replay"


def verify(attack: dict, before_run: dict, new_harness: dict, round_no: int) -> dict:
    """Replay `attack` against `new_harness`, compare the canary_leaked signal before vs after, and emit
    signal_resolved iff the signal genuinely fell silent. Returns the before/after record."""
    before_fired = _fired(before_run.get("signals"))
    before_id = before_run.get("event_id")
    before_canary = S.canary_id(before_run["leaked"][0]) if before_run.get("leaked") else None

    replay_run_id = str(uuid.uuid4())
    try:
        after_id, after_leaked, after_fired, path = _replay_via_workshop_agent(attack, new_harness, replay_run_id)
    except Exception:
        after_id, after_leaked, after_fired, path = _replay_in_process(attack, new_harness, replay_run_id)

    record = {
        "attack_id": attack["_id"],
        "before_run_id": before_id,
        "after_run_id": after_id,
        "signal": "canary_leaked",
        "before": "fired" if before_fired else "silent",
        "after": "fired" if after_fired else "silent",
        "harness_before": before_run.get("harness_version"),
        "harness_after": new_harness["_id"],
        "resolved": bool(before_fired and not after_fired),
        "replay_path": path,
        "before_url": _urls(before_id),
        "after_url": _urls(after_id),
    }

    # Persist the verification replay as its own run so the proof is in Atlas, not only in Raindrop.
    data.save_run({"_id": "run_" + replay_run_id[:10], "attack_id": attack["_id"], "kind": "fix_verification_replay",
                   "harness_version": new_harness["_id"], "leaked": bool(after_leaked), "verifies_fix": True,
                   "canary_leaked": (S.canary_id(after_leaked[0]) if after_leaked else None),
                   "event_id": after_id, "round": round_no})

    print(f"[fix-verify] {attack['_id']}: canary_leaked {record['before']} -> {record['after']} "
          f"({record['harness_before']} -> {record['harness_after']}, via {path})")
    print(f"[fix-verify]   before run {before_id}  {record['before_url']['workshop']}")
    print(f"[fix-verify]   after  run {after_id}  {record['after_url']['workshop']}")

    if record["resolved"]:
        # The proof: the alarm that fired before is silent after the fix, on a real replay.
        extra = {k: record[k] for k in ("before_run_id", "after_run_id", "signal", "before", "after",
                                        "harness_before", "harness_after", "resolved", "before_url", "after_url")}
        events.emit("signal_resolved", round=round_no, harness_version=new_harness["_id"], attack_id=attack["_id"],
                    canary_id=before_canary,
                    detail=f"canary_leaked fell silent after {new_harness['_id']} — fix proven by Workshop replay",
                    **extra)
    else:
        # Honesty guard: never emit signal_resolved on a fired/unresolved replay.
        print(f"[fix-verify]   NOT emitting signal_resolved — before={record['before']} after={record['after']}. "
              f"The fix did not hold under an independent replay; investigate before claiming it.")
    return record
