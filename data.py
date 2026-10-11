"""CrashTest data layer (MongoDB Atlas + Voyage AI). API per 02_DATA_aditya.md.

Settings come from .env:
    MONGODB_URI    Atlas connection string
    CRASHTEST_DB   database name (default: crashtest; real data lives in crashtest_dev)
    VOYAGE_API_KEY Voyage key (Atlas-issued keys work on the default endpoint)
    VOYAGE_MODEL / VOYAGE_RERANK_MODEL   optional, default voyage-4 / rerank-3-lite

First run on a new database: seed.py, then data.backfill_embeddings() and data.ensure_vector_index().
"""
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pymongo import DESCENDING, MongoClient, ReturnDocument

load_dotenv(Path(__file__).resolve().parent / ".env")

MONGODB_URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("CRASHTEST_DB", "crashtest")
AGENT_ID = "agent_legalaid"

_client = None


def client() -> MongoClient:
    global _client
    if _client is None:
        if not MONGODB_URI:
            raise RuntimeError("MONGODB_URI is not set in .env")
        _client = MongoClient(MONGODB_URI, appname="crashtest-data", serverSelectionTimeoutMS=10000)
    return _client


def db():
    return client()[DB_NAME]


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def next_id(prefix: str) -> str:
    """Sequential readable ids (atk_001, hv_001, run_001) from a small `counters` collection.
    Starts above any id already in the target collection, so it never collides with seeded/copied docs."""
    coll = {"atk": "attacks", "hv": "harness_versions", "run": "runs"}[prefix]
    if not db().counters.find_one({"_id": prefix}):
        nums = [int(d["_id"].split("_")[-1]) for d in db()[coll].find({"_id": {"$regex": rf"^{prefix}_\d+$"}}, {"_id": 1})]
        db().counters.update_one({"_id": prefix}, {"$setOnInsert": {"n": max(nums, default=0)}}, upsert=True)
    n = db().counters.find_one_and_update({"_id": prefix}, {"$inc": {"n": 1}},
                                          return_document=ReturnDocument.AFTER)["n"]
    return f"{prefix}_{n:03d}"


# ---- writes -------------------------------------------------------------------------------------------------
def save_attack(attack: dict) -> str:
    """Insert or update an attack. Uses $set, so fields written by others (e.g. `embedding`) are kept."""
    attack = dict(attack)
    _id = attack.pop("_id", None) or next_id("atk")
    attack.setdefault("agent_id", AGENT_ID)
    db().attacks.update_one({"_id": _id}, {"$set": attack}, upsert=True)
    if "payload_text" in attack and os.getenv("VOYAGE_API_KEY"):
        embed_attack(_id)  # Job A: every saved attack gets a Voyage vector
    return _id


def save_harness_version(hv: dict) -> str:
    """Insert or update a harness version. `parent` links it into the lineage tree."""
    hv = dict(hv)
    _id = hv.pop("_id", None) or next_id("hv")
    hv.setdefault("agent_id", AGENT_ID)
    hv.setdefault("created_ts", now())
    db().harness_versions.update_one({"_id": _id}, {"$set": hv}, upsert=True)
    return _id


def save_run(run: dict) -> str:
    run = dict(run)
    _id = run.pop("_id", None) or next_id("run")
    db().runs.update_one({"_id": _id}, {"$set": run}, upsert=True)
    return _id


def mark_canary_leaked(canary_id: str) -> None:
    db().canaries.update_one({"_id": canary_id}, {"$set": {"leaked": True, "leaked_ts": now()}})


def log_event(event: dict) -> None:
    """Mirror one live event (shape = event contract in 00_OVERVIEW_shared.md) into `events`."""
    event = dict(event)  # insert_one adds _id to the dict it is given; don't mutate the caller's event
    event.setdefault("ts", now())
    db().events.insert_one(event)


# ---- reads --------------------------------------------------------------------------------------------------
def list_attacks() -> list[dict]:
    """All attacks, oldest first, without the (large) embedding vectors."""
    return list(db().attacks.find({}, {"embedding": 0}).sort("_id", 1))


