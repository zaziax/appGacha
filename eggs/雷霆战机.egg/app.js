/* ================================================================
   雷霆战机 · 火力进化  —  完整游戏逻辑
   基于 Canvas 的竖版飞行射击游戏
   升级：排行榜 / 可叠加子弹类型（掉落获取）/ 音效
   ================================================================ */

// ---------- 常量 ----------
const CW = 480;
const CH = 700;
const PLAYER_W = 34;
const PLAYER_H = 38;
const BULLET_W = 5;
const BULLET_H = 16;
const PLAYER_SPEED = 380;
const BULLET_SPEED = 650;
const SHOOT_INTERVAL = 0.18;
const RAPID_SHOOT_INTERVAL = 0.10;
const INVINCIBLE_TIME = 1.8;
const MAX_LIVES = 5;
const INITIAL_LIVES = 3;
const MAX_PARTICLES = 200;
const POWERUP_DROP_CHANCE = 0.14;
const POWERUP_DURATION = 8;

// 敌人类型
const ENEMY_TYPES = {
  small:  { w: 22, h: 22, hp: 1, score: 10, speedRange: [120, 200], color: '#ff4466' },
  medium: { w: 30, h: 30, hp: 1, score: 15, speedRange: [80, 150],  color: '#cc66ff' },
  large:  { w: 40, h: 40, hp: 2, score: 25, speedRange: [60, 110],  color: '#ff8844' }
};
const ENEMY_TYPES_LIST = ['small', 'medium', 'large'];

// 子弹增强类型
const POWERUP_TYPES = {
  spread: { color: '#44ff88', icon: '↗', label: '散射', duration: POWERUP_DURATION },
  pierce: { color: '#ffdd44', icon: '→', label: '穿透', duration: POWERUP_DURATION },
  rapid:  { color: '#ff4488', icon: '⚡', label: '速射', duration: 6 },
  triple: { color: '#44aaff', icon: '≡', label: '三发', duration: POWERUP_DURATION }
};
const POWERUP_KEYS = Object.keys(POWERUP_TYPES);

// 状态枚举
const ST = { MENU: 0, PLAYING: 1, GAMEOVER: 2 };

// ---------- DOM 引用 ----------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const highScoreEl = document.getElementById('highScore');
const currentScoreEl = document.getElementById('currentScore');
const livesDisplayEl = document.getElementById('livesDisplay');
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const finalScoreEl = document.getElementById('finalScore');
const finalHighScoreEl = document.getElementById('finalHighScore');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const leaderboardBtn = document.getElementById('leaderboardBtn');
const leaderboardScreen = document.getElementById('leaderboardScreen');
const leaderboardList = document.getElementById('leaderboardList');
const closeLeaderboardBtn = document.getElementById('closeLeaderboardBtn');
const saveScoreBtn = document.getElementById('saveScoreBtn');
const playerNameInput = document.getElementById('playerNameInput');

// ---------- 音效系统 ----------
class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this._initialized = false;
  }

  init() {
    if (this._initialized) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._initialized = true;
    } catch (e) {
      console.warn('音效无法初始化', e);
      this.enabled = false;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  play(type) {
    if (!this.enabled || !this.ctx) return;
    this.resume();
    try {
      switch (type) {
        case 'shoot':     this._beep(880, 0.04, 'sine', 0.10); break;
        case 'shoot2':    this._beep(660, 0.05, 'square', 0.07); break;
        case 'hit':       this._noise(0.06, 0.08); break;
        case 'explosion': this._noise(0.18, 0.20); break;
        case 'powerup':   this._sweep(500, 1400, 0.18, 'sine', 0.18); break;
        case 'playerHit': this._sweep(600, 150, 0.35, 'sawtooth', 0.22); break;
        case 'gameOver':  this._sweep(400, 60, 0.6, 'sawtooth', 0.25); break;
      }
    } catch (e) { /* 音效失败不影响游戏 */ }
  }

  _beep(freq, dur, type, vol) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + dur);
  }

  _noise(dur, vol) {
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start();
  }

  _sweep(fStart, fEnd, dur, type, vol) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fStart, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(fEnd, 20), this.ctx.currentTime + dur);
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + dur);
  }
}

const sound = new SoundManager();

// ---------- 游戏状态 ----------
let state = ST.MENU;
let score = 0;
let highScore = 0;
let lives = INITIAL_LIVES;
let gameTime = 0;
let difficulty = 1;

let player = null;
let bullets = [];
let enemies = [];
let particles = [];
let powerupItems = [];
let stars = [];

