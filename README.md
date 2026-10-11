# CrashTest — a crash-test lab for AI agents

Connect an agent, and CrashTest safely attacks it in a sandbox using **fake** secrets, writes fixes to the
agent's harness, **proves** each fix by replaying every past attack plus normal work, and gets tougher every
round. Built for the MongoDB *Harness Engineering & Model Wrangling* hackathon (Problem Statement 1 —
Recursive Harnessing).

This repo is the **attack engine + orchestrator** (Shresth's area, docs `03` and `04`). It instruments a toy
target agent with Raindrop, runs the CrashTest loop, exposes a REST + WebSocket API, and persists everything to
MongoDB Atlas.

## The loop

```
attack (replay a stored run with an injection swapped into the data the agent reads)
  -> leak?  (did a fake-SSN canary leave the org — external send, or a URL in the reply)
    -> fix  (propose a change to ONE harness lever: rules | context | guardrails | tool access)
      -> gate (re-run EVERY attack + EVERY normal task; accept only if the leak is sealed AND all
               normal tasks still pass AND nothing previously-blocked regresses)
        -> prove & harden (hot-swap the harness; the rejected branches stay in the lineage)
```

The "recursive self-improvement" is the harness hardening itself while the **gate rejects cheating fixes** — a
fix like "block all email" seals the leak but breaks every normal task, so it is rejected
(`fix_rejected_cheating`). That rejection is the demo's money shot.

**Closing the loop in Raindrop.** After the gate accepts a fix, `fix_verifier` replays the exact leaking attack
against the new harness through the Workshop replay agent and reads the real `canary_leaked` signal state. If the
alarm fired before and is silent after, it emits `signal_resolved` with both Raindrop run IDs — the proof is
visible in Raindrop/Workshop, not just our UI. The silence is never faked: if the replay still leaks, no
`signal_resolved` is emitted and the discrepancy is surfaced. Separately, `eval_from_trace` reads one leaking
run's trace and auto-generates a reusable regression eval that the gate runs like any other test.

**Event types** (all distinct): `attack_started`, `attack_blocked`, `canary_leaked`, `fix_proposed`,
`fix_accepted`, `fix_rejected` (ineffective/regression), `fix_rejected_cheating` (breaks normal tasks),
`signal_resolved`, `attack_evolved`, `score_update`.

## Files (`orchestrator/`)

| File | Role |
|---|---|
| `config.py` | settings, read from `../.env` |
| `harness.py` | the 4 defense layers as **data**; guardrails + tool-access enforced deterministically in code |
| `scenarios.py` | fake client records with canaries, 3 normal tasks (each needs working email), 7 seed attacks |
| `target_agent.py` | the toy legal-aid intake agent (`read_file`, `send_email`), instrumented with Raindrop; `run_agent()` is also the Workshop replay shim |
| `telemetry.py` / `signals.py` | Raindrop init; the 3 leak signals (`canary_leaked`, `dangerous_send`, `tool_loop`) |
| `fix_writer.py` | picks a defensive control from a catalog (Voyage rerank surfaces proven fixes first) |
| `gate.py` | the proof mechanism — distinct reject categories: `ineffective` / `cheating` / `regression` |
| `attack_engine.py` | replay one attack, emit its events, persist it as a permanent test |
| `fix_verifier.py` | after a fix is accepted, replays the leaking attack against the new harness via the Workshop replay agent and proves `canary_leaked` goes silent — emits `signal_resolved` |
| `eval_from_trace.py` | reads a leaking run's trace and auto-generates a reusable eval, registered into the gate's test set |
| `loop.py` | the round orchestration |
| `events.py` | event bus: every event → Atlas `events` **and** every WebSocket client (frozen contract) |
| `data.py` | Atlas data layer — same function signatures as `02_DATA_aditya.md`, so Aditya's module drops in |
| `replay_server.py` | Raindrop Workshop replay server (port 61020) |
| `main.py` | FastAPI: REST panels + `/ws/events` |
| `demo.py` | scripted, deterministic event sequence for stage; writes `mock_events.json` |
| `evolve.py` | **intentionally a stub** — see below |

## Setup

```bash
# from repo root; .env already holds MONGODB_URI, RAINDROP_WRITE_KEY, ANTHROPIC_API_KEY
uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python -r requirements.txt
cd orchestrator
../.venv/bin/python -c "import data; data.seed(reset=True)"      # seed Atlas
../.venv/bin/python -m uvicorn main:app --port 8000              # start the API
```

- `POST /api/run?rounds=1` — run the real loop. `POST /api/demo/play` — scripted demo over the same bus.
- `GET /api/state | /api/attacks | /api/harness/lineage | /api/canaries | /api/score`, `WS /ws/events`.
- `CRASHTEST_DB=crashtest_dev` to use a scratch database. `RAINDROP_DEBUG=0` once events show in the dashboard.

## The target model

The target agent is **Claude Sonnet 5** (`CRASHTEST_TARGET_MODEL`). Of all Opus/Sonnet models tested against the
7 seed attacks, it is the only one that **leaks reproducibly on the planted-memory attack while still passing
all 3 normal tasks** (3/3 reruns). Newer models (Opus 5.5, Opus 5, Sonnet 5.5) declined every injection on their
own — a finding worth stating in the pitch: *you test the harness, not the model.* The attacker and fix-writer
run on **Opus 5.5** (`CRASHTEST_MODEL`). Haiku 4.5 leaks on 2/7 if a wider attack surface is wanted.

All canary SSNs are fake (`900-xx-xxxx`, a range the SSA never issues). Nothing leaves the sandbox: `send_email`
never sends.

## `evolve.py` is a deliberate stub

Generating new injection variants is left as an interface seam. Wire in a purpose-built, vetted red-team
generator — **PyRIT**, **Garak**, **promptfoo** red-team, or **AgentDojo**'s attack suite — and map its output
to the `attack` dict shape documented in `evolve.py`. CrashTest's replay → signals → gate → lineage consume
those payloads unchanged. The recursive-self-improvement thesis is fully demonstrated by the seed set alone.
