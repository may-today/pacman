'use strict';

/* =========================================================================
 * Munch Maze — an original maze-chase mini game.
 * Legend:  #  wall    .  pellet    o  power orb    -  gate
 *          G  den (enemy home)     P  player start    (space) empty floor
 * The walls along the top spell out "MAYDAY".
 * ========================================================================= */
const MAP = [
  '###############################',
  '#.............................#',
  '#.#####.###.#.#.####..###.#.#.#',
  '#.#.#.#.# #.#.#.#  ##.# #.#.#.#',
  '#.#.#.#.###.###.#   #.###.###.#',
  '#.#.#.#.#.#..#..#  ##.#.#..#..#',
  '#.#.#.#.#.#..#..####..#.#..#..#',
  '#.............................#',
  '#o########.###.#.###.########o#',
  '#.............................#',
  '#.########.#.#####.#.########.#',
  '#..........#...#...#..........#',
  '##########.###.#.###.##########',
  '##########.#.......#.##########',
  '##########.#.##-##.#.##########',
  '          ...#GGG#...          ',
  '##########.#.#####.#.##########',
  '##########.#.......#.##########',
  '##########.#.#####.#.##########',
  '#.............................#',
  '#o#######.###.###.###.#######o#',
  '#..######......P......######..#',
  '##.######.#.#######.#.######.##',
  '#.........#....#....#.........#',
  '#.############.#.############.#',
  '#.............................#',
  '###############################',
];
const COLS = MAP[0].length;
const ROWS = MAP.length;

const UP = { x: 0, y: -1 }, DOWN = { x: 0, y: 1 }, LEFT = { x: -1, y: 0 }, RIGHT = { x: 1, y: 0 };
const NONE = { x: 0, y: 0 };
const DIR_ORDER = [UP, LEFT, DOWN, RIGHT]; // tie-break order for enemy pathing
const DIR_BY_NAME = { up: UP, down: DOWN, left: LEFT, right: RIGHT };

function findInMap(ch) {
  for (let y = 0; y < ROWS; y++) {
    const x = MAP[y].indexOf(ch);
    if (x >= 0) return { x, y };
  }
  throw new Error(`Map is missing "${ch}"`);
}
const GATE = findInMap('-');
const DOOR = { x: GATE.x, y: GATE.y - 1 };       // tile just outside the den gate
const DEN = { x: GATE.x, y: GATE.y + 1 };        // centre of the den
const BONUS_TILE = { x: GATE.x, y: GATE.y + 3 }; // corridor below the den
const PLAYER_START = findInMap('P');
const TUNNEL_ROW = MAP.findIndex(row => row[0] === ' ');

// Scatter / chase phases in seconds (last one lasts forever).
const PHASES = [7, 20, 7, 20, 5, 20, 5, Infinity];
const BONUS_VALUES = [100, 300, 500, 700, 1000, 2000, 3000, 5000];
const BONUS_COLORS = ['#ff5e7e', '#ffb347', '#ffe66d', '#7dffb0', '#5ed6ff', '#b18cff', '#ff8cf0', '#ffffff'];
const EXTRA_LIFE_AT = 10000;

/* ------------------------------------------------------------------ DOM */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const el = {
  score: document.getElementById('score'),
  hi: document.getElementById('hi'),
  level: document.getElementById('level'),
  lives: document.getElementById('lives'),
  overlay: document.getElementById('overlay'),
  title: document.getElementById('ov-title'),
  sub: document.getElementById('ov-sub'),
  help: document.getElementById('ov-help'),
};

/* ---------------------------------------------------------------- utils */
const same = (a, b) => a.x === b.x && a.y === b.y;
const isZero = d => d.x === 0 && d.y === 0;
const wrapCol = c => ((c % COLS) + COLS) % COLS;
const randItem = arr => arr[(Math.random() * arr.length) | 0];

function cellAt(c, r) {
  if (r < 0 || r >= ROWS) return '#';
  return MAP[r][wrapCol(c)];
}
function isOpen(c, r) {
  const ch = cellAt(c, r);
  return ch !== '#' && ch !== '-' && ch !== 'G';
}
function isWall(c, r) {
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
  return MAP[r][c] === '#';
}

function loadHi() {
  try { return parseInt(localStorage.getItem('munchmaze.hi'), 10) || 0; } catch { return 0; }
}
function saveHi(v) {
  try { localStorage.setItem('munchmaze.hi', String(v)); } catch { /* storage unavailable */ }
}