let lastTime = 0;
let shootTimer = 0;
let enemySpawnTimer = 0;
let invincibleTimer = 0;
let isInvincible = false;

// 输入
const keys = {};
let mouseX = -1, mouseY = -1;
let useMouseControl = false;
let touchActive = false;

// ---------- 星空背景 ----------
function initStars() {
  stars = [];
  for (let i = 0; i < 80; i++) {
    stars.push({
      x: Math.random() * CW,
      y: Math.random() * CH,
      size: 0.5 + Math.random() * 2,
      speed: 20 + Math.random() * 60,
      brightness: 0.3 + Math.random() * 0.7
    });
  }
}

function updateStars(dt) {
  for (const s of stars) {
    s.y += s.speed * dt;
    if (s.y > CH) {
      s.y = -2;
      s.x = Math.random() * CW;
    }
  }
}

function drawStars() {
  for (const s of stars) {
    const alpha = s.brightness * (0.6 + 0.4 * Math.sin(gameTime * 2 + s.x));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#c0d0ff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------- 玩家 ----------
function createPlayer() {
  return {
    x: CW / 2, y: CH - 70,
    w: PLAYER_W, h: PLAYER_H,
    powerups: {}
  };
}

// 初始化玩家增强状态
function initPlayerPowerups() {
  if (!player) return;
  player.powerups = {};
  for (const key of POWERUP_KEYS) {
    player.powerups[key] = { active: false, timer: 0 };
  }
}

function drawPlayer(p) {
  const x = p.x, y = p.y, w = p.w, h = p.h;

  if (isInvincible && Math.floor(gameTime * 6) % 2 === 0) {
    ctx.globalAlpha = 0.4;
  }

  // 引擎光效 - 增强时更亮
  const engineSize = hasAnyPowerup() ? 26 : 18;
  const grad = ctx.createRadialGradient(x, y + h / 2 + 8, 2, x, y + h / 2 + 8, engineSize);
  const engineColor = hasPowerup('rapid') ? 'rgba(255, 80, 160, 0.8)' : 'rgba(80, 160, 255, 0.7)';
  grad.addColorStop(0, engineColor);
  grad.addColorStop(1, 'rgba(80, 160, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(x - engineSize, y + h / 2 - 4, engineSize * 2, engineSize + 10);

  // 飞船主体
  ctx.shadowColor = hasAnyPowerup() ? '#ffcc44' : '#4488ff';
  ctx.shadowBlur = hasAnyPowerup() ? 22 : 14;

  const body = new Path2D();
  body.moveTo(x, y - h / 2);
  body.lineTo(x - w / 2, y + h / 4);
  body.lineTo(x - w / 3, y + h / 2);
  body.lineTo(x, y + h / 2 - 4);
  body.lineTo(x + w / 3, y + h / 2);
  body.lineTo(x + w / 2, y + h / 4);
  body.closePath();

  const bodyGrad = ctx.createLinearGradient(x, y - h / 2, x, y + h / 2);
  if (hasAnyPowerup()) {
    bodyGrad.addColorStop(0, '#ffdd66');
    bodyGrad.addColorStop(0.5, '#ff9933');
    bodyGrad.addColorStop(1, '#cc6600');
  } else {
    bodyGrad.addColorStop(0, '#66bbff');
    bodyGrad.addColorStop(0.5, '#3388dd');
    bodyGrad.addColorStop(1, '#2255aa');
  }
  ctx.fillStyle = bodyGrad;
  ctx.fill(body);
  ctx.strokeStyle = hasAnyPowerup() ? '#ffee88' : '#88ddff';
  ctx.lineWidth = 1.5;
  ctx.stroke(body);

  // 驾驶舱
  ctx.shadowBlur = 0;
  const cockpit = new Path2D();
  cockpit.ellipse(x, y - h / 6, 5, 7, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(180, 230, 255, 0.6)';
  ctx.fill(cockpit);
  ctx.strokeStyle = 'rgba(200, 240, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.stroke(cockpit);

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function hasAnyPowerup() {
  if (!player || !player.powerups) return false;
  return POWERUP_KEYS.some(k => player.powerups[k] && player.powerups[k].active);
}

function hasPowerup(key) {
  return player && player.powerups && player.powerups[key] && player.powerups[key].active;
}

// ---------- 子弹 ----------
function fireBullet() {
  if (!player) return;

  const hasSpread = hasPowerup('spread');
  const hasTriple = hasPowerup('triple');
  const hasPierce = hasPowerup('pierce');

  // 基础发射角度和偏移
  const angles = hasSpread ? [-0.14, 0, 0.14] : [0];
  const offsets = hasTriple ? [-12, 0, 12] : [0];

  // 旧版双发（score >= 50 且没有 triple 增强时保留）
  const baseOffsets = (!hasTriple && score >= 50) ? [-7, 7] : offsets;

  let shotCount = 0;
  for (const angle of angles) {
    for (const offset of baseOffsets) {
      const bullet = {
        x: player.x + offset,
        y: player.y - player.h / 2 - 6,
        w: BULLET_W,
        h: BULLET_H,
        speed: BULLET_SPEED,
        angle: angle,
        vx: Math.sin(angle) * BULLET_SPEED,
        vy: -Math.cos(angle) * BULLET_SPEED,
        pierce: hasPierce,
        hitEnemies: hasPierce ? new Set() : null,
        active: true
      };
      bullets.push(bullet);
      shotCount++;
    }
  }

  // 音效
  if (shotCount > 3) {
    sound.play('shoot2');
  } else {
    sound.play('shoot');
  }
}

function updateBullets(dt) {
  for (const b of bullets) {
    if (b.angle && b.angle !== 0) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    } else {
      b.y -= b.speed * dt;
    }
    if (b.y + b.h < 0 || b.y > CH + 20 || b.x < -20 || b.x > CW + 20) {
      b.active = false;
    }
  }
  bullets = bullets.filter(b => b.active);
}

function drawBullets() {
  ctx.shadowColor = '#44ddff';
  ctx.shadowBlur = 10;
  for (const b of bullets) {
    const grad = ctx.createLinearGradient(b.x, b.y - b.h / 2, b.x, b.y + b.h / 2);
    const color1 = b.pierce ? '#ffdd44' : '#ffffff';
    const color2 = b.pierce ? '#ff8844' : '#44ddff';
    const color3 = b.pierce ? '#cc4400' : '#2288dd';
    grad.addColorStop(0, color1);
    grad.addColorStop(0.3, color2);
    grad.addColorStop(1, color3);
    ctx.fillStyle = grad;

    // 穿透子弹稍大
    const w = b.pierce ? b.w * 1.4 : b.w;
    const h = b.pierce ? b.h * 1.3 : b.h;
    ctx.fillRect(b.x - w / 2, b.y - h / 2, w, h);
  }
  ctx.shadowBlur = 0;
}

// ---------- 敌人 ----------
function spawnEnemy() {
  const typeName = ENEMY_TYPES_LIST[Math.floor(Math.random() * ENEMY_TYPES_LIST.length)];
  const type = ENEMY_TYPES[typeName];
  const w = type.w;
  const x = w / 2 + Math.random() * (CW - w);
  const speedMin = type.speedRange[0] * (0.8 + 0.4 * difficulty);
  const speedMax = type.speedRange[1] * (0.8 + 0.4 * difficulty);
  const speed = speedMin + Math.random() * (speedMax - speedMin);

  enemies.push({
    x, y: -type.h,
    w: type.w, h: type.h,
    hp: type.hp,
    maxHp: type.hp,
    speed: Math.min(speed, 320),
    score: type.score,
    color: type.color,
    type: typeName,
    active: true,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 1.0 + Math.random() * 2.0,
    wobbleAmount: typeName === 'small' ? 20 : typeName === 'medium' ? 12 : 6
  });
}

function updateEnemies(dt) {
  for (const e of enemies) {
    e.y += e.speed * dt;
    e.wobble += e.wobbleSpeed * dt;
    e.x += Math.sin(e.wobble) * e.wobbleAmount * dt;
    e.x = Math.max(e.w / 2, Math.min(CW - e.w / 2, e.x));
    if (e.y - e.h / 2 > CH) e.active = false;
  }
  enemies = enemies.filter(e => e.active);
}

function drawEnemies() {
  for (const e of enemies) {
    const x = e.x, y = e.y, w = e.w, h = e.h;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 10;

    const shape = new Path2D();
    shape.moveTo(x, y + h / 2);
    shape.lineTo(x - w / 2, y + h / 4);
    shape.lineTo(x - w / 3, y - h / 3);
    shape.lineTo(x, y - h / 2);
    shape.lineTo(x + w / 3, y - h / 3);
    shape.lineTo(x + w / 2, y + h / 4);
    shape.closePath();

    const grad = ctx.createLinearGradient(x, y - h / 2, x, y + h / 2);
    grad.addColorStop(0, lightenColor(e.color, 40));
    grad.addColorStop(0.5, e.color);
    grad.addColorStop(1, darkenColor(e.color, 30));
    ctx.fillStyle = grad;
    ctx.fill(shape);
    ctx.strokeStyle = lightenColor(e.color, 60);
    ctx.lineWidth = 1.5;
    ctx.stroke(shape);

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(x - w / 5, y - h / 6, 2.5, 0, Math.PI * 2);
    ctx.arc(x + w / 5, y - h / 6, 2.5, 0, Math.PI * 2);
    ctx.fill();

    if (e.maxHp > 1) {
      const hpW = w * 0.7;
      const hpH = 3;
      const hpX = x - hpW / 2;
      const hpY = y + h / 2 + 4;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(hpX, hpY, hpW, hpH);
      ctx.fillStyle = e.hp === 2 ? '#44ff88' : '#ff8844';
      ctx.fillRect(hpX, hpY, hpW * (e.hp / e.maxHp), hpH);
    }
  }
  ctx.shadowBlur = 0;
}

// ---------- 增强道具（掉落物） ----------
function spawnPowerupDrop(x, y) {
  const typeKey = POWERUP_KEYS[Math.floor(Math.random() * POWERUP_KEYS.length)];
  const info = POWERUP_TYPES[typeKey];
  powerupItems.push({
    x, y,
    w: 20, h: 20,
    type: typeKey,
    color: info.color,
    icon: info.icon,
    speed: 70 + Math.random() * 40,
    active: true,
    life: 6,           // 6 秒后消失
    wobblePhase: Math.random() * Math.PI * 2
  });
}

function updatePowerupItems(dt) {
  for (const item of powerupItems) {
    item.y += item.speed * dt;
    item.wobblePhase += dt * 3;
    item.x += Math.sin(item.wobblePhase) * 15 * dt;
    item.x = Math.max(item.w / 2, Math.min(CW - item.w / 2, item.x));
    item.life -= dt;
    if (item.y - item.h / 2 > CH || item.life <= 0) {
      item.active = false;
    }
  }
  powerupItems = powerupItems.filter(p => p.active);
}

function drawPowerupItems() {
  for (const item of powerupItems) {
    const x = item.x, y = item.y, w = item.w;
    const pulse = 0.8 + 0.2 * Math.sin(gameTime * 5 + item.wobblePhase);

    // 发光外圈
    ctx.shadowColor = item.color;
    ctx.shadowBlur = 18;

    // 菱形
    const shape = new Path2D();
    shape.moveTo(x, y - w / 2 * pulse);
    shape.lineTo(x + w / 2 * pulse, y);
    shape.lineTo(x, y + w / 2 * pulse);
    shape.lineTo(x - w / 2 * pulse, y);
    shape.closePath();

    ctx.fillStyle = item.color;
    ctx.globalAlpha = 0.9;
    ctx.fill(shape);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke(shape);

    // 图标文字
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.icon, x, y + 0.5);

    // 闪烁消失警告
    if (item.life < 2 && Math.floor(gameTime * 8) % 2 === 0) {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#ff4444';
      ctx.fill(shape);
      ctx.globalAlpha = 1;
    }
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function checkPowerupCollection() {
  if (!player) return;
  for (const item of powerupItems) {
    if (!item.active) continue;
    if (rectCollide(player, item)) {
      item.active = false;
      // 激活对应增强
      const pu = player.powerups[item.type];
      if (pu) {
        pu.active = true;
        pu.timer = POWERUP_TYPES[item.type].duration;
      }
      sound.play('powerup');
      // 拾取特效
      spawnExplosion(item.x, item.y, item.color, 10);
      egg.ui.toast('✨ 获得 ' + POWERUP_TYPES[item.type].label + ' (' + POWERUP_TYPES[item.type].duration + 's)');
    }
  }
  powerupItems = powerupItems.filter(p => p.active);
}

function updatePowerupTimers(dt) {
  if (!player || !player.powerups) return;
  for (const key of POWERUP_KEYS) {
    const pu = player.powerups[key];
    if (pu && pu.active) {
      pu.timer -= dt;
      if (pu.timer <= 0) {
        pu.active = false;
        pu.timer = 0;
      }
    }
  }
}

// ---------- 粒子系统 ----------
function spawnExplosion(x, y, color, count) {
  count = count || 12 + Math.floor(Math.random() * 8);
  for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 200;
    const size = 2 + Math.random() * 5;
    const colors = [color, lightenColor(color, 50), '#ffdd44', '#ffffff'];
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size,
      life: 0.4 + Math.random() * 0.8,
      maxLife: 0.4 + Math.random() * 0.8,
      color: colors[Math.floor(Math.random() * colors.length)],
      active: true
    });
  }
}

function updateParticles(dt) {
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.97;
    p.vy *= 0.97;
    p.life -= dt;
    if (p.life <= 0) p.active = false;
  }
  particles = particles.filter(p => p.active);
}

function drawParticles() {
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// ---------- 碰撞检测 ----------
function rectCollide(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 &&
         Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

function checkCollisions() {
  // 子弹 vs 敌人
  for (const b of bullets) {
    if (!b.active) continue;
    for (const e of enemies) {
      if (!e.active) continue;
      if (rectCollide(b, e)) {
        // 穿透子弹：不销毁，只记录已击中的敌人
        if (b.pierce) {
          if (b.hitEnemies && !b.hitEnemies.has(e)) {
            b.hitEnemies.add(e);
            e.hp--;
            if (e.hp <= 0) {
              e.active = false;
              score += e.score;
              updateScoreDisplay();
              spawnExplosion(e.x, e.y, e.color, 18);
              tryDropPowerup(e.x, e.y);
              sound.play('explosion');
            } else {
              spawnExplosion(e.x, e.y, '#ffaa44', 5);
              sound.play('hit');
            }
          }
        } else {
          // 普通子弹
          b.active = false;
          e.hp--;
          if (e.hp <= 0) {
            e.active = false;
            score += e.score;
            updateScoreDisplay();
            spawnExplosion(e.x, e.y, e.color, 18);
            tryDropPowerup(e.x, e.y);
            sound.play('explosion');
          } else {
            spawnExplosion(e.x, e.y, '#ffaa44', 5);
            sound.play('hit');
          }
        }
        break;
      }
    }
  }

  // 玩家 vs 敌人
  if (player && !isInvincible) {
    for (const e of enemies) {
      if (!e.active) continue;
      if (rectCollide(player, e)) {
        e.active = false;
        spawnExplosion(e.x, e.y, e.color, 15);
        playerHit();
        break;
      }
    }
  }
}

function tryDropPowerup(x, y) {
  if (Math.random() < POWERUP_DROP_CHANCE) {
    spawnPowerupDrop(x, y);
  }
}

function playerHit() {
  lives--;
  updateLivesDisplay();
  spawnExplosion(player.x, player.y, '#44aaff', 20);
  sound.play('playerHit');

  if (lives <= 0) {
    gameOver();
    return;
  }

  // 被撞后失去所有增强
  initPlayerPowerups();

  isInvincible = true;
  invincibleTimer = INVINCIBLE_TIME;
}

// ---------- 难度管理 ----------
function updateDifficulty() {
  difficulty = 1 + Math.floor(score / 100) * 0.2;
  if (difficulty > 4) difficulty = 4;
}

function getSpawnInterval() {
  return Math.max(0.3, 1.2 - (difficulty - 1) * 0.15);
}

// ---------- 游戏流程控制 ----------
function startGame() {
  sound.init();
  sound.resume();

  score = 0;
  lives = INITIAL_LIVES;
  gameTime = 0;
  difficulty = 1;
  bullets = [];
  enemies = [];
  particles = [];
  powerupItems = [];
  shootTimer = 0;
  enemySpawnTimer = 0;
  isInvincible = false;
  invincibleTimer = 0;
  useMouseControl = false;
  touchActive = false;
  mouseX = -1; mouseY = -1;

  player = createPlayer();
  initPlayerPowerups();
  state = ST.PLAYING;

  startScreen.style.display = 'none';
  gameOverScreen.style.display = 'none';
  leaderboardScreen.style.display = 'none';

  updateScoreDisplay();
  updateLivesDisplay();
}

function gameOver() {
  state = ST.GAMEOVER;
  sound.play('gameOver');

  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      if (player) spawnExplosion(
        player.x + (Math.random() - 0.5) * 40,
        player.y + (Math.random() - 0.5) * 40,
        '#ff6644', 15
      );
    }, i * 120);
  }

  saveHighScore(score);

  setTimeout(() => {
    finalScoreEl.textContent = score;
    finalHighScoreEl.textContent = highScore;
    playerNameInput.value = '';
    gameOverScreen.style.display = 'flex';
    setTimeout(() => playerNameInput.focus(), 100);
  }, 600);
}

