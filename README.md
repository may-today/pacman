# Munch Maze

A small 8-bit, pixel-art browser maze-chase game: eat every pellet in the maze while staying away from the four spiky Gloomlings.

The walls across the top of the maze spell out **MAYDAY**. You can weave between the letters, and they hold pellets like any other corridor.

## Play

Open `index.html` in a browser. There's no build step and nothing to install.

Or run a local server:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Controls

| Action | Keys |
| --- | --- |
| Move | Arrow keys / WASD (swipe or on-screen d-pad on phones) |
| Start / resume | Enter, Space, or tap |
| Pause | P / Esc |
| Mute | M |

## Rules

- Pellets are worth 10 points. Power orbs are worth 50 and make the Gloomlings scared for a few seconds.
- Eat scared Gloomlings for 200 → 400 → 800 → 1600 points.
- A bonus gem appears twice per level under the den.
- You get an extra life at 10,000 points.
- Clear every pellet to go to the next level, which is faster.
- Use the side tunnels to wrap across the maze. Gloomlings slow down inside them.

### The Gloomlings

| Name | Behaviour |
| --- | --- |
| Ember (red) | Chases you directly |
| Frost (cyan) | Aims four tiles ahead of you |
| Moss (lime) | Flanks you, working off Ember's position |
| Dusk (purple) | Chases when far away, backs off when close |

They switch between scattering to their corners and chasing on a timer.

## Files

- `index.html` – page layout and HUD
- `style.css` – styling
- `game.js` – game logic, AI, pixel-art sprites and rendering (168×168 canvas scaled up with nearest-neighbour), chiptune sound (Web Audio)