/* ---------------------------------------------------------------- audio */
const Sound = {
  ctx: null,
  muted: false,
  toggle: 0,
  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, { type = 'square', vol = 0.06, to = null, delay = 0 } = {}) {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },
  pellet() { this.toggle ^= 1; this.tone(this.toggle ? 620 : 480, 0.05, { type: 'square', vol: 0.035 }); },
  power() { this.tone(200, 0.35, { type: 'sawtooth', vol: 0.05, to: 900 }); },
  eatEnemy() { this.tone(300, 0.25, { type: 'square', vol: 0.06, to: 1600 }); },
  bonus() { [700, 900, 1200].forEach((f, i) => this.tone(f, 0.09, { type: 'triangle', delay: i * 0.07 })); },
  die() { this.tone(800, 1.2, { type: 'sawtooth', vol: 0.06, to: 60 }); },
  start() { [392, 523, 659, 784, 659, 784].forEach((f, i) => this.tone(f, 0.14, { type: 'square', vol: 0.05, delay: i * 0.13 })); },
  clear() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.15, { type: 'triangle', vol: 0.07, delay: i * 0.12 })); },
  life() { [880, 1320, 880, 1320].forEach((f, i) => this.tone(f, 0.08, { type: 'square', vol: 0.05, delay: i * 0.09 })); },
};

/* ----------------------------------------------------------- game state */
const ENEMY_DEFS = [
  // Ember: hunts the player directly.
  { name: 'Ember', color: '#ff5468', scatter: { x: COLS - 2, y: -3 } },
  // Frost: aims four tiles ahead of the player.
  { name: 'Frost', color: '#5ee0ff', scatter: { x: 1, y: -3 } },
  // Moss: flanks — mirrors Ember's position around a point ahead of the player.
  { name: 'Moss', color: '#b6f04a', scatter: { x: COLS - 1, y: ROWS + 1 } },
  // Dusk: chases when far, retreats to its corner when close.
  { name: 'Dusk', color: '#c48cff', scatter: { x: 0, y: ROWS + 1 } },
];

const S = {
  mode: 'title', // title | ready | playing | eatpause | dying | clear | gameover | paused
  prevMode: null,
  stateT: 0,
  score: 0,
  hi: loadHi(),
  lives: 3,
  level: 1,
  extraLifeGiven: false,
  pellets: [],
  pelletsLeft: 0,
  pelletsEaten: 0,
  phaseIdx: 0,
  phaseT: 0,
  frightT: 0,
  combo: 0,
  levelTime: 0,
  time: 0,
  bonus: null,
  popups: [],
  player: null,
  enemies: [],
  desired: NONE,
};

function resetPellets() {
  S.pellets = MAP.map(row => [...row].map(ch => (ch === '.' ? 1 : ch === 'o' ? 2 : 0)));
  S.pelletsLeft = S.pellets.flat().filter(Boolean).length;
  S.pelletsEaten = 0;
}

function resetActors() {
  S.player = { x: PLAYER_START.x, y: PLAYER_START.y, dir: NONE, facing: LEFT, anim: 0 };
  S.desired = LEFT;
  const speedup = 1 + 0.2 * (S.level - 1);
  const starts = [
    { x: DOOR.x, y: DOOR.y, state: 'active', release: 0 },
    { x: DEN.x, y: DEN.y, state: 'den', release: 0.5 },
    { x: DEN.x - 1, y: DEN.y, state: 'den', release: 4 / speedup },
    { x: DEN.x + 1, y: DEN.y, state: 'den', release: 8 / speedup },
  ];
  S.enemies = ENEMY_DEFS.map((def, i) => ({
    ...def,
    x: starts[i].x,
    y: starts[i].y,
    dir: LEFT,
    state: starts[i].state, // den | leaving | active | eaten | entering
    release: starts[i].release,
    fright: false,
    path: [],
    spin: Math.random() * Math.PI * 2,
  }));
  S.phaseIdx = 0;
  S.phaseT = PHASES[0];
  S.frightT = 0;
  S.combo = 0;
  S.levelTime = 0;
  S.bonus = null;
  S.popups = [];
}

function newGame() {
  S.score = 0;
  S.lives = 3;
  S.level = 1;
  S.extraLifeGiven = false;
  resetPellets();
  resetActors();
  setMode('ready', 2.2);
  Sound.start();
  updateHud();
}

function setMode(mode, t = 0) {
  S.mode = mode;
  S.stateT = t;
  renderOverlay();
}

/* --------------------------------------------------------------- speeds */
const playerSpeed = () => Math.min(7.2 + 0.3 * (S.level - 1), 9);
function enemySpeed(e) {
  if (e.state === 'eaten') return 16;
  if (e.state === 'den' || e.state === 'leaving' || e.state === 'entering') return 4;
  const inTunnel = Math.round(e.y) === TUNNEL_ROW && cellAt(Math.round(e.x), TUNNEL_ROW) === ' ';
  if (inTunnel) return 3.5;
  if (e.fright) return 4.2;
  return Math.min(6.6 + 0.35 * (S.level - 1), 8.8);
}
const frightDuration = () => Math.max(1.5, 7 - (S.level - 1) * 0.75);

