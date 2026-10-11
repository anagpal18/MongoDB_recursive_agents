# AEGIS-1 Orbital Sim

2D pixel-art demo scene. One defense ship (AEGIS-1) in orbit over a procedurally rendered Earth.
The scene does nothing on its own. It only reacts to **triggers**.

## Run

```bash
python -m http.server 5173
```

Open http://localhost:5173. The page also works from `file://` because nothing is bundled.

## Files

| File | What it is |
|---|---|
| `index.html` | Layout and theme. 98.css windows: status bar, live log, inspector, trigger console, comms. |
| `game.js` | The whole sim: Earth renderer, modular ship grid, hostiles, pods, camera, audio, logs, trigger API. |
| `icons.js` | Pixelarticons 1.8.1 path data (MIT), bundled so the demo works offline. |

## Triggers

Every trigger has one name and one optional payload.

| Trigger | Payload | Effect |
|---|---|---|
| `spawn` | `{kind, count}` kind = `wasp` `hammerhead` `leech` `warden` | A hostile warps in and approaches. |
| `wave` | `{kinds:[...]}` | Several hostiles warp in with a delay between each. |
| `attack` | – | Every hostile in range fires one volley. |
| `damage` | `{part, amount}` | Direct damage to one hull cell (shield absorbs first). |
| `repair` | `{part}` or `{all:true}` or – | Earth launches a repair pod. No payload = worst cell. |
| `upgrade` | `{id}` id = `flank` `capacitor` `bow` `core` | Earth launches an upgrade pod. New cells reform on the hull. |
| `retreat` | – | All hostiles disengage. |
| `log` | `{text, level, cat}` level = `info` `ok` `warn` `crit` `supply` `hostile` | Writes one line to the live log. |
| `say` | `{text}` | MIRA-7 speaks the line in the comms window. |
| `alert` | `{title, text}` | Shows the red popup. |
| `reset` / `demo` / `pause` | – | Reset the sim / run the 70 s scripted demo / toggle pause. |

### From the same page

```js
AEGIS.trigger('spawn', {kind: 'wasp', count: 2});
AEGIS.on('*', e => console.log(e));   // spawn, hit, breach, destroyed, pod.launch, pod.dock, upgrade.done, ...
AEGIS.state();                        // hull, shield, hostiles, parts, upgrades
```

### From another tab, an iframe, or a backend

```js
new BroadcastChannel('aegis').postMessage({type: 'spawn', payload: {kind: 'leech'}});
window.postMessage({aegis: true, type: 'repair'}, '*');
// WebSocket: open index.html?ws=ws://localhost:8787 and send {"type":"spawn","payload":{"kind":"warden"}}
```

Every sim event is also echoed back on the BroadcastChannel and the WebSocket.

## Keys

`1`–`4` spawn · `W` wave · `A` volley · `X` retreat · `R` repair · `U` upgrade · `D` demo · `P` pause · `M` mute · `Esc` deselect

## Credits

98.css (MIT) · Pixelarticons (MIT) · ship construction inspired by Cosmoteer's module grid.
