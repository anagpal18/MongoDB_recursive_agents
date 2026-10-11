"""CrashTest data layer (MongoDB Atlas + Voyage AI). API per 02_DATA_aditya.md.

Settings come from .env:
    MONGODB_URI    Atlas connection string
    CRASHTEST_DB   database name (default: crashtest; real data lives in crashtest_dev)
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
