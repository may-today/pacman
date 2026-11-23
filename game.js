'use strict';

/* =========================================================================
 * Munch Maze — an original maze-chase mini game.
 * Legend:  #  wall    .  pellet    o  power orb    -  gate
 *          G  den (enemy home)     P  player start    (space) empty floor
 * ========================================================================= */
const MAP = [
  '#####################',
  '#.........#.........#',
  '#o###.###.#.###.###o#',
  '#...................#',
  '#.###.#.#####.#.###.#',
  '#.....#...#...#.....#',
  '#####.###.#.###.#####',
  '#####.#.......#.#####',
  '#####.#.##-##.#.#####',
  '     ...#GGG#...     ',
  '#####.#.#####.#.#####',
  '#####.#.......#.#####',
  '#####.#.#####.#.#####',
  '#...................#',
  '#o##.###.###.###.##o#',
  '#..#......P......#..#',
  '##.#.#.#######.#.#.##',
  '#....#....#....#....#',
  '#.#######.#.#######.#',
  '#...................#',
  '#####################',
];
const COLS = MAP[0].length;
const ROWS = MAP.length;

const UP = { x: 0, y: -1 }, DOWN = { x: 0, y: 1 }, LEFT = { x: -1, y: 0 }, RIGHT = { x: 1, y: 0 };
const NONE = { x: 0, y: 0 };
const DIR_ORDER = [UP, LEFT, DOWN, RIGHT]; // tie-break order for enemy pathing
const DIR_BY_NAME = { up: UP, down: DOWN, left: LEFT, right: RIGHT };

const DOOR = { x: 10, y: 7 };   // tile just outside the den gate
const DEN = { x: 10, y: 9 };    // centre of the den
const BONUS_TILE = { x: 10, y: 11 };
const PLAYER_START = { x: 10, y: 15 };

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
  pellet() { this.toggle ^= 1; this.tone(this.toggle ? 620 : 480, 0.06, { type: 'triangle', vol: 0.05 }); },
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
  const inTunnel = Math.round(e.y) === 9 && (e.x < 5 || e.x > COLS - 6);
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
    if (S.pelletsEaten === 60 || S.pelletsEaten === 140) {
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
        S.popups.push({ x: e.x, y: e.y, text: pts, t: 1, color: '#7df9ff' });
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
let T = 24;            // tile size in CSS px
let wallLayer = null;  // pre-rendered maze
let wallLayerFlash = null;

function resize() {
  const hud = document.getElementById('hud').offsetHeight;
  const dpad = document.getElementById('dpad');
  const dpadH = getComputedStyle(dpad).display === 'none' ? 0 : dpad.offsetHeight + 10;
  const availW = window.innerWidth - 32;
  const availH = window.innerHeight - hud - dpadH - 40;
  T = Math.max(10, Math.floor(Math.min(availW / COLS, availH / ROWS)));
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = COLS * T + 'px';
  canvas.style.height = ROWS * T + 'px';
  canvas.width = Math.round(COLS * T * dpr);
  canvas.height = Math.round(ROWS * T * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  wallLayer = buildWalls('#4f7cff', '#0b1236', dpr);
  wallLayerFlash = buildWalls('#ffffff', '#2a3570', dpr);
}

function buildWalls(edge, fill, dpr) {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const shape = (inset, color, radius) => {
    g.fillStyle = color;
    g.beginPath();
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++) {
        if (!isWall(col, r)) continue;
        const x = col * T, y = r * T;
        if (g.roundRect) g.roundRect(x + inset, y + inset, T - 2 * inset, T - 2 * inset, radius);
        else g.rect(x + inset, y + inset, T - 2 * inset, T - 2 * inset);
        if (isWall(col + 1, r)) g.rect(x + T / 2, y + inset, T, T - 2 * inset);
        if (isWall(col, r + 1)) g.rect(x + inset, y + T / 2, T - 2 * inset, T);
        if (isWall(col + 1, r) && isWall(col, r + 1) && isWall(col + 1, r + 1)) g.rect(x + T / 2, y + T / 2, T, T);
      }
    }
    g.fill();
  };

  const inset = T * 0.2;
  const lw = Math.max(1.5, T * 0.09);
  g.shadowColor = edge;
  g.shadowBlur = T * 0.45;
  shape(inset, edge, T * 0.3);
  g.shadowBlur = 0;
  shape(inset + lw, fill, T * 0.22);

  // Den gate
  g.fillStyle = '#ff9ad5';
  g.fillRect(DOOR.x * T + T * 0.05, (DOOR.y + 1) * T + T * 0.42, T * 0.9, T * 0.16);
  return c;
}

