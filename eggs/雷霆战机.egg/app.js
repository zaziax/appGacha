/* ================================================================
   雷霆战机 - 完整游戏逻辑
   基于 Canvas 的竖版飞行射击游戏
   ================================================================ */

// ---------- 常量 ----------
const CW = 480;          // 画布宽度
const CH = 700;          // 画布高度
const PLAYER_W = 34;
const PLAYER_H = 38;
const BULLET_W = 5;
const BULLET_H = 16;
const PLAYER_SPEED = 380;   // px/s
const BULLET_SPEED = 650;
const SHOOT_INTERVAL = 0.18; // 秒
const INVINCIBLE_TIME = 1.8; // 秒
const MAX_LIVES = 5;
const INITIAL_LIVES = 3;
const MAX_PARTICLES = 200;

// 敌人类型
const ENEMY_TYPES = {
  small:  { w: 22, h: 22, hp: 1, score: 10, speedRange: [120, 200], color: '#ff4466' },
  medium: { w: 30, h: 30, hp: 1, score: 15, speedRange: [80, 150],  color: '#cc66ff' },
  large:  { w: 40, h: 40, hp: 2, score: 25, speedRange: [60, 110],  color: '#ff8844' }
};
const ENEMY_TYPES_LIST = ['small', 'medium', 'large'];

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

// ---------- 游戏状态 ----------
let state = ST.MENU;
let score = 0;
let highScore = 0;
let lives = INITIAL_LIVES;
let gameTime = 0;          // 累计游戏时间（秒）
let difficulty = 1;        // 难度倍率

// 游戏对象
let player = null;
let bullets = [];
let enemies = [];
let particles = [];
let stars = [];

// 时间控制
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
  return { x: CW / 2, y: CH - 70, w: PLAYER_W, h: PLAYER_H };
}