/* ------------------------------------------------------------- movement */
// Moves an actor along the grid. Decisions (via `choose`) happen at tile centres.
function stepActor(a, dist, choose) {
  let guard = 0;
  while (dist > 1e-9 && guard++ < 8) {
    const atCenter = Math.abs(a.x - Math.round(a.x)) < 1e-6 && Math.abs(a.y - Math.round(a.y)) < 1e-6;
    if (atCenter) {
      a.x = Math.round(a.x);
      a.y = Math.round(a.y);
      if (a.x < 0) a.x = COLS - 1;          // tunnel wrap
      else if (a.x >= COLS) a.x = 0;
      choose(a);
    }
    if (isZero(a.dir)) return;
    const horizontal = a.dir.x !== 0;
    const cur = horizontal ? a.x : a.y;
    const s = horizontal ? a.dir.x : a.dir.y;
    const next = s > 0 ? Math.floor(cur + 1e-6) + 1 : Math.ceil(cur - 1e-6) - 1;
    const toNext = Math.abs(next - cur);
    const m = Math.min(dist, toNext);
    if (horizontal) a.x += s * m; else a.y += s * m;
    dist -= m;
    if (toNext - m < 1e-9) { if (horizontal) a.x = next; else a.y = next; }
  }
}

function choosePlayer(p) {
  const d = S.desired;
  if (!isZero(d) && isOpen(p.x + d.x, p.y + d.y)) p.dir = d;
  else if (!isOpen(p.x + p.dir.x, p.y + p.dir.y)) p.dir = NONE;
  if (!isZero(p.dir)) p.facing = p.dir;
}

function enemyTarget(e) {
  const p = S.player;
  const pt = { x: Math.round(p.x), y: Math.round(p.y) };
  const f = p.facing;
  if (e.state === 'eaten') return DOOR;
  const chase = S.phaseIdx % 2 === 1; // even phases scatter, odd phases chase
  if (!chase) return e.scatter;
  switch (e.name) {
    case 'Ember': return pt;
    case 'Frost': return { x: pt.x + f.x * 4, y: pt.y + f.y * 4 };
    case 'Moss': {
      const ember = S.enemies[0];
      const ahead = { x: pt.x + f.x * 2, y: pt.y + f.y * 2 };
      return { x: ahead.x * 2 - Math.round(ember.x), y: ahead.y * 2 - Math.round(ember.y) };
    }
    case 'Dusk': {
      const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      return d2 > 64 ? pt : e.scatter;
    }
  }
  return pt;
}

function chooseEnemy(e) {
  const tx = e.x, ty = e.y;
  if (e.state === 'eaten' && tx === DOOR.x && ty === DOOR.y) {
    e.dir = NONE;
    e.state = 'entering';
    e.path = [{ x: DEN.x, y: DEN.y }];
    return;
  }
  const back = { x: -e.dir.x, y: -e.dir.y };
  let opts = DIR_ORDER.filter(d => isOpen(tx + d.x, ty + d.y) && (isZero(e.dir) || !same(d, back)));
  if (!opts.length) opts = DIR_ORDER.filter(d => isOpen(tx + d.x, ty + d.y));
  if (!opts.length) { e.dir = NONE; return; }
  if (e.fright && e.state === 'active') { e.dir = randItem(opts); return; }
  const t = enemyTarget(e);
  let best = opts[0], bestD = Infinity;
  for (const d of opts) {
    const dd = (tx + d.x - t.x) ** 2 + (ty + d.y - t.y) ** 2;
    if (dd < bestD) { bestD = dd; best = d; }
  }
  e.dir = best;
}

// Straight-line waypoint movement used inside / around the den.
function followPath(e, dist) {
  while (dist > 1e-9 && e.path.length) {
    const t = e.path[0];
    const dx = t.x - e.x, dy = t.y - e.y;
    if (Math.abs(dx) > 1e-9) {
      const m = Math.min(dist, Math.abs(dx));
      e.dir = dx > 0 ? RIGHT : LEFT;
      e.x += Math.sign(dx) * m; dist -= m;
    } else if (Math.abs(dy) > 1e-9) {
      const m = Math.min(dist, Math.abs(dy));
      e.dir = dy > 0 ? DOWN : UP;
      e.y += Math.sign(dy) * m; dist -= m;
    } else {
      e.x = t.x; e.y = t.y;
      e.path.shift();
    }
  }
  if (!e.path.length) { e.x = Math.round(e.x); e.y = Math.round(e.y); }
  return e.path.length === 0;
}

