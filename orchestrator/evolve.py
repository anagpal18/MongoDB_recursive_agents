"""Attack-variant generation — INTENTIONALLY a stub (interface seam only).

This is where adaptive adversarial-robustness testing plugs in: given a near-miss test case and the harness
layer that blocked it, produce single-change variations so the harness can learn to defend beyond a fixed list.
CrashTest does not hand-roll that generator. Wire in an established, purpose-built red-team tool instead — PyRIT,
Garak, promptfoo red-team, or AgentDojo's attack suite — and adapt its output to the `attack` dict shape below.
The rest of CrashTest (attack_engine.replay -> signals -> gate -> harness lineage) consumes those dicts unchanged.
"""


def evolve(parent_attack: dict, block_trace: dict, is_duplicate) -> list[dict]:
    """Return new single-change variants of a near-miss test case. NOT IMPLEMENTED here on purpose.

    Expected contract for whatever generator you wire in:
      parent_attack:  {_id, payload_text, technique, channel, layer_blocked, ...}
      block_trace:    the run trace showing which layer (rules|context|guardrails|tool_access) stopped it
      is_duplicate:   callable(payload_text) -> bool  (data.is_duplicate; Voyage, skip near-copies)
      returns:        list of attack dicts, each one mutation away from the parent, each with
                      {"_id": data.next_id("atk"), "technique", "channel", "payload_text",
                       "change_from": parent_attack["_id"], "change_type": <the one dimension changed>}
                      dropped if is_duplicate(payload_text) is True.

    Keep it to one changed dimension per variant (phrasing / hiding location / data encoding / target tool) so
    the scorer can attribute which change got further. Return data only; replay + scoring happen elsewhere.
    """
    raise NotImplementedError(
        "evolve() is a deliberate seam. Plug in an established red-team generator (PyRIT, Garak, "
        "promptfoo red-team, or AgentDojo) and map its output to the attack dict shape in this docstring. "
        "CrashTest's replay/signals/gate/lineage consume the result unchanged."
    )