function drawPlayer(p) {
  const x = p.x, y = p.y, w = p.w, h = p.h;

  // 无敌闪烁（每秒闪 6 次）
  if (isInvincible && Math.floor(gameTime * 6) % 2 === 0) {
    ctx.globalAlpha = 0.4;
  }

  // 引擎光效
  const grad = ctx.createRadialGradient(x, y + h / 2 + 8, 2, x, y + h / 2 + 8, 18);
  grad.addColorStop(0, 'rgba(80, 160, 255, 0.7)');
  grad.addColorStop(1, 'rgba(80, 160, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(x - 18, y + h / 2 - 4, 36, 28);

  // 飞船主体 - 用 Path2D 画三角翼形状
  ctx.shadowColor = '#4488ff';
  ctx.shadowBlur = 14;

  const body = new Path2D();
  // 机头
  body.moveTo(x, y - h / 2);
  // 左翼
  body.lineTo(x - w / 2, y + h / 4);
  // 左引擎
  body.lineTo(x - w / 3, y + h / 2);
  // 机身底部
  body.lineTo(x, y + h / 2 - 4);
  // 右引擎
  body.lineTo(x + w / 3, y + h / 2);
  // 右翼
  body.lineTo(x + w / 2, y + h / 4);
  body.closePath();

  // 机身渐变
  const bodyGrad = ctx.createLinearGradient(x, y - h / 2, x, y + h / 2);
  bodyGrad.addColorStop(0, '#66bbff');
  bodyGrad.addColorStop(0.5, '#3388dd');
  bodyGrad.addColorStop(1, '#2255aa');
  ctx.fillStyle = bodyGrad;
  ctx.fill(body);
  ctx.strokeStyle = '#88ddff';
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

// ---------- 子弹 ----------
function fireBullet() {
  if (!player) return;
  bullets.push({
    x: player.x,
    y: player.y - player.h / 2 - 6,
    w: BULLET_W,
    h: BULLET_H,
    speed: BULLET_SPEED,
    active: true
  });
}

function updateBullets(dt) {
  for (const b of bullets) {
    b.y -= b.speed * dt;
    if (b.y + b.h < 0) b.active = false;
  }
  bullets = bullets.filter(b => b.active);
}

function drawBullets() {
  ctx.shadowColor = '#44ddff';
  ctx.shadowBlur = 10;
  for (const b of bullets) {
    const grad = ctx.createLinearGradient(b.x, b.y - b.h / 2, b.x, b.y + b.h / 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, '#44ddff');
    grad.addColorStop(1, '#2288dd');
    ctx.fillStyle = grad;
    ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
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
    // 左右摆动
    e.wobble += e.wobbleSpeed * dt;
    e.x += Math.sin(e.wobble) * e.wobbleAmount * dt;
    // 边界约束
    e.x = Math.max(e.w / 2, Math.min(CW - e.w / 2, e.x));
    // 超出底部则移除
    if (e.y - e.h / 2 > CH) e.active = false;
  }
  enemies = enemies.filter(e => e.active);
}

function drawEnemies() {
  for (const e of enemies) {
    const x = e.x, y = e.y, w = e.w, h = e.h;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 10;

    // 敌人主体形状
    const shape = new Path2D();
    shape.moveTo(x, y + h / 2);             // 底部
    shape.lineTo(x - w / 2, y + h / 4);     // 左下
    shape.lineTo(x - w / 3, y - h / 3);     // 左上
    shape.lineTo(x, y - h / 2);             // 顶部
    shape.lineTo(x + w / 3, y - h / 3);     // 右上
    shape.lineTo(x + w / 2, y + h / 4);     // 右下
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

    // 眼睛（亮点）
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(x - w / 5, y - h / 6, 2.5, 0, Math.PI * 2);
    ctx.arc(x + w / 5, y - h / 6, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 血量指示（大型敌人）
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
        b.active = false;
        e.hp--;
        if (e.hp <= 0) {
          e.active = false;
          score += e.score;
          updateScoreDisplay();
          spawnExplosion(e.x, e.y, e.color, 18);
          // 有一定概率掉落加分闪光
          if (Math.random() < 0.15) {
            spawnExplosion(e.x, e.y - 10, '#ffdd44', 6);
          }
        } else {
          // 掉血但没死，小火花
          spawnExplosion(e.x, e.y, '#ffaa44', 5);
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

function playerHit() {
  lives--;
  updateLivesDisplay();
  spawnExplosion(player.x, player.y, '#44aaff', 20);

  if (lives <= 0) {
    gameOver();
    return;
  }

  // 无敌时间
  isInvincible = true;
  invincibleTimer = INVINCIBLE_TIME;
}

// ---------- 难度管理 ----------
function updateDifficulty() {
  difficulty = 1 + Math.floor(score / 100) * 0.2;
  if (difficulty > 4) difficulty = 4;
}

function getSpawnInterval() {
  // 初始 1.2 秒，随难度缩短到最少 0.3 秒
  return Math.max(0.3, 1.2 - (difficulty - 1) * 0.15);
}

// ---------- 游戏流程控制 ----------
function startGame() {
  score = 0;
  lives = INITIAL_LIVES;
  gameTime = 0;
  difficulty = 1;
  bullets = [];
  enemies = [];
  particles = [];
  shootTimer = 0;
  enemySpawnTimer = 0;
  isInvincible = false;
  invincibleTimer = 0;
  useMouseControl = false;
  touchActive = false;
  mouseX = -1; mouseY = -1;

  player = createPlayer();
  state = ST.PLAYING;

  startScreen.style.display = 'none';
  gameOverScreen.style.display = 'none';

  updateScoreDisplay();
  updateLivesDisplay();
}

function gameOver() {
  state = ST.GAMEOVER;
  // 爆炸特效
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      if (player) spawnExplosion(
        player.x + (Math.random() - 0.5) * 40,
        player.y + (Math.random() - 0.5) * 40,
        '#ff6644', 15
      );
    }, i * 120);
  }

  // 保存最高分
  saveHighScore(score);

  setTimeout(() => {
    finalScoreEl.textContent = score;
    finalHighScoreEl.textContent = highScore;
    gameOverScreen.style.display = 'flex';
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
    updateParticles(dt);
    checkCollisions();

    // 自动射击
    shootTimer += dt;
    if (shootTimer >= SHOOT_INTERVAL) {
      shootTimer = 0;
      fireBullet();
      // 双发
      if (score >= 50) {
        fireBullet();
        // 调整子弹位置使双发分开
        const lastTwo = bullets.slice(-2);
        if (lastTwo.length === 2) {
          lastTwo[0].x = player.x - 8;
          lastTwo[1].x = player.x + 8;
        }
      }
    }

    // 敌人生成
    enemySpawnTimer += dt;
    const spawnInterval = getSpawnInterval();
    if (enemySpawnTimer >= spawnInterval) {
      enemySpawnTimer = 0;
      spawnEnemy();
      // 高难度时偶尔一次生成两个
      if (difficulty >= 2.5 && Math.random() < 0.3) {
        spawnEnemy();
      }
    }

    // 无敌计时
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

  // 键盘控制
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

  // 鼠标/触摸控制
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

  // 边界约束
  player.x = Math.max(player.w / 2, Math.min(CW - player.w / 2, player.x));
  player.y = Math.max(player.h / 2 + 20, Math.min(CH - player.h / 2, player.y));
}

// ---------- 渲染 ----------
function render() {
  ctx.clearRect(0, 0, CW, CH);

  // 背景
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

  drawBullets();
  drawEnemies();
  drawParticles();

  // 分数显示（画布内）
  if (state === ST.PLAYING) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('SCORE: ' + score, CW - 14, 28);
  }

  // 低生命警告
  if (state === ST.PLAYING && lives <= 1 && Math.floor(gameTime * 4) % 2 === 0) {
    ctx.fillStyle = 'rgba(255, 50, 50, 0.25)';
    ctx.fillRect(0, 0, CW, CH);
  }
}

// ---------- 游戏循环 ----------
function gameLoop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  update(dt);

  // 菜单状态也渲染背景
  if (state === ST.MENU) {
    render();
  } else {
    render();
  }

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

// ---------- 数据持久化 ----------
async function loadHighScore() {
  try {
    const val = await egg.storage.get('thunder_highScore');
    return (typeof val === 'number') ? val : 0;
  } catch (e) {
    console.warn('读取最高分失败', e);
    return 0;
  }
}

async function saveHighScore(score) {
  if (score > highScore) {
    highScore = score;
    updateHighScoreDisplay();
    try {
      await egg.storage.set('thunder_highScore', highScore);
    } catch (e) {
      console.warn('保存最高分失败', e);
    }
  }
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
  // 加载最高分
  highScore = await loadHighScore();
  updateHighScoreDisplay();

  // 初始化星空
  initStars();

  // 绘制初始背景
  render();

  // 键盘事件
  document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  });
  document.addEventListener('keyup', e => {
    keys[e.code] = false;
  });

  // 鼠标事件
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseleave', handleMouseLeave);

  // 触摸事件
  canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

  // 按钮事件
  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);

  // 启动游戏循环
  requestAnimationFrame(gameLoop);
}

init();