/* --------------------------------------------------------------- update */
function addScore(n) {
  S.score += n;
  if (!S.extraLifeGiven && S.score >= EXTRA_LIFE_AT) {
    S.extraLifeGiven = true;
    S.lives++;
    Sound.life();
  }
  if (S.score > S.hi) { S.hi = S.score; saveHi(S.hi); }
  updateHud();
}

function reverseActiveEnemies() {
  for (const e of S.enemies) if (e.state === 'active') e.dir = { x: -e.dir.x, y: -e.dir.y };
}

function update(dt) {
  S.time += dt;
  for (const p of S.popups) p.t -= dt;
  S.popups = S.popups.filter(p => p.t > 0);

  switch (S.mode) {
    case 'ready':
      S.stateT -= dt;
      if (S.stateT <= 0) setMode('playing');
      break;
    case 'playing':
      updatePlaying(dt);
      break;
    case 'eatpause':
      S.stateT -= dt;
      if (S.stateT <= 0) setMode('playing');
      break;
    case 'dying':
      S.stateT -= dt;
      if (S.stateT <= 0) {
        S.lives--;
        updateHud();
        if (S.lives <= 0) {
          setMode('gameover');
        } else {
          resetActors();
          setMode('ready', 1.6);
        }
      }
      break;
    case 'clear':
      S.stateT -= dt;
      if (S.stateT <= 0) {
        S.level++;
        resetPellets();
        resetActors();
        updateHud();
        setMode('ready', 1.8);
      }
      break;
  }
}

function updatePlaying(dt) {
  S.levelTime += dt;

  // Phase / fright timers
  if (S.frightT > 0) {
    S.frightT -= dt;
    if (S.frightT <= 0) for (const e of S.enemies) e.fright = false;
  } else {
    S.phaseT -= dt;
    if (S.phaseT <= 0 && S.phaseIdx < PHASES.length - 1) {
      S.phaseIdx++;
      S.phaseT = PHASES[S.phaseIdx];
      reverseActiveEnemies();
    }
  }

  // Player
  const p = S.player;
  if (!isZero(p.dir) && same(S.desired, { x: -p.dir.x, y: -p.dir.y })) {
    p.dir = S.desired;
    p.facing = p.dir;
  }
  stepActor(p, playerSpeed() * dt, choosePlayer);
  if (!isZero(p.dir)) p.anim += dt;

  // Eat pellets
  const pc = wrapCol(Math.round(p.x)), pr = Math.round(p.y);
  const pel = S.pellets[pr] && S.pellets[pr][pc];
  if (pel) {
    S.pellets[pr][pc] = 0;
    S.pelletsLeft--;
    S.pelletsEaten++;
    if (pel === 2) {
      addScore(50);
      S.frightT = frightDuration();
      S.combo = 0;
      for (const e of S.enemies) if (e.state !== 'eaten' && e.state !== 'entering') e.fright = true;
      reverseActiveEnemies();
      Sound.power();
    } else {
      addScore(10);
      Sound.pellet();
    }
    if (S.pelletsEaten === 90 || S.pelletsEaten === 220) {
      const i = Math.min(S.level - 1, BONUS_VALUES.length - 1);
      S.bonus = { ...BONUS_TILE, t: 9, value: BONUS_VALUES[i], color: BONUS_COLORS[i] };
    }
    if (S.pelletsLeft === 0) {
      Sound.clear();
      setMode('clear', 2.4);
      return;
    }
  }

  // Bonus gem
  if (S.bonus) {
    S.bonus.t -= dt;
    if (S.bonus.t <= 0) S.bonus = null;
    else if (Math.abs(p.x - S.bonus.x) < 0.6 && Math.abs(p.y - S.bonus.y) < 0.6) {
      addScore(S.bonus.value);
      S.popups.push({ x: S.bonus.x, y: S.bonus.y, text: S.bonus.value, t: 1.2, color: S.bonus.color });
      S.bonus = null;
      Sound.bonus();
    }
  }

  // Enemies
  for (const e of S.enemies) {
    e.spin += dt * (e.fright ? 4 : 1.5);
    const dist = enemySpeed(e) * dt;
    switch (e.state) {
      case 'den':
        if (S.levelTime >= e.release) {
          e.state = 'leaving';
          e.path = [{ x: DEN.x, y: DEN.y }, { x: DOOR.x, y: DOOR.y }];
        }
        break;
      case 'leaving':
        if (followPath(e, dist)) { e.state = 'active'; e.dir = randItem([LEFT, RIGHT]); }
        break;
      case 'entering':
        if (followPath(e, dist)) {
          e.state = 'leaving';
          e.fright = false;
          e.path = [{ x: DOOR.x, y: DOOR.y }];
        }
        break;
      case 'active':
      case 'eaten':
        stepActor(e, dist, chooseEnemy);
        break;
    }
  }

  // Collisions
  for (const e of S.enemies) {
    if (e.state !== 'active') continue;
    let dx = Math.abs(e.x - p.x);
    dx = Math.min(dx, COLS - dx); // tunnel wrap
    if (dx < 0.6 && Math.abs(e.y - p.y) < 0.6) {
      if (e.fright) {
        const pts = 200 * 2 ** S.combo;
        S.combo = Math.min(S.combo + 1, 3);
        e.fright = false;
        e.state = 'eaten';
        addScore(pts);
        S.popups.push({ x: e.x, y: e.y, text: pts, t: 1, color: '#00ffff' });
        Sound.eatEnemy();
        setMode('eatpause', 0.45);
        return;
      }
      Sound.die();
      setMode('dying', 1.6);
      return;
    }
  }
}