// ---------- 更新循环 ----------
function update(dt) {
  gameTime += dt;

  updateStars(dt);
  updateDifficulty();

  if (state === ST.PLAYING) {
    updatePlayer(dt);
    updateBullets(dt);
    updateEnemies(dt);
    updatePowerupItems(dt);
    updatePowerupTimers(dt);
    updateParticles(dt);
    checkPowerupCollection();
    checkCollisions();

    // 自动射击
    shootTimer += dt;
    const shootInterval = hasPowerup('rapid') ? RAPID_SHOOT_INTERVAL : SHOOT_INTERVAL;
    if (shootTimer >= shootInterval) {
      shootTimer = 0;
      fireBullet();
    }

    // 敌人生成
    enemySpawnTimer += dt;
    const spawnInterval = getSpawnInterval();
    if (enemySpawnTimer >= spawnInterval) {
      enemySpawnTimer = 0;
      spawnEnemy();
      if (difficulty >= 2.5 && Math.random() < 0.3) {
        spawnEnemy();
      }
    }

    if (isInvincible) {
      invincibleTimer -= dt;
      if (invincibleTimer <= 0) {
        isInvincible = false;
      }
    }
  } else if (state === ST.GAMEOVER) {
    updateParticles(dt);
  }
}

function updatePlayer(dt) {
  if (!player) return;

  let dx = 0, dy = 0;
  if (keys['ArrowLeft'] || keys['KeyA']) dx = -1;
  if (keys['ArrowRight'] || keys['KeyD']) dx = 1;
  if (keys['ArrowUp'] || keys['KeyW']) dy = -1;
  if (keys['ArrowDown'] || keys['KeyS']) dy = 1;

  if (dx !== 0 || dy !== 0) {
    useMouseControl = false;
  }

  if (!useMouseControl && !touchActive) {
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
    }
    player.x += dx * PLAYER_SPEED * dt;
    player.y += dy * PLAYER_SPEED * dt;
  }

  if (useMouseControl && mouseX >= 0 && mouseY >= 0) {
    const targetX = mouseX;
    const targetY = Math.min(mouseY, CH - 50);
    const diffX = targetX - player.x;
    const diffY = targetY - player.y;
    const dist = Math.sqrt(diffX * diffX + diffY * diffY);
    if (dist > 3) {
      const speed = Math.min(PLAYER_SPEED * 1.3, dist / dt * 0.85);
      player.x += (diffX / dist) * speed * dt;
      player.y += (diffY / dist) * speed * dt;
    }
  }

  player.x = Math.max(player.w / 2, Math.min(CW - player.w / 2, player.x));
  player.y = Math.max(player.h / 2 + 20, Math.min(CH - player.h / 2, player.y));
}

