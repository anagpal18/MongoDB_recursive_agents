# CrashTest — Data layer execution plan (Aditya)

Scope: MongoDB Atlas + Voyage AI, from `02_DATA_aditya.md`. Shresth's repo already runs the loop and writes to `crashtest_dev`. This plan builds `data.py` against the shapes that are already live.

## Decisions so far
| Question | Answer |
|---|---|
| Cluster | `cluster0.jvfgld.mongodb.net` = hackathon Atlas Sandbox (MongoDB 8.0.34) |
| Database | `crashtest` while testing → switch to `crashtest_dev` for real data. Read from `MONGODB_DB` in `.env` so switching is one line. |
| Embeddings | Our own Voyage API key, called directly from Python. Vectors stored in `attacks.embedding`. |
| Writer of live data | Shresth's repo (path/URL still needed) |

## Open questions (blocking where marked)
1. **Shresth's repo path/URL** (blocking step 4): does `data.py` go in his repo or stay here as an importable package?
2. **Where the Voyage key came from** (blocking step 3): voyageai.com dashboard or MongoDB Atlas? Atlas-issued keys may use a different endpoint (`ai.mongodb.com`).
3. **Model:** the doc says `voyage-3`. Current Voyage docs list the 4-series (`voyage-4`, 1024 dims default). Recommend `voyage-4` @ 1024 dims for embeddings and `rerank-3` (or `rerank-3-lite`) for Job C. Needs a yes.

## Live schema vs doc (coordination items for Shresth)
- `attacks` live fields: `_id, agent_id, round, technique, channel, tool, record, payload_text, result, layer_blocked, canary_leaked`.
  Missing vs doc: `change_from`, `change_type` (attacker writes these), `embedding` (we write it).
- `runs` has extra `event_id`, `round`, `canary_leaked`. `counters` collection exists (ID sequences) — not in the doc; leave it alone.
- `agents.tools` live = `["email","files"]` (doc says email/files/web).

## Steps

### 0. Setup (≈15 min)
- `.env`: add `MONGODB_DB=crashtest`, `VOYAGE_API_KEY=...`, `VOYAGE_MODEL=voyage-4`.
- `python -m pip install voyageai` into conda base.
- `git init` already done; add `.gitignore` (done: `.env`). Repo must be public later.

### 1. Test DB `crashtest` (≈20 min)
- `seed.py` copies the shapes (not drops) into `crashtest`: 1 agent, ~10 `data_records`, 2–3 `canaries`, `hv_000`, plus the 7 live attacks as test fixtures.
- Seed only touches `crashtest`. **Never drop or rewrite `crashtest_dev`** — the loop writes to it concurrently.
- Regular indexes: `attacks{agent_id, round}`, `runs{harness_version}`, `events{ts}`, `harness_versions{agent_id, parent}`.

### 2. `data.py` — writes + reads (≈45 min)
Exactly the API in the doc:
- writes: `save_attack`, `save_harness_version`, `save_run`, `mark_canary_leaked`, `log_event`
- reads: `get_state`, `list_attacks`, `harness_lineage`, `list_canaries`
- `save_attack` embeds `payload_text` automatically, so every attack gets a vector.
- IDs: reuse the live `counters` pattern (`atk_014`, `hv_009`) via `find_one_and_update($inc)` so IDs match what Shresth's code expects.

### 3. Voyage + Vector Search (≈60 min)
- `embed(texts, input_type)` wrapper.
- Backfill: add `embedding` to existing attacks (additive `$set` only).
- **Auto-embed watcher:** Shresth's code inserts into `attacks` directly today (7 docs, none embedded). A change stream (fallback: poll) on `attacks` embeds any insert that has no `embedding`, so Job A works even if he never calls `save_attack`.
- Create Vector Search index `attacks_vec` on `attacks.embedding` (1024 dims, cosine, `filter` fields `agent_id`, `result`). **Poll `list_search_indexes()` until it reports ready** before testing; until then `$vectorSearch` returns nothing, which looks like a broken pipeline.
- **Job A** `is_duplicate(payload_text)`: attack vs. attack is symmetric, so embed both the stored attacks and the probe with the same `input_type="document"`. `$vectorSearch` top 1 → above threshold ⇒ duplicate. Atlas returns a 0–1 `vectorSearchScore`; for cosine it is reportedly `(1 + cos) / 2` (unconfirmed), so the doc's "cosine > 0.92" would be a score ≈ 0.96. Calibrate on the real attacks before trusting either number.
- **Job B** `seed_attacks(agent_desc)`: embed agent description with `input_type="query"` (asymmetric: description → attacks) → `$vectorSearch` with filter `result: "leaked"` → return payloads.
- **Job C** `best_past_fix(failure_text, candidates)`: Voyage `rerank` → ranked list.

### 4. Integration with Shresth (≈30 min)
- Put `data.py` where his orchestrator can import it (needs open question 1).
- Smoke test: his loop runs one round against `crashtest`; check that `events`, `runs`, `attacks.embedding` all land.

### 5. Live harness pickup (bonus, ≈20 min)
- `watch_harness_versions(callback)` via change stream on `harness_versions` (insert where `accepted: true`). Fallback: poll by `created_ts`.

### 6. Switch + freeze
- Flip `MONGODB_DB=crashtest_dev`, backfill embeddings there, create the vector index there.
- Feature freeze at +4:30 with the rest of the team.

## Definition of done (from doc)
1. Sandbox cluster live; 6 collections + seed data.
2. Vector index works; `is_duplicate()` sane.
3. `seed_attacks()` and `best_past_fix()` callable.
4. `data.py` importable by Shresth.
5. Change stream / polling for `harness_versions`.