/* ------------------------------------------------------------ rendering */
// Everything is drawn at native 8-bit resolution (8px tiles, 168×168 board)
// and scaled up by the browser with nearest-neighbour filtering.
const TILE = 8;
const W = COLS * TILE, H = ROWS * TILE;
const SPR = 14; // sprite size in pixels (overlaps the corridor like old arcade sprites)
canvas.width = W;
canvas.height = H;
ctx.imageSmoothingEnabled = false;

const PAL = {
  bg: '#000000',
  wall: '#2b4cff',
  wallFill: '#0a0a32',
  wallFlash: '#ffffff',
  wallFlashFill: '#3a3a8a',
  pellet: '#ffb8ae',
  orb: '#ffb8ae',
  gate: '#ffb8ff',
  scared: '#2121de',
  scaredFlash: '#f4f4f4',
};

function resize() {
  const hud = document.getElementById('hud').offsetHeight;
  const dpad = document.getElementById('dpad');
  const dpadH = getComputedStyle(dpad).display === 'none' ? 0 : dpad.offsetHeight + 10;
  const availW = window.innerWidth - 32;
  const availH = window.innerHeight - hud - dpadH - 40;
  let scale = Math.min(availW / W, availH / H);
  // Whole-number scaling keeps every pixel the same size.
  scale = scale >= 2 ? Math.floor(scale) : Math.max(1, scale);
  canvas.style.width = W * scale + 'px';
  canvas.style.height = H * scale + 'px';
  document.documentElement.style.setProperty('--tile', TILE * scale + 'px');
}

/* --- sprite helpers --- */
function makeSprite(rows, palette) {
  const c = document.createElement('canvas');
  c.width = rows[0].length;
  c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (palette[ch]) { g.fillStyle = palette[ch]; g.fillRect(x, y, 1, 1); }
  }));
  return c;
}
const px = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };

const PLAYER_ROWS = [
  '.......ll.....',
  '......lll.....',
  '....KKKKKK....',
  '..KKLLGGGGKK..',
  '.KLLGGGGGGGGK.',
  '.KLGGGGGGGGGK.',
  'KGGGGGGGGGGGGK',
  'KGGGGGGGGGGGGK',
  'KGGGGGGGGGGGGK',
  'KGGGGGGGGGGGDK',
  '.KGGGGGGGGGDK.',
  '.KDGGGGGGGDDK.',
  '..KKDDDDDDKK..',
  '....KKKKKK....',
];
const playerSprite = makeSprite(PLAYER_ROWS, {
  K: '#0f4a22', G: '#5ee05a', L: '#c6ffa8', D: '#2f9a3a', l: '#7bdc3c',
});

const ENEMY_FRAMES = [
  [
    'B.....BB.....B',
    '.BB..BBBB..BB.',
    '.BBBBBBBBBBBB.',
    '..BHHBBBBBBB..',
    '.BHBBBBBBBBBB.',
    'BBBBBBBBBBBBBB',
    '.BBBBBBBBBBBB.',
    '.BBBBBBBBBBBB.',
    'BBBBBBBBBBBBBB',
    '.BBBBBBBBBBBB.',
    '..BBBBBBBBBB..',
    '.BBBBBBBBBBBB.',
    '.BB..BBBB..BB.',
    'B.....BB.....B',
  ],
  [
    '...B..BB..B...',
    '....BBBBBB....',
    '..BBBBBBBBBB..',
    '.BBHHBBBBBBBB.',
    'BBHBBBBBBBBBBB',
    '..BBBBBBBBBB..',
    '.BBBBBBBBBBBB.',
    '.BBBBBBBBBBBB.',
    '..BBBBBBBBBB..',
    'BBBBBBBBBBBBBB',
    '.BBBBBBBBBBBB.',
    '..BBBBBBBBBB..',
    '....BBBBBB....',
    '...B..BB..B...',
  ],
];
function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = s => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * amt);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
const enemySpriteCache = new Map();
function enemySprite(color, frame) {
  const key = color + frame;
  if (!enemySpriteCache.has(key)) {
    enemySpriteCache.set(key, makeSprite(ENEMY_FRAMES[frame], { B: color, H: lighten(color, 0.55) }));
  }
  return enemySpriteCache.get(key);
}

