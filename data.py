"""CrashTest data layer (MongoDB Atlas + Voyage AI). API per 02_DATA_aditya.md.

Settings come from .env:
    MONGODB_URI    Atlas connection string
    CRASHTEST_DB   database name (default: crashtest; real data lives in crashtest_dev)
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

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