// ---------- 渲染 ----------
function render() {
  ctx.clearRect(0, 0, CW, CH);

  const bgGrad = ctx.createLinearGradient(0, 0, 0, CH);
  bgGrad.addColorStop(0, '#060620');
  bgGrad.addColorStop(0.5, '#0a0a2e');
  bgGrad.addColorStop(1, '#040418');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CW, CH);

  drawStars();

  if (player && (state === ST.PLAYING || state === ST.GAMEOVER)) {
    drawPlayer(player);
  }

  drawPowerupItems();
  drawBullets();
  drawEnemies();
  drawParticles();

  // HUD：分数 & 增强状态
  if (state === ST.PLAYING) {
    // 分数
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('SCORE: ' + score, CW - 14, 28);

    // 增强状态条
    if (hasAnyPowerup()) {
      drawPowerupHUD();
    }
  }

  if (state === ST.PLAYING && lives <= 1 && Math.floor(gameTime * 4) % 2 === 0) {
    ctx.fillStyle = 'rgba(255, 50, 50, 0.25)';
    ctx.fillRect(0, 0, CW, CH);
  }
}

function drawPowerupHUD() {
  const startX = 14;
  const startY = 38;
  const gap = 4;
  let y = startY;

  ctx.textAlign = 'left';
  ctx.font = '11px system-ui, sans-serif';

  for (const key of POWERUP_KEYS) {
    const pu = player.powerups[key];
    if (pu && pu.active) {
      const info = POWERUP_TYPES[key];
      const pct = Math.max(0, pu.timer / info.duration);
      const barW = 80;
      const barH = 12;

      // 背景
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.roundRect ? ctx.roundRect(startX, y, barW, barH, 3) : 0;
      ctx.fillRect(startX, y, barW, barH);

      // 填充条
      ctx.fillStyle = info.color;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(startX + 1, y + 1, (barW - 2) * pct, barH - 2);
      ctx.globalAlpha = 1;

      // 标签
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(info.icon + ' ' + info.label + ' ' + Math.ceil(pu.timer) + 's', startX + barW / 2, y + barH - 3);

      y += barH + gap;
    }
  }
}

