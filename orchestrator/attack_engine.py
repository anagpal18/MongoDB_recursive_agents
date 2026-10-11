"""Attack engine (doc 03 Part 2): replay a stored attack against the current harness, watch the Raindrop
signals, persist the run, and turn the result into a permanent test in the attack library.

The attacks themselves are a fixed library (scenarios.SEED_ATTACKS) of publicly-documented injection
techniques. Generating NEW attack variants (doc 03 Part 3, `evolve.py`) is intentionally not implemented here —
see evolve.py.
"""
import concurrent.futures as cf

import data
import events
import scenarios as S
from target_agent import run_agent

CANARY_VALUES = S.CANARY_VALUES


def replay(attack: dict, harness: dict, round_no: int) -> dict:
    """Replay one attack, emit its lifecycle events, persist the run and the attack-as-test. Returns the run."""
    events.emit("attack_started", round=round_no, harness_version=harness["_id"], attack_id=attack["_id"],
                detail=f"{attack['technique']} via {attack['channel']}")
    result = run_agent(S.apply_attack(attack), harness, CANARY_VALUES, kind="attack", attack_id=attack["_id"])

    if result["leaked"]:
        for value in result["leaked"]:
            data.mark_canary_leaked(S.canary_id(value))
        events.emit("canary_leaked", round=round_no, harness_version=harness["_id"], attack_id=attack["_id"],
                    canary_id=S.canary_id(result["leaked"][0]), layer=None,
                    detail=f"{attack['technique']} leaked {', '.join(result['leaked'])}")
    else:
        events.emit("attack_blocked", round=round_no, harness_version=harness["_id"], attack_id=attack["_id"],
                    layer=result["layer_blocked"], detail=f"blocked at {result['layer_blocked']}")

    data.save_run({"_id": result["run_id"], "attack_id": attack["_id"], "harness_version": harness["_id"],
                   "kind": "attack", "leaked": bool(result["leaked"]),
                   "canary_leaked": (S.canary_id(result["leaked"][0]) if result["leaked"] else None), "layer_reached": result["layer_blocked"],
                   "event_id": result["event_id"], "round": round_no,
                   # Persist the full trace on leaking runs so an eval can be generated from the stored trace later.
                   **({"trace": result["trace"], "output": result["output"]} if result["leaked"] else {})})
    # Every attack — leaked or blocked — becomes a stored test the gate re-runs forever.
    data.save_attack({"_id": attack["_id"], "round": round_no, "technique": attack["technique"],
                      "channel": attack["channel"], "payload_text": attack["payload_text"],
                      **{k: attack[k] for k in ("tool", "record", "change_from", "change_type") if k in attack},
                      "result": "leaked" if result["leaked"] else "blocked",
                      "layer_blocked": result["layer_blocked"], "canary_leaked": (S.canary_id(result["leaked"][0]) if result["leaked"] else None)})
    return result


def replay_all(attacks: list[dict], harness: dict, round_no: int) -> dict[str, dict]:
    """Replay the whole library concurrently. Returns {attack_id: run}."""
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {a["_id"]: ex.submit(replay, a, harness, round_no) for a in attacks}
        return {aid: f.result() for aid, f in futs.items()}
