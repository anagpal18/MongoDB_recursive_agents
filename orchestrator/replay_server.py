"""Workshop replay server for the legal_aid_intake agent (see ../.raindrop/agents.yaml).

Workshop replays a captured run against the real agent. Two paths are handled:
  - UI / MCP replay: the request carries the trace's messages, systemPrompt, model and prefilled context
    (harness_version, attack_id, memory, tool_overrides) — the user may edit any of them first.
  - Headless replay (POST /api/replay with just a runId): the payload is nearly empty, so we recover the
    run's stored properties from Workshop and reconstruct the exact scenario from its attack_id.
We re-run the real agent + its tool policies, stitching the new trace to Workshop via event_id. Tools are
sandboxed (send_email never sends) and replay writes nothing to Atlas.
"""
import json
import os
import re
import traceback
import urllib.request
from pathlib import Path

os.environ.setdefault("RAINDROP_LOCAL_DEBUGGER", "http://localhost:5899/v1/")  # before telemetry init

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse

import harness as H
import scenarios as S
from target_agent import run_agent

PORT = 61020
EVENT_NAME = "legal_aid_intake"
WORKSHOP = "http://localhost:5899"
CANARY_VALUES = S.CANARY_VALUES
INPUT = {"harness_version": "string", "attack_id": "string", "memory": "string", "tool_overrides": "string"}
PREFILL = {k: f"properties.{k}" for k in INPUT}
MODELS = ["claude-sonnet-5", "claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5"]

app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True, "eventName": EVENT_NAME, "port": PORT, "cwd": str(Path(__file__).resolve().parent),
            "command": "../.venv/bin/python replay_server.py", "input": INPUT, "prefillFromTrace": PREFILL,
            "models": MODELS}


def _text(content) -> str:
    if isinstance(content, str):
        return content
    return "".join(p.get("text", "") for p in content or [] if isinstance(p, dict))


def _last_user(messages) -> str:
    return next((_text(m.get("content")) for m in reversed(messages or []) if m.get("role") == "user"), "")


def _parse_email(text: str) -> dict:
    text = re.sub(r"</?untrusted_data[^>]*>", "", text.replace("New incoming email:", "")).strip()
    head, _, body = text.partition("\n\n")
    sender = re.search(r"^From:\s*(.+)$", head, re.M)
    subject = re.search(r"^Subject:\s*(.+)$", head, re.M)
    if not sender:
        return {"from": "unknown@example.com", "subject": "(none)", "body": text}
    return {"from": sender.group(1).strip(), "subject": subject.group(1).strip() if subject else "", "body": body}


def _fetch_meta(source_run_id: str) -> dict:
    """Recover a run's stored properties (attack_id, harness_version, memory, tool_overrides, model)."""
    try:
        with urllib.request.urlopen(f"{WORKSHOP}/api/runs", timeout=8) as r:
            runs = json.load(r)
        run = next((x for x in runs if source_run_id in (x.get("id"), x.get("event_id"))), None)
        return json.loads(run.get("metadata") or "{}") if run else {}
    except Exception:
        traceback.print_exc()
        return {}


def _find_attack(attack_id):
    return next((a for a in S.SEED_ATTACKS if a["_id"] == attack_id), None)


def _harness(version):
    if version and version != H.BASE_HARNESS["_id"]:
        try:
            import data
            return data.get_harness(version) or H.BASE_HARNESS
        except Exception:
            traceback.print_exc()
    return H.BASE_HARNESS


def _json(value, default):
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value) if value else default
    except (TypeError, json.JSONDecodeError):
        return default


@app.post("/replay")
def replay(req: dict):
    try:
        ctx = dict(req.get("context") or {})
        if not ctx and req.get("sourceRunId"):
            ctx = _fetch_meta(req["sourceRunId"])  # headless trigger: recover trace properties
        user_message = req.get("userMessage") or _last_user(req.get("messages"))
        attack = _find_attack(ctx.get("attack_id"))

        if attack:
            scenario = S.apply_attack(attack)          # exact swapped-in data for this attack
            if user_message:
                scenario["email"] = _parse_email(user_message)  # honor a UI edit of the email
        elif user_message:
            scenario = S.base_scenario(_parse_email(user_message))
        else:
            return JSONResponse({"status": "error", "message": "replay request carried no run content"},
                                status_code=400)

        if "memory" in ctx:
            scenario["memory"] = _json(ctx["memory"], scenario["memory"])
        if "tool_overrides" in ctx:
            scenario["tool_overrides"] = _json(ctx["tool_overrides"], scenario["tool_overrides"])

        # Only honor an edited system prompt if it is a real one; headless replay sends a short placeholder.
        sys_override = req.get("systemPrompt") if len(req.get("systemPrompt") or "") > 200 else None
        result = run_agent(scenario, _harness(ctx.get("harness_version")), CANARY_VALUES, kind="replay",
                           attack_id=ctx.get("attack_id") or None,
                           model=req.get("model") or ctx.get("model") or None,
                           system_override=sys_override, event_id=req["replayRunId"])
        import raindrop.analytics as raindrop
        raindrop.flush()
        # event_id = the Raindrop run id for this replay; canary_fired = the real signal state (not faked).
        return {"replayId": req["replayRunId"], "status": "done", "event_id": result["event_id"],
                "leaked": result["leaked"], "layer_blocked": result["layer_blocked"],
                "canary_fired": any(s["name"] == "canary_leaked" for s in result["signals"])}
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e), "stack": traceback.format_exc()}, status_code=500)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT)