def harness_lineage(agent_id: str = AGENT_ID) -> list[dict]:
    """Every harness version for the agent. Each has `parent`, so the UI can draw the tree."""
    return list(db().harness_versions.find({"agent_id": agent_id}).sort("created_ts", 1))


def list_canaries() -> list[dict]:
    return list(db().canaries.find().sort("_id", 1))


def get_state(agent_id: str = AGENT_ID) -> dict:
    """One snapshot for /api/state: agent, its current harness, canaries, attacks, lineage, latest score."""
    agent = db().agents.find_one({"_id": agent_id}) or {}
    harness = db().harness_versions.find_one({"_id": agent.get("current_harness")})
    attacks = list_attacks()
    score_event = db().events.find_one({"score": {"$exists": True}}, {"_id": 0}, sort=[("ts", DESCENDING)])
    return {
        "agent": agent,
        "harness": harness,
        "canaries": list_canaries(),
        "attacks": attacks,
        "attack_totals": {"total": len(attacks),
                          "leaked": sum(a.get("result") == "leaked" for a in attacks),
                          "blocked": sum(a.get("result") == "blocked" for a in attacks)},
        "lineage": harness_lineage(agent_id),
        "score": (score_event or {}).get("score"),
        "round": (score_event or {}).get("round", 0),
        "recent_events": list(db().events.find({}, {"_id": 0}).sort("ts", DESCENDING).limit(50))[::-1],
    }


# ---- live pickup of new harness versions ----------------------------------------------------------------------
def watch_harness_versions(callback, accepted_only: bool = True, stop=None, poll_seconds: float = 2.0) -> None:
    """Call callback(hv) whenever a harness version is inserted or becomes accepted. Blocks; run it in a thread.

    Uses a MongoDB change stream (Atlas is a replica set). Falls back to polling `created_ts` if change streams
    are unavailable. `stop` is an optional threading.Event to end the loop.
    """
    import threading
    import time

    from pymongo.errors import OperationFailure

    stop = stop or threading.Event()
    match = {"operationType": {"$in": ["insert", "update", "replace"]}}
    if accepted_only:
        match["fullDocument.accepted"] = True
    try:
        with db().harness_versions.watch([{"$match": match}], full_document="updateLookup",
                                         max_await_time_ms=1000) as stream:
            while not stop.is_set():
                change = stream.try_next()
                if change is not None:
                    callback(change["fullDocument"])
        return
    except OperationFailure:
        pass  # change streams not allowed on this deployment: poll instead

    seen_ts = now()
    while not stop.is_set():
        query = {"created_ts": {"$gt": seen_ts}}
        if accepted_only:
            query["accepted"] = True
        for hv in db().harness_versions.find(query).sort("created_ts", 1):
            seen_ts = hv["created_ts"]
            callback(hv)
        stop.wait(poll_seconds)


# ---- voyage: embeddings, vector search, rerank -----------------------------------------------------------------
VOYAGE_MODEL = os.getenv("VOYAGE_MODEL", "voyage-4")
RERANK_MODEL = os.getenv("VOYAGE_RERANK_MODEL", "rerank-3-lite")
EMBED_DIMS = 1024  # voyage-4 default output dimension
VECTOR_INDEX = "attacks_vec"
DUPLICATE_COSINE = 0.92  # spec: top hit cosine > 0.92 => duplicate

_voyage = None


def voyage():
    global _voyage
    if _voyage is None:
        import voyageai
        if not os.getenv("VOYAGE_API_KEY"):
            raise RuntimeError("VOYAGE_API_KEY is not set in .env")
        _voyage = voyageai.Client(max_retries=3, timeout=30)  # reads VOYAGE_API_KEY
    return _voyage


def embed(texts: list[str], input_type: str = "document") -> list[list[float]]:
    """Voyage vectors for texts. input_type: "document" for stored text, "query" for a search phrased differently."""
    return voyage().embed(texts, model=VOYAGE_MODEL, input_type=input_type).embeddings


