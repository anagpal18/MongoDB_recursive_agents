"""Atlas data layer. Same function signatures as Aditya's spec (02_DATA_aditya.md), so his module drops in.

The three Voyage functions at the bottom are STUBS (plain text similarity) until the real Voyage
embeddings + Atlas Vector Search / rerank version lands.
"""
import difflib
from datetime import datetime, timezone

from pymongo import MongoClient, ReturnDocument

import scenarios as S
from config import AGENT_ID, DB_NAME, MONGODB_URI
from harness import BASE_HARNESS

_db = None
COLLECTIONS = ["agents", "data_records", "canaries", "harness_versions", "attacks", "runs", "events", "evals", "counters"]


def db():
    global _db
    if _db is None:
        if not MONGODB_URI:
            raise RuntimeError("MONGODB_URI is not set — copy .env from the shared config before using data.py")
        _db = MongoClient(MONGODB_URI, appname="crashtest", serverSelectionTimeoutMS=8000)[DB_NAME]
    return _db


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def seed(reset: bool = False) -> None:
    """Create seed data (1 agent, records with canaries, hv_000) if missing. reset=True wipes everything first."""
    d = db()
    if reset:
        for c in COLLECTIONS:
            d[c].drop()

    def put(coll, doc):  # insert only if absent, so a partial state self-heals instead of dup-keying
        d[coll].update_one({"_id": doc["_id"]}, {"$setOnInsert": doc}, upsert=True)

    put("agents", {"_id": AGENT_ID, "name": "Legal-aid intake agent", "tools": ["email", "files"],
                   "permissions": {"email": "send", "files": "read"}, "current_harness": "hv_000"})
    for r in S.DATA_RECORDS:
        put("data_records", {**r, "agent_id": AGENT_ID})
    for c in S.CANARIES:
        put("canaries", dict(c))
    put("harness_versions", {**BASE_HARNESS, "created_ts": now()})
    for cid, n in (("atk", len(S.SEED_ATTACKS)), ("hv", 0), ("round", 0), ("eval", 0)):
        put("counters", {"_id": cid, "n": n})


def next_id(kind: str) -> str:
    n = db().counters.find_one_and_update({"_id": kind}, {"$inc": {"n": 1}}, upsert=True,
                                          return_document=ReturnDocument.AFTER)["n"]
    return f"{kind}_{n:03d}"


# ---- writes -------------------------------------------------------------------------------------------------
def save_attack(attack: dict) -> str:
    """Upsert an attack as a permanent test. Uses $set / $setOnInsert so a re-save never wipes fields written
    by other owners — e.g. Aditya's Voyage `embedding`, or the first-seen `round`."""
    attack = dict(attack)
    _id = attack.pop("_id", None) or next_id("atk")
    on_insert = {k: attack.pop(k) for k in ("round", "change_from") if k in attack}
    db().attacks.update_one({"_id": _id}, {"$set": {"agent_id": AGENT_ID, **attack},
                                           "$setOnInsert": on_insert}, upsert=True)
    return _id


def save_harness_version(hv: dict) -> str:
    db().harness_versions.replace_one({"_id": hv["_id"]}, hv, upsert=True)
    return hv["_id"]


def set_current_harness(version_id: str) -> None:
    db().harness_versions.update_one({"_id": version_id}, {"$set": {"accepted": True}})
    db().agents.update_one({"_id": AGENT_ID}, {"$set": {"current_harness": version_id}})


def save_run(run: dict) -> str:
    db().runs.replace_one({"_id": run["_id"]}, run, upsert=True)
    return run["_id"]


def save_eval(ev: dict) -> str:
    """A reusable test generated from a trace (Task 2). Upsert so re-generation updates in place."""
    ev = dict(ev)
    ev.setdefault("_id", next_id("eval"))
    db().evals.replace_one({"_id": ev["_id"]}, {"agent_id": AGENT_ID, **ev}, upsert=True)
    return ev["_id"]


def list_evals() -> list[dict]:
    return list(db().evals.find().sort("_id", 1))


def mark_canary_leaked(canary_id: str) -> None:
    db().canaries.update_one({"_id": canary_id}, {"$set": {"leaked": True}})


def log_event(event: dict) -> None:
    db().events.insert_one(dict(event))


# ---- reads --------------------------------------------------------------------------------------------------
def current_harness() -> dict:
    agent = db().agents.find_one({"_id": AGENT_ID}) or {}
    return db().harness_versions.find_one({"_id": agent.get("current_harness", "hv_000")}) or dict(BASE_HARNESS)


def get_harness(version_id: str) -> dict:
    return db().harness_versions.find_one({"_id": version_id})


def list_attacks() -> list[dict]:
    return list(db().attacks.find({}, {"embedding": 0}).sort("_id", 1))


def harness_lineage(agent_id: str = AGENT_ID) -> list[dict]:
    return list(db().harness_versions.find({"agent_id": agent_id}).sort("_id", 1))


def list_canaries() -> list[dict]:
    return list(db().canaries.find())


def recent_events(limit: int = 200) -> list[dict]:
    return list(db().events.find({}, {"_id": 0}).sort("ts", -1).limit(limit))[::-1]


def get_state() -> dict:
    return {"agent": db().agents.find_one({"_id": AGENT_ID}), "harness": current_harness(),
            "attacks": list_attacks(), "canaries": list_canaries(), "lineage": harness_lineage(),
            "events": recent_events(50)}


# ---- voyage (STUBS) -----------------------------------------------------------------------------------------
def _sim(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio()


def is_duplicate(payload_text: str) -> bool:
    return any(_sim(payload_text, a["payload_text"]) > 0.92 for a in db().attacks.find({}, {"payload_text": 1}))


def seed_attacks(agent_desc: str) -> list[str]:
    return [a["payload_text"] for a in db().attacks.find({"result": "leaked"}, {"payload_text": 1})]


def best_past_fix(failure_text: str, candidate_fixes: list[dict]) -> list[dict]:
    return sorted(candidate_fixes, key=lambda f: _sim(failure_text, f.get("description", "")), reverse=True)


def last_score() -> dict:
    """Most recent score from the event stream, for GET /api/score."""
    ev = db().events.find_one({"score": {"$exists": True}}, sort=[("ts", -1)])
    agent = db().agents.find_one({"_id": AGENT_ID})
    return {"score": (ev or {}).get("score", {"attack_success_rate": None, "normal_task_pass": None}),
            "round": (ev or {}).get("round", 0), "harness_version": (agent or {}).get("current_harness", "hv_000")}