function drawPellets() {
  const pulse = 0.75 + 0.25 * Math.sin(S.time * 8);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = S.pellets[r][c];
      if (!v) continue;
      const cx = (c + 0.5) * T, cy = (r + 0.5) * T;
      ctx.beginPath();
      if (v === 1) {
        ctx.fillStyle = '#ffdcb0';
        ctx.arc(cx, cy, T * 0.1, 0, Math.PI * 2);
      } else {
        ctx.fillStyle = '#ffb36b';
        ctx.shadowColor = '#ffb36b';
        ctx.shadowBlur = T * 0.6;
        ctx.arc(cx, cy, T * 0.28 * pulse, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

function drawPlayer() {
  const p = S.player;
  let scale = 1, rot = 0, alpha = 1;
  if (S.mode === 'dying') {
    const k = 1 - Math.max(0, S.stateT) / 1.6; // 0 → 1
    scale = Math.max(0, 1 - k * 1.1);
    rot = k * Math.PI * 4;
    alpha = Math.max(0, 1 - k);
  }
  const R = T * 0.44 * scale;
  if (R <= 0.5) return;
  const cx = (p.x + 0.5) * T, cy = (p.y + 0.5) * T;
  const f = p.facing;
  const chomp = Math.abs(Math.sin(p.anim * 14));
  const squash = 1 + 0.06 * chomp;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(squash, 2 - squash);

  // Leaf sprout
  ctx.fillStyle = '#3fbf5a';
  ctx.beginPath();
  ctx.ellipse(R * 0.25, -R * 1.02, R * 0.32, R * 0.14, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Body
  const grad = ctx.createRadialGradient(-R * 0.35, -R * 0.35, R * 0.1, 0, 0, R);
  grad.addColorStop(0, '#e2ffd8');
  grad.addColorStop(0.55, '#72e886');
  grad.addColorStop(1, '#2c9a49');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();

  // Face shifted toward travel direction
  const fx = f.x * R * 0.28, fy = f.y * R * 0.22;
  ctx.fillStyle = '#0d1a2b';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(fx + side * R * 0.3, fy - R * 0.22, R * 0.11, R * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(fx + side * R * 0.3 + R * 0.03, fy - R * 0.28, R * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
  // Chomping mouth
  ctx.fillStyle = '#4a1022';
  ctx.beginPath();
  ctx.ellipse(fx, fy + R * 0.3, R * 0.3, R * (0.05 + 0.2 * chomp), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnemy(e) {
  if (S.mode === 'dying' && S.stateT < 1.2) return;
  let cx = (e.x + 0.5) * T, cy = (e.y + 0.5) * T;
  if (e.state === 'den') cy += Math.sin(S.time * 6 + e.spin) * T * 0.15;
  const R = T * 0.44;
  const look = e.dir;

  if (e.state !== 'eaten' && e.state !== 'entering') {
    let color = e.color;
    if (e.fright) {
      const flashing = S.frightT < 2 && Math.floor(S.frightT * 6) % 2 === 0;
      color = flashing ? '#f2f4ff' : '#3448ff';
    }
    // Spiky body
    const spikes = 9;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = T * 0.35;
    ctx.beginPath();
    for (let i = 0; i <= spikes * 2; i++) {
      const a = e.spin + (i / (spikes * 2)) * Math.PI * 2;
      const rr = i % 2 === 0 ? R : R * 0.76;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    if (e.fright) {
      // Scared face
      ctx.fillStyle = '#ffd1d1';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + s * R * 0.26, cy - R * 0.15, R * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#ffd1d1';
      ctx.lineWidth = Math.max(1, T * 0.06);
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) {
        const x = cx - R * 0.36 + (i * R * 0.72) / 4;
        const y = cy + R * 0.25 + (i % 2 ? -1 : 1) * R * 0.08;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return;
    }
  }

  // Eyes (also all that's left when eaten)
  for (const s of [-1, 1]) {
    const ex = cx + s * R * 0.3, ey = cy - R * 0.1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex, ey, R * 0.23, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#121a3a';
    ctx.beginPath();
    ctx.arc(ex + look.x * R * 0.1, ey + look.y * R * 0.1, R * 0.11, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBonus() {
  const b = S.bonus;
  if (!b || (b.t < 2 && Math.floor(b.t * 8) % 2 === 0)) return;
  const cx = (b.x + 0.5) * T, cy = (b.y + 0.5) * T + Math.sin(S.time * 4) * T * 0.06;
  const r = T * 0.36;
  ctx.fillStyle = b.color;
  ctx.shadowColor = b.color;
  ctx.shadowBlur = T * 0.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.8, cy - r * 0.2);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.8, cy - r * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.3, cy - r * 0.2);
  ctx.lineTo(cx - r * 0.3, cy - r * 0.2);
  ctx.closePath();
  ctx.fill();
}

function drawPopups() {
  ctx.font = `bold ${Math.round(T * 0.6)}px "Trebuchet MS", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of S.popups) {
    ctx.globalAlpha = Math.min(1, p.t * 2);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, (p.x + 0.5) * T, (p.y + 0.5) * T - (1 - p.t) * T * 0.6);
  }
  ctx.globalAlpha = 1;
}

function render() {
  ctx.fillStyle = '#050816';
  ctx.fillRect(0, 0, COLS * T, ROWS * T);
  const flash = S.mode === 'clear' && Math.floor(S.stateT * 5) % 2 === 0;
  ctx.drawImage(flash ? wallLayerFlash : wallLayer, 0, 0, COLS * T, ROWS * T);
  if (S.mode === 'title') return;

  drawPellets();
  drawBonus();
  if (S.mode !== 'clear') for (const e of S.enemies) drawEnemy(e);
  if (S.mode !== 'eatpause') drawPlayer();
  drawPopups();
}

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
      el.sub.innerHTML = 'Press <kbd>Enter</kbd> or tap to start';
      el.help.style.display = '';
      break;
    case 'ready':
      o.classList.add('ghost');
      el.title.textContent = S.level > 1 && S.levelTime === 0 && S.pelletsEaten === 0 ? `LEVEL ${S.level}` : 'READY!';
      el.sub.textContent = '';
      break;
    case 'paused':
      el.title.textContent = 'PAUSED';
      el.sub.innerHTML = 'Press <kbd>P</kbd> or tap to resume';
      break;
    case 'gameover':
      el.title.textContent = 'GAME OVER';
      el.sub.innerHTML = `Score ${S.score}<br>Press <kbd>Enter</kbd> or tap to play again`;
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