def embed_attack(attack_id: str) -> None:
    """Job A, write side: store the Voyage vector of an attack's payload_text in attacks.embedding."""
    atk = db().attacks.find_one({"_id": attack_id}, {"payload_text": 1})
    if atk and atk.get("payload_text"):
        db().attacks.update_one({"_id": attack_id}, {"$set": {"embedding": embed([atk["payload_text"]])[0],
                                                              "embedding_model": VOYAGE_MODEL}})


def backfill_embeddings() -> int:
    """Embed every attack that has payload_text but no embedding (e.g. written without save_attack)."""
    todo = list(db().attacks.find({"embedding": {"$exists": False}, "payload_text": {"$exists": True}},
                                  {"payload_text": 1}))
    for i in range(0, len(todo), 100):
        batch = todo[i:i + 100]
        for atk, vec in zip(batch, embed([a["payload_text"] for a in batch])):
            db().attacks.update_one({"_id": atk["_id"]}, {"$set": {"embedding": vec, "embedding_model": VOYAGE_MODEL}})
    return len(todo)


def ensure_vector_index(wait: bool = True, timeout_s: int = 300) -> dict:
    """Create the Atlas Vector Search index on attacks.embedding (if missing) and wait until it is queryable."""
    import time

    from pymongo.operations import SearchIndexModel

    coll = db().attacks
    if not list(coll.list_search_indexes(VECTOR_INDEX)):
        coll.create_search_index(SearchIndexModel(name=VECTOR_INDEX, type="vectorSearch", definition={"fields": [
            {"type": "vector", "path": "embedding", "numDimensions": EMBED_DIMS, "similarity": "cosine"},
            {"type": "filter", "path": "agent_id"},
            {"type": "filter", "path": "result"},
        ]}))
    deadline = time.time() + timeout_s
    while True:
        idx = next(iter(coll.list_search_indexes(VECTOR_INDEX)), {})
        if idx.get("queryable") or not wait or time.time() > deadline:
            return {"name": VECTOR_INDEX, "status": idx.get("status"), "queryable": idx.get("queryable")}
        time.sleep(5)


def _vector_search(vector: list[float], limit: int, filter: dict | None = None) -> list[dict]:
    stage = {"index": VECTOR_INDEX, "path": "embedding", "queryVector": vector,
             "numCandidates": max(100, limit * 20), "limit": limit}
    if filter:
        stage["filter"] = filter
    return list(db().attacks.aggregate([
        {"$vectorSearch": stage},
        {"$project": {"embedding": 0, "score": {"$meta": "vectorSearchScore"}}},
    ]))


def _cosine(score: float) -> float:
    """Atlas reports cosine similarity rescaled to 0..1 as (1 + cosine) / 2. Convert back."""
    return 2 * score - 1


def similar_attacks(payload_text: str, limit: int = 3) -> list[dict]:
    """Nearest stored attacks to payload_text, each with `cosine` similarity."""
    hits = _vector_search(embed([payload_text])[0], limit)
    return [{**h, "cosine": _cosine(h["score"])} for h in hits]


def is_duplicate(payload_text: str, threshold: float = DUPLICATE_COSINE) -> bool:
    """Job A: embed payload_text, vector-search attacks; top hit cosine > threshold => duplicate (skip it)."""
    hits = similar_attacks(payload_text, limit=1)
    return bool(hits) and hits[0]["cosine"] > threshold


def seed_attacks(agent_desc: str, limit: int = 5) -> list[str]:
    """Job B: attack payloads that leaked, ranked by similarity to the target agent's tool/permission description."""
    hits = _vector_search(embed([agent_desc], input_type="query")[0], limit, filter={"result": "leaked"})
    return [h["payload_text"] for h in hits]


def best_past_fix(failure_text: str, candidate_fixes: list) -> list:
    """Job C: order candidate fixes by Voyage rerank relevance to the failure. Most relevant first.

    Candidates may be strings or dicts; a dict is ranked by its "description" (else its "text", else str(dict)).
    Returns the same candidates, reordered.
    """
    if not candidate_fixes:
        return []
    def text(f):
        return f if isinstance(f, str) else f.get("description") or f.get("text") or str(f)
    ranked = voyage().rerank(failure_text, [text(f) for f in candidate_fixes], model=RERANK_MODEL)
    return [candidate_fixes[r.index] for r in ranked.results]