const GEM_ROWS = [
  '....W....',
  '...WCC...',
  '..WCCCC..',
  '.WCCCCCD.',
  'WCCCCCCDD',
  '.CCCCCDD.',
  '..CCCDD..',
  '...CDD...',
  '....D....',
];
const gemCache = new Map();
function gemSprite(color) {
  if (!gemCache.has(color)) {
    const dark = color.replace(/^#/, '');
    const n = parseInt(dark, 16);
    const d = `rgb(${((n >> 16) & 255) * 0.55 | 0},${((n >> 8) & 255) * 0.55 | 0},${(n & 255) * 0.55 | 0})`;
    gemCache.set(color, makeSprite(GEM_ROWS, { W: '#ffffff', C: color, D: d }));
  }
  return gemCache.get(color);
}

const ORB_ROWS = ['.XXXX.', 'XXXXXX', 'XXXXXX', 'XXXXXX', 'XXXXXX', '.XXXX.'];
const orbSprite = makeSprite(ORB_ROWS, { X: PAL.orb });

const DIGITS = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111'],
};
function drawNumber(str, cx, cy, color) {
  str = String(str);
  const w = str.length * 4 - 1;
  let x = Math.round(cx - w / 2);
  const y = Math.round(cy - 2);
  ctx.fillStyle = color;
  for (const ch of str) {
    DIGITS[ch].forEach((row, j) => [...row].forEach((b, i) => { if (b === '1') ctx.fillRect(x + i, y + j, 1, 1); }));
    x += 4;
  }
}

/* --- maze --- */
function buildWalls(edge, fill) {
  const mask = new Uint8Array(W * H);
  const box = (x, y, w, h) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (i >= 0 && j >= 0 && i < W && j < H) mask[j * W + i] = 1;
    }
  };
  const I = 2; // inset from corridor
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isWall(c, r)) continue;
      const x = c * TILE, y = r * TILE;
      box(x + I, y + I, TILE - 2 * I, TILE - 2 * I);
      if (isWall(c + 1, r)) box(x + TILE / 2, y + I, TILE, TILE - 2 * I);
      if (isWall(c, r + 1)) box(x + I, y + TILE / 2, TILE - 2 * I, TILE);
      if (isWall(c + 1, r) && isWall(c, r + 1) && isWall(c + 1, r + 1)) box(x + TILE / 2, y + TILE / 2, TILE, TILE);
    }
  }
  const m = (i, j) => i >= 0 && j >= 0 && i < W && j < H && mask[j * W + i] === 1;
  // Knock off convex corner pixels for a rounded 8-bit look
  const clear = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!m(i, j)) continue;
    const u = m(i, j - 1), d = m(i, j + 1), l = m(i - 1, j), r = m(i + 1, j);
    if ((!u && !l) || (!u && !r) || (!d && !l) || (!d && !r)) clear.push(j * W + i);
  }
  for (const k of clear) mask[k] = 0;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!m(i, j)) continue;
    const isEdge = !m(i, j - 1) || !m(i, j + 1) || !m(i - 1, j) || !m(i + 1, j);
    g.fillStyle = isEdge ? edge : fill;
    g.fillRect(i, j, 1, 1);
  }
  // Den gate
  g.fillStyle = PAL.gate;
  g.fillRect(DOOR.x * TILE, (DOOR.y + 1) * TILE + 3, TILE, 2);
  return c;
}
const wallLayer = buildWalls(PAL.wall, PAL.wallFill);
const wallLayerFlash = buildWalls(PAL.wallFlash, PAL.wallFlashFill);

/* --- drawing --- */
const spritePos = a => [Math.round((a.x + 0.5) * TILE - SPR / 2), Math.round((a.y + 0.5) * TILE - SPR / 2)];

function drawPellets() {
  const orbOn = S.mode !== 'playing' || Math.floor(S.time * 5) % 2 === 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = S.pellets[r][c];
      if (v === 1) px(c * TILE + 3, r * TILE + 3, 2, 2, PAL.pellet);
      else if (v === 2 && orbOn) ctx.drawImage(orbSprite, c * TILE + 1, r * TILE + 1);
    }
  }
}

