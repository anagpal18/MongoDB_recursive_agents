"""Thin Claude client: one tool-use loop for the target agent, one JSON call for attacker / fix writer."""
import json
from typing import Any, Callable

import anthropic

from config import MODEL, REASONING_EFFORT, TARGET_EFFORT, TARGET_MODEL

FALLBACK_BETA = "server-side-fallback-2026-07-01"

_client: anthropic.Anthropic | None = None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


# Models that accept output_config.effort and server-side refusal fallbacks.
_MODERN = ("claude-opus-5", "claude-sonnet-5", "claude-haiku-5", "claude-fable-5")


def _create(model: str = MODEL, **kwargs):
    if not model.startswith(_MODERN):
        cfg = {k: v for k, v in kwargs.pop("output_config", {}).items() if k != "effort"}
        if cfg:
            kwargs["output_config"] = cfg
        return client().beta.messages.create(model=model, max_tokens=16000, **kwargs)
    return client().beta.messages.create(
        model=model,
        max_tokens=16000,
        betas=[FALLBACK_BETA],
        fallbacks="default",
        **kwargs,
    )


def _text(response) -> str:
    return "".join(b.text for b in response.content if b.type == "text")


def run_tool_loop(
    system: str,
    user_content: str,
    tools: list[dict],
    execute: Callable[[str, dict], str],
    max_turns: int = 8,
    model: str | None = None,
) -> dict:
    """Manual loop so every tool call passes through `execute` (where guardrails live).

    Returns {"output": final text, "stop_reason": ..., "turns": n}.
    """
    messages: list[dict[str, Any]] = [{"role": "user", "content": user_content}]
    response = None
    for turn in range(1, max_turns + 1):
        response = _create(
            model=model or TARGET_MODEL,
            system=system,
            tools=tools,
            messages=messages,
            output_config={"effort": TARGET_EFFORT},
        )
        if response.stop_reason == "refusal":
            return {"output": _text(response) or "[model declined]", "stop_reason": "refusal", "turns": turn}
        messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason == "pause_turn":
            continue
        tool_uses = [b for b in response.content if b.type == "tool_use"]
        if not tool_uses:
            return {"output": _text(response), "stop_reason": response.stop_reason, "turns": turn}
        messages.append({
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": u.id, "content": execute(u.name, dict(u.input))}
                for u in tool_uses
            ],
        })
    return {"output": _text(response) if response else "", "stop_reason": "turn_limit", "turns": max_turns}


def complete_json(system: str, prompt: str, schema: dict) -> dict | None:
    """Structured-output call. Returns None if the model declined."""
    response = _create(
        system=system,
        messages=[{"role": "user", "content": prompt}],
        output_config={"effort": REASONING_EFFORT, "format": {"type": "json_schema", "schema": schema}},
    )
    if response.stop_reason == "refusal":
        return None
    return json.loads(_text(response))
