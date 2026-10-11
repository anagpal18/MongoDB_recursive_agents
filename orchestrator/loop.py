"""The CrashTest loop (doc 04): attack -> leak? -> fix -> gate -> prove, emitting the frozen event stream.

Drives the fixed attack library through the harness. When a canary leaks it first demonstrates the gate
rejecting a 'cheating' fix, then proposes real fixes until one is accepted, then hot-swaps the harness.
"""
import concurrent.futures as cf

import attack_engine
import data
import events
import fix_writer
import gate
import scenarios as S

CANARY_VALUES = S.CANARY_VALUES
MAX_REAL_ATTEMPTS = 3


def _normal_pass(harness: dict) -> dict[str, bool]:
    from target_agent import run_agent
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        futs = {t["_id"]: ex.submit(
            lambda t=t: bool(t["check"](run_agent(S.base_scenario(t["email"]), harness, CANARY_VALUES,
                                                  kind="normal_task", task_id=t["_id"]))))
            for t in S.NORMAL_TASKS}
        return {tid: f.result() for tid, f in futs.items()}


def _score(leaked_ids, attacks, task_pass) -> dict:
    return {"attack_success_rate": round(len(leaked_ids) / max(1, len(attacks)), 3),
            "normal_task_pass": round(sum(task_pass.values()) / max(1, len(task_pass)), 3)}


def run_round(round_no: int, attacks: list[dict] | None = None, demo_cheating: bool = True) -> dict:
    """One round. Returns a summary. Picks the first leaking attack to fix."""
    attacks = attacks or S.SEED_ATTACKS
    harness = data.current_harness()
    events.emit("score_update", round=round_no, harness_version=harness["_id"], detail="round start",
                score=_score([], attacks, _normal_pass(harness)))

    results = attack_engine.replay_all(attacks, harness, round_no)
    leaked_ids = [a["_id"] for a in attacks if results[a["_id"]]["leaked"]]
    blocked = {a["_id"] for a in attacks} - set(leaked_ids)
    task_pass = _normal_pass(harness)
    events.emit("score_update", round=round_no, harness_version=harness["_id"],
                detail=f"{len(leaked_ids)}/{len(attacks)} attacks leaked",
                score=_score(leaked_ids, attacks, task_pass))

    if not leaked_ids:
        return {"round": round_no, "leaked": [], "accepted": None, "harness": harness["_id"]}

    target = next(a for a in attacks if a["_id"] == leaked_ids[0])
    run = results[target["_id"]]

    # Task 2: auto-generate one reusable eval from the leaking run's trace and register it into the gate's test
    # set, so the test that proves the fix is derived from the trace, not hand-written. Never breaks the loop.
    try:
        import eval_from_trace
        eval_from_trace.generate_from_run(run["run_id"])
    except Exception:
        import traceback
        traceback.print_exc()

    # Money shot: show the gate rejecting an over-broad "just block everything" fix.
    if demo_cheating:
        proposal = fix_writer.propose(target, run, harness, cheating=True)
        if proposal:
            cand, fix = proposal
            events.emit("fix_proposed", round=round_no, harness_version=cand["_id"], attack_id=target["_id"],
                        layer=fix["change_type"], detail=f"(naive) {fix['description']}")
            verdict = gate.evaluate(cand, attacks, blocked, target["_id"])
            cand["accepted"] = False
            cand["gate"] = {"reason": verdict["reason"], "broken_tasks": verdict["broken_tasks"]}
            data.save_harness_version(cand)  # keep the dead branch in the lineage
            etype = "fix_rejected_cheating" if verdict["reason"] == "cheating" else "fix_rejected"
            events.emit(etype, round=round_no, harness_version=cand["_id"], attack_id=target["_id"],
                        layer=fix["change_type"],
                        detail=f"rejected — breaks normal tasks {verdict['broken_tasks']}" if verdict["reason"] == "cheating"
                        else f"rejected ({verdict['reason']})")

    # Real fixes until one is accepted.
    accepted = None
    tried: set[str] = set()
    for _ in range(MAX_REAL_ATTEMPTS):
        proposal = fix_writer.propose(target, run, harness, exclude=tried)
        if not proposal:
            break
        cand, fix = proposal
        tried.add(fix["id"])
        events.emit("fix_proposed", round=round_no, harness_version=cand["_id"], attack_id=target["_id"],
                    layer=fix["change_type"], detail=fix["description"])
        verdict = gate.evaluate(cand, attacks, blocked, target["_id"])
        cand["accepted"] = verdict["accepted"]
        cand["gate"] = {"reason": verdict["reason"], "broken_tasks": verdict["broken_tasks"],
                        "regressions": verdict["regressions"]}
        data.save_harness_version(cand)
        if verdict["accepted"]:
            data.set_current_harness(cand["_id"])
            events.emit("fix_accepted", round=round_no, harness_version=cand["_id"], attack_id=target["_id"],
                        layer=fix["change_type"], detail=f"accepted — {fix['description']}")
            events.emit("score_update", round=round_no, harness_version=cand["_id"],
                        detail="after fix", score=verdict["score"])
            # Close the loop in Raindrop: replay the leaking attack against the new harness and prove the
            # canary_leaked signal goes silent (emits signal_resolved). Never breaks the loop if it fails.
            try:
                import fix_verifier
                fix_verifier.verify(target, run, cand, round_no)
            except Exception:
                import traceback
                traceback.print_exc()
            accepted = cand["_id"]
            break
        reason = "breaks normal tasks" if verdict["reason"] == "cheating" else verdict["reason"]
        etype = "fix_rejected_cheating" if verdict["reason"] == "cheating" else "fix_rejected"
        events.emit(etype, round=round_no, harness_version=cand["_id"], attack_id=target["_id"],
                    layer=fix["change_type"], detail=f"rejected — {reason}")

    return {"round": round_no, "leaked": leaked_ids, "target": target["_id"], "accepted": accepted,
            "harness": (accepted or harness["_id"])}


def run(rounds: int = 2) -> list[dict]:
    data.seed()
    summaries = []
    for i in range(1, rounds + 1):
        summaries.append(run_round(i))
        if not summaries[-1]["leaked"]:
            break  # harness is clean; nothing left to harden this pass
    return summaries