// ---------- 游戏循环 ----------
function gameLoop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  update(dt);
  render();

  requestAnimationFrame(gameLoop);
}

// ---------- UI 更新 ----------
function updateScoreDisplay() {
  currentScoreEl.textContent = score;
}

function updateLivesDisplay() {
  let s = '';
  for (let i = 0; i < lives; i++) s += '❤️';
  if (lives <= 0) s = '💀';
  livesDisplayEl.textContent = s || '💀';
}

function updateHighScoreDisplay() {
  highScoreEl.textContent = highScore;
}

// ---------- 数据持久化：最高分（storage） ----------
async function loadHighScore() {
  try {
    const val = await egg.storage.get('thunder_highScore');
    return (typeof val === 'number') ? val : 0;
  } catch (e) {
    console.warn('读取最高分失败', e);
    return 0;
  }
}

async function saveHighScore(scoreVal) {
  if (scoreVal > highScore) {
    highScore = scoreVal;
    updateHighScoreDisplay();
    try {
      await egg.storage.set('thunder_highScore', highScore);
    } catch (e) {
      console.warn('保存最高分失败', e);
    }
  }
}

// ---------- 数据持久化：排行榜（db） ----------
async function initDatabase() {
  try {
    // 建表
    await egg.db.exec(
      `CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_name TEXT NOT NULL,
        score INTEGER NOT NULL,
        played_at TEXT NOT NULL
      )`
    );
    // 尝试添加旧表可能缺失的列（忽略错误实现兼容）
    try {
      await egg.db.exec('ALTER TABLE scores ADD COLUMN version INTEGER DEFAULT 1');
    } catch (_) { /* 列已存在，忽略 */ }
  } catch (e) {
    console.warn('数据库初始化失败', e);
    egg.ui.toast('⚠️ 排行榜不可用');
  }
}