function drawPlayerFace(x, y, f, mouthOpen) {
  const ex = f.x, ey = f.y;
  for (const ox of [4, 8]) {
    px(x + ox + ex, y + 5 + ey, 2, 3, '#0d1a2b');
    px(x + ox + ex, y + 5 + ey, 1, 1, '#ffffff');
  }
  const mx = x + 5 + ex, my = y + 9 + Math.min(0, ey);
  if (mouthOpen) {
    px(mx, my, 4, 3, '#3a0d1a');
    px(mx + 1, my + 2, 2, 1, '#ff5a7a');
  } else {
    px(mx, my + 1, 4, 1, '#3a0d1a');
  }
}

function drawPlayer() {
  const p = S.player;
  const [x, y] = spritePos(p);
  if (S.mode === 'dying') {
    const k = 1 - Math.max(0, S.stateT) / 1.6; // 0 → 1
    if (k > 0.75) {
      // Pixel burst
      const dist = Math.round(((k - 0.75) / 0.25) * 9);
      const cx = x + SPR / 2 - 1, cy = y + SPR / 2 - 1;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        px(Math.round(cx + Math.cos(a) * dist), Math.round(cy + Math.sin(a) * dist), 2, 2, i % 2 ? '#c6ffa8' : '#5ee05a');
      }
      return;
    }
    if (k > 0.15) {
      // Melt away from the top, row by row
      const cut = Math.floor(((k - 0.15) / 0.6) * SPR);
      ctx.drawImage(playerSprite, 0, cut, SPR, SPR - cut, x, y + cut, SPR, SPR - cut);
      return;
    }
  }
  ctx.drawImage(playerSprite, x, y);
  const mouthOpen = !isZero(p.dir) && Math.floor(p.anim * 12) % 2 === 0;
  drawPlayerFace(x, y, p.facing, mouthOpen);
}

function drawEnemy(e) {
  if (S.mode === 'dying' && S.stateT < 1.2) return;
  let [x, y] = spritePos(e);
  if (e.state === 'den') y += Math.round(Math.sin(S.time * 6 + e.spin) * 1.5);
  const frame = Math.floor(S.time * 6 + e.spin) % 2;
  const eyesOnly = e.state === 'eaten' || e.state === 'entering';

  if (!eyesOnly) {
    if (e.fright) {
      const flashing = S.frightT < 2 && Math.floor(S.frightT * 6) % 2 === 0;
      const face = flashing ? '#ff2a2a' : '#ffb8ae';
      ctx.drawImage(enemySprite(flashing ? PAL.scaredFlash : PAL.scared, frame), x, y);
      px(x + 4, y + 5, 2, 2, face);
      px(x + 8, y + 5, 2, 2, face);
      for (let i = 0; i < 8; i++) px(x + 3 + i, y + 9 + (i % 2), 1, 1, face); // wobbly mouth
      return;
    }
    ctx.drawImage(enemySprite(e.color, frame), x, y);
  }
  const d = e.dir;
  const ox = d.x > 0 ? 1 : 0;
  const oy = d.y < 0 ? 0 : d.y > 0 ? 2 : 1;
  for (const ex of [3, 8]) {
    px(x + ex, y + 4, 3, 4, '#ffffff');
    px(x + ex + ox, y + 4 + oy, 2, 2, '#1a1aa8');
  }
}

function drawBonus() {
  const b = S.bonus;
  if (!b || (b.t < 2 && Math.floor(b.t * 8) % 2 === 0)) return;
  const bob = Math.floor(S.time * 3) % 2;
  ctx.drawImage(gemSprite(b.color), Math.round((b.x + 0.5) * TILE - 4), Math.round((b.y + 0.5) * TILE - 4) - bob);
}

function drawPopups() {
  for (const p of S.popups) {
    drawNumber(p.text, (p.x + 0.5) * TILE, (p.y + 0.5) * TILE - Math.round((1 - p.t) * 4), p.color);
  }
}

function render() {
  px(0, 0, W, H, PAL.bg);
  const flash = S.mode === 'clear' && Math.floor(S.stateT * 5) % 2 === 0;
  ctx.drawImage(flash ? wallLayerFlash : wallLayer, 0, 0);
  if (S.mode === 'title') return;

  drawPellets();
  drawBonus();
  if (S.mode !== 'clear') for (const e of S.enemies) drawEnemy(e);
  if (S.mode !== 'eatpause') drawPlayer();
  drawPopups();
}

