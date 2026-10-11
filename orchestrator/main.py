"""FastAPI orchestrator (doc 04): REST panels + one WebSocket live feed for the frontend.

Every event goes to BOTH Atlas (events.emit, via data.log_event) and every connected WebSocket client.
The CrashTest loop is synchronous (it blocks on LLM calls), so it runs in a thread pool; events reach the
async WebSocket subscribers through events.publish -> loop.call_soon_threadsafe.
"""
import asyncio

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import data
import demo
import events
import loop as crashtest_loop

app = FastAPI(title="CrashTest Orchestrator")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_busy = asyncio.Lock()  # one live run / demo at a time


@app.on_event("startup")
def _startup():
    data.seed()


@app.get("/api/state")
def state():
    return JSONResponse(data.get_state())


@app.get("/api/attacks")
def attacks():
    return JSONResponse(data.list_attacks())


@app.get("/api/harness/lineage")
def lineage():
    return JSONResponse(data.harness_lineage())


@app.get("/api/canaries")
def canaries():
    return JSONResponse(data.list_canaries())


@app.get("/api/score")
def score():
    return JSONResponse(data.last_score())


@app.post("/api/demo/play")
async def demo_play():
    if _busy.locked():
        return JSONResponse({"status": "busy"}, status_code=409)
    async with _busy:
        await demo.play()
    return {"status": "done", "events": len(demo.build())}


@app.post("/api/demo/reset")
async def demo_reset():
    if _busy.locked():
        return JSONResponse({"status": "busy"}, status_code=409)
    async with _busy:  # don't drop collections out from under an in-flight run / state read
        await asyncio.get_running_loop().run_in_executor(None, lambda: data.seed(reset=True))
    return {"status": "reset", "harness": data.current_harness()["_id"]}


@app.post("/api/run")
async def run_live(rounds: int = 1):
    """Run the real loop (attacks -> fix -> gate) in a worker thread; events stream over /ws/events."""
    if _busy.locked():
        return JSONResponse({"status": "busy"}, status_code=409)
    async with _busy:
        summaries = await asyncio.get_running_loop().run_in_executor(None, crashtest_loop.run, rounds)
    return {"status": "done", "summaries": summaries}


@app.websocket("/ws/events")
async def ws_events(ws: WebSocket):
    await ws.accept()
    q = events.subscribe(asyncio.get_running_loop())  # capture THIS running loop for call_soon_threadsafe
    try:
        await ws.send_json({"type": "snapshot", "state": data.get_state()})
        while True:
            # Race the next event against a client disconnect, so a parked q.get() can't leak the
            # subscriber (and keep the loop pushing into a queue nobody drains) after the client leaves.
            get, recv = asyncio.ensure_future(q.get()), asyncio.ensure_future(ws.receive())
            done, _ = await asyncio.wait({get, recv}, return_when=asyncio.FIRST_COMPLETED)
            if recv in done:
                get.cancel()
                recv.result()  # raises WebSocketDisconnect when the client closed
                break
            recv.cancel()
            await ws.send_json(get.result())
    except WebSocketDisconnect:
        pass
    finally:
        events.unsubscribe(q)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