async function saveScoreToLeaderboard(playerName, scoreVal) {
  try {
    // 只保存最高分记录（每个玩家一条最佳成绩）
    const existing = await egg.db.query(
      'SELECT id, score FROM scores WHERE player_name = ? ORDER BY score DESC LIMIT 1',
      [playerName]
    );
    if (existing.length > 0 && existing[0].score >= scoreVal) {
      // 已有更高或相等的成绩，不更新
      return { isNew: false, rank: await getPlayerRank(scoreVal) };
    }
    if (existing.length > 0) {
      // 更新为更高分
      await egg.db.exec(
        'UPDATE scores SET score = ?, played_at = ? WHERE id = ?',
        [scoreVal, new Date().toISOString(), existing[0].id]
      );
    } else {
      // 插入新记录
      await egg.db.exec(
        'INSERT INTO scores (player_name, score, played_at) VALUES (?, ?, ?)',
        [playerName, scoreVal, new Date().toISOString()]
      );
    }
    return { isNew: true, rank: await getPlayerRank(scoreVal) };
  } catch (e) {
    console.warn('保存排行榜失败', e);
    egg.ui.toast('⚠️ 保存失败');
    return null;
  }
}

async function getPlayerRank(scoreVal) {
  try {
    const result = await egg.db.query(
      'SELECT COUNT(*) as cnt FROM scores WHERE score > ?',
      [scoreVal]
    );
    return (result.length > 0 ? result[0].cnt : 0) + 1;
  } catch (e) {
    return -1;
  }
}