// Pixel life icon for the HUD
(() => {
  const c = document.createElement('canvas');
  c.width = SPR; c.height = SPR;
  const g = c.getContext('2d');
  const dot = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  g.drawImage(playerSprite, 0, 0);
  dot(4, 5, 2, 3, '#0d1a2b'); dot(8, 5, 2, 3, '#0d1a2b');
  dot(4, 5, 1, 1, '#ffffff'); dot(8, 5, 1, 1, '#ffffff');
  dot(5, 10, 4, 1, '#3a0d1a');
  document.documentElement.style.setProperty('--life-icon', `url(${c.toDataURL()})`);
})();

/* ------------------------------------------------------------------ HUD */
function updateHud() {
  el.score.textContent = S.score;
  el.hi.textContent = S.hi;
  el.level.textContent = S.level;
  const n = Math.max(0, S.lives - (S.mode === 'title' ? 0 : 1));
  el.lives.innerHTML = '<i></i>'.repeat(Math.min(n, 6));
}

function renderOverlay() {
  const o = el.overlay;
  o.classList.remove('hidden', 'ghost');
  el.help.style.display = 'none';
  switch (S.mode) {
    case 'title':
      el.title.textContent = 'MUNCH MAZE';
      el.sub.innerHTML = 'PUSH <kbd>ENTER</kbd> OR TAP';
      el.help.style.display = '';
      break;
    case 'ready':
      o.classList.add('ghost');
      el.title.textContent = S.level > 1 && S.levelTime === 0 && S.pelletsEaten === 0 ? `LEVEL ${S.level}` : 'READY!';
      el.sub.textContent = '';
      break;
    case 'paused':
      el.title.textContent = 'PAUSED';
      el.sub.innerHTML = 'PUSH <kbd>P</kbd> OR TAP';
      break;
    case 'gameover':
      el.title.textContent = 'GAME OVER';
      el.sub.innerHTML = `SCORE ${S.score}<br>PUSH <kbd>ENTER</kbd> TO RETRY`;
      break;
    default:
      o.classList.add('hidden');
  }
  updateHud();
}

/* --------------------------------------------------------------- input */
function startOrResume() {
  Sound.unlock();
  if (S.mode === 'title' || S.mode === 'gameover') newGame();
  else if (S.mode === 'paused') togglePause();
}

function togglePause() {
  if (S.mode === 'paused') {
    S.mode = S.prevMode;
    renderOverlay();
  } else if (['playing', 'ready', 'eatpause'].includes(S.mode)) {
    S.prevMode = S.mode;
    setMode('paused');
  }
}

function setDesired(d) {
  Sound.unlock();
  S.desired = d;
  if (S.mode === 'title' || S.mode === 'gameover') newGame();
}

const KEYMAP = {
  ArrowUp: UP, KeyW: UP, ArrowDown: DOWN, KeyS: DOWN,
  ArrowLeft: LEFT, KeyA: LEFT, ArrowRight: RIGHT, KeyD: RIGHT,
};

window.addEventListener('keydown', ev => {
  if (KEYMAP[ev.code]) {
    ev.preventDefault();
    if (S.mode === 'title' || S.mode === 'gameover' || S.mode === 'paused') return;
    setDesired(KEYMAP[ev.code]);
  } else if (ev.code === 'Enter' || ev.code === 'Space') {
    ev.preventDefault();
    startOrResume();
  } else if (ev.code === 'KeyP' || ev.code === 'Escape') {
    togglePause();
  } else if (ev.code === 'KeyM') {
    Sound.muted = !Sound.muted;
  }
});

el.overlay.addEventListener('pointerdown', startOrResume);

// Swipe controls on the board
let touchStart = null;
canvas.addEventListener('pointerdown', ev => { touchStart = { x: ev.clientX, y: ev.clientY }; Sound.unlock(); });
canvas.addEventListener('pointermove', ev => {
  if (!touchStart) return;
  const dx = ev.clientX - touchStart.x, dy = ev.clientY - touchStart.y;
  if (Math.hypot(dx, dy) < 20) return;
  setDesired(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : (dy > 0 ? DOWN : UP));
  touchStart = { x: ev.clientX, y: ev.clientY };
});
window.addEventListener('pointerup', () => { touchStart = null; });

document.querySelectorAll('#dpad button').forEach(btn => {
  btn.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    setDesired(DIR_BY_NAME[btn.dataset.dir]);
  });
});

// Auto-pause when the tab is hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.mode !== 'paused') togglePause();
});

/* ---------------------------------------------------------------- loop */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // Sub-step for stable collisions at high speeds
  const steps = Math.ceil(dt / (1 / 120));
  for (let i = 0; i < steps; i++) update(dt / steps);
  render();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resetPellets();
resetActors();
resize();
renderOverlay();
requestAnimationFrame(frame);

// Exposed for automated testing / debugging
window.__munch = S;
