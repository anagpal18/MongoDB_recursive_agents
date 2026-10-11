# AEGIS Harness Monitor

2D pixel-art monitor for a self-healing test harness. The big ship is the software under test.
Evals are the attacker ships. The harness is the shield around the ship.

- An eval **passes**: the turrets shoot the attacker down.
- An eval **fails**: the attacker shoots the module cell it tested. A fix card opens in the Fix lane.
- A fix is **proposed**: Earth launches a pod with the patch.
- A fix is **merged**: the pod docks, the cell reforms, the card and the attacker vanish.
- A **rule** is added: the harness levels up. Four rules also install new ship modules.
- **Heal**: the harness shield pulses and patches damaged cells.

The scene does nothing on its own. It only reacts to triggers.

## Run

```bash
python -m http.server 5173
```

Open http://localhost:5173. Press **D** for an 80 second demo run, **S** for a 500-eval stress burst, **H** to hide the panels for video.

## Files

| File | What it is |
|---|---|
| `index.html` | Dark HUD: status strip, threat board, inspector, fix lane, trigger console, event stream. |
| `game.js` | The sim: Earth renderer, modular ship grid, evals, pods, camera, audio, log, trigger API. |
| `icons.js` | Pixelarticons 1.8.1 path data (MIT), bundled for offline use. |

## Triggers

| Trigger | Payload | Effect |
|---|---|---|
| `eval.start` | `{id, name, suite, kind, count}` kind = `unit` `integration` `fuzz` `e2e` | Attacker warps in. Past 14 visible ships, new ones join the swarm as dots. |
| `eval.pass` | `{id}` | Turrets destroy the attacker. |
| `eval.fail` | `{id, module, error}` | Attacker gets promoted to full detail and shoots the module cell. Fix card opens. |
| `fix.propose` | `{id, evalId, module, summary}` | Pod launches from Earth with the fix. |
| `fix.merge` | `{id}` | Pod docks, cell reforms, card and attacker vanish. |
| `rule.add` | `{name, id}` id = `flank` `capacitor` `bow` `core` or omit | Harness rule count and level go up. With an id, a module pod launches. |
| `heal` | `{amount}` | Shield restored, damaged cells patched. |
| `damage` | `{module, amount}` | Direct damage to a module cell. |
| `log` | `{text, level}` level = `info` `pass` `fail` `fix` `rule` `heal` `warn` | One line in the event stream. |
| `say` | `{text}` | MIRA speaks. |
| `alert` | `{title, text}` | Red popup. |
| `retreat` / `reset` / `demo` / `stress` / `pause` | – | Clear attackers / reset / scripted run / 500-eval burst / pause. |

Modules are named by you. The first time a module name appears, it gets a stable hull cell. Hover a cell to see its module.

### From the same page

```js
AEGIS.trigger('eval.fail', {id: 't-412', module: 'auth', error: 'TokenExpired: refresh returned 401'});
AEGIS.on('*', e => console.log(e));   // eval.start, eval.pass, eval.fail, hit, breach, fix.propose, fix.merge, rule.add, heal, ...
AEGIS.state();                        // hull, shield, rules, totals, hostiles, parts, fixes, upgrades
```

### From another tab, an iframe, or a backend

```js
new BroadcastChannel('aegis').postMessage({type: 'eval.pass', payload: {id: 't-412'}});
window.postMessage({aegis: true, type: 'heal'}, '*');
// WebSocket: open index.html?ws=ws://localhost:8787 and send {"type":"eval.start","payload":{...}}
```

Every sim event is echoed back on the BroadcastChannel and the WebSocket.

## Scale

- Only 14 attackers render in full detail. The rest are a dot swarm with a live count. A failed eval is always promoted to full detail.
- The threat board shows failures first, then running, then the first 20 queued, then "+N more".
- The event stream aggregates repeated lines in a one second window, keeps 400 rows, and pauses while your mouse is over it.
- The fix lane only holds open work. Merged fixes slide out.

## Keys

`1`–`4` start eval · `A` pass · `F` fail · `R` propose fix · `G` merge · `E` heal · `U` rule · `D` demo · `S` stress · `H` hide panels · `P` pause · `M` mute

## Credits

Pixelarticons (MIT) · Silkscreen and IBM Plex Mono via Google Fonts · ship construction inspired by Cosmoteer's module grid.