async function loadLeaderboard() {
  try {
    const rows = await egg.db.query(
      'SELECT player_name, score, played_at FROM scores ORDER BY score DESC LIMIT 10'
    );
    return rows;
  } catch (e) {
    console.warn('读取排行榜失败', e);
    return [];
  }
}

async function showLeaderboard() {
  leaderboardScreen.style.display = 'flex';
  leaderboardList.innerHTML = '<p class="muted" style="text-align:center;">加载中...</p>';

  const rows = await loadLeaderboard();
  if (rows.length === 0) {
    leaderboardList.innerHTML = '<p class="muted" style="text-align:center;padding:20px 0;">暂无记录，快去战斗吧！</p>';
    return;
  }

  let html = '';
  rows.forEach((row, i) => {
    const rank = i + 1;
    let rankClass = '';
    let rankLabel = '' + rank;
    if (rank === 1) { rankClass = 'gold'; rankLabel = '🥇'; }
    else if (rank === 2) { rankClass = 'silver'; rankLabel = '🥈'; }
    else if (rank === 3) { rankClass = 'bronze'; rankLabel = '🥉'; }

    const dateStr = row.played_at ? new Date(row.played_at).toLocaleDateString() : '';
    const highlight = (row.score === score && state === ST.GAMEOVER) ? 'lb-highlight' : '';

    html += `<div class="lb-row ${highlight}">
      <span class="lb-rank ${rankClass}">${rankLabel}</span>
      <span class="lb-name">${escapeHtml('' + row.player_name)}</span>
      <span class="lb-score">${row.score}</span>
    </div>`;
  });
  leaderboardList.innerHTML = html;
}

