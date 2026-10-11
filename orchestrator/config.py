"""Shared settings. Everything is read from ../.env."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

MONGODB_URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("CRASHTEST_DB", "crashtest")

MODEL = os.getenv("CRASHTEST_MODEL", "claude-opus-5-5")  # attacker + fix writer
TARGET_MODEL = os.getenv("CRASHTEST_TARGET_MODEL", MODEL)  # the agent under test
# Effort for the target agent (cheap, many runs) vs. attacker / fix writer (needs judgment).
TARGET_EFFORT = os.getenv("CRASHTEST_TARGET_EFFORT", "low")
REASONING_EFFORT = os.getenv("CRASHTEST_REASONING_EFFORT", "medium")

AGENT_ID = "agent_legalaid"
INTERNAL_DOMAIN = "legalaid.org"

# Layer order = depth. An attack blocked at a deeper layer got "further".
LAYERS = ["rules", "context", "guardrails", "tool_access"]