function hideLeaderboard() {
  leaderboardScreen.style.display = 'none';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- 输入处理 ----------
function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = CW / rect.width;
  const scaleY = CH / rect.height;
  let clientX, clientY;
  if (e.touches) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function handleMouseMove(e) {
  if (state !== ST.PLAYING) return;
  const pos = getCanvasPos(e);
  if (pos.x >= 0 && pos.x <= CW && pos.y >= 0 && pos.y <= CH) {
    mouseX = pos.x;
    mouseY = pos.y;
    useMouseControl = true;
  }
}

function handleMouseLeave() {
  if (useMouseControl) {
    mouseX = -1;
    mouseY = -1;
  }
}

function handleTouchStart(e) {
  e.preventDefault();
  if (state !== ST.PLAYING) return;
  const pos = getCanvasPos(e);
  mouseX = pos.x;
  mouseY = pos.y;
  useMouseControl = true;
  touchActive = true;
}

function handleTouchMove(e) {
  e.preventDefault();
  if (state !== ST.PLAYING) return;
  const pos = getCanvasPos(e);
  mouseX = pos.x;
  mouseY = pos.y;
  useMouseControl = true;
  touchActive = true;
}

function handleTouchEnd(e) {
  e.preventDefault();
  touchActive = false;
}

// ---------- 颜色工具函数 ----------
function lightenColor(hex, amt) {
  let c = hexToRgb(hex);
  if (!c) return hex;
  const r = Math.min(255, c.r + amt);
  const g = Math.min(255, c.g + amt);
  const b = Math.min(255, c.b + amt);
  return `rgb(${r},${g},${b})`;
}

function darkenColor(hex, amt) {
  let c = hexToRgb(hex);
  if (!c) return hex;
  const r = Math.max(0, c.r - amt);
  const g = Math.max(0, c.g - amt);
  const b = Math.max(0, c.b - amt);
  return `rgb(${r},${g},${b})`;
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

// ---------- 初始化 ----------
async function init() {
  // 初始化数据库
  await initDatabase();

  // 加载最高分
  highScore = await loadHighScore();
  updateHighScoreDisplay();

  initStars();
  render();

  // 键盘事件
  document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    // Enter 在排行榜界面关闭
    if (e.code === 'Enter' && leaderboardScreen.style.display === 'flex') {
      hideLeaderboard();
    }
  });
  document.addEventListener('keyup', e => {
    keys[e.code] = false;
  });

  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseleave', handleMouseLeave);

  canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

  // 按钮事件
  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);

  // 排行榜
  leaderboardBtn.addEventListener('click', showLeaderboard);
  closeLeaderboardBtn.addEventListener('click', hideLeaderboard);

  // 保存成绩
  saveScoreBtn.addEventListener('click', async () => {
    let name = playerNameInput.value.trim();
    if (!name) {
      const defaultNames = ['王牌飞行员', '太空猎人', '银河战士', '星际勇者', '雷霆战将'];
      name = defaultNames[Math.floor(Math.random() * defaultNames.length)];
      playerNameInput.value = name;
    }
    if (name.length > 8) name = name.slice(0, 8);
    saveScoreBtn.disabled = true;
    saveScoreBtn.textContent = '保存中...';
    const result = await saveScoreToLeaderboard(name, score);
    saveScoreBtn.disabled = false;
    saveScoreBtn.textContent = '💾 保存成绩';
    if (result) {
      const rankMsg = result.rank > 0 ? `，排名第 ${result.rank}` : '';
      if (result.isNew) {
        egg.ui.toast(`✅ 成绩已保存${rankMsg}！`);
      } else {
        egg.ui.toast(`📋 已有更好成绩${rankMsg}`);
      }
    }
    await showLeaderboard();
  });

  // 排行榜界面点击背景关闭
  leaderboardScreen.addEventListener('click', (e) => {
    if (e.target === leaderboardScreen) hideLeaderboard();
  });

  requestAnimationFrame(gameLoop);
}

init();
