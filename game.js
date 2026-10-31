// Игровой режим: джойстик слева, обзор пальцем справа, настраиваемые кнопки, гироскоп.
'use strict';
const Game = (() => {
  const GAME_DEFAULTS = {
    sens: 8, menuSens: 1.5, invertY: false,
    tapAction: 'lmb', holdAction: 'rmb', doubleHoldAction: 'lmb', holdMs: 300,
    gyro: 0, gyroX: 30, gyroY: 30, gyroInvX: false, gyroInvY: false, gyroRoll: false, gyroDead: 1, gyroMap: null,
    joyMode: 'smooth', joyFloat: true, joySprint: true, joySize: 150, joyX: 16, joyY: 70,
    buttons: null, layoutV: 2,
  };
  const DEFAULT_BUTTONS = [
    { label: '⬆', action: 'space', x: 91, y: 62, size: 76 },
    { label: '⬇', action: 'shift', x: 91, y: 86, size: 76 },
    { label: '⚔', action: 'lmb', x: 77, y: 84, size: 68 },
    { label: '✋', action: 'rmb', x: 66, y: 88, size: 60 },
    { label: 'E', action: 'e', x: 96, y: 24, size: 48 },
    { label: 'Q', action: 'q', x: 88, y: 24, size: 48 },
    { label: 'Esc', action: 'esc', x: 5, y: 16, size: 46 },
    { type: 'strip', vertical: false, reverse: false, step: 28, len: 210, x: 47, y: 92 },
    { label: 'F5', action: 'f5', x: 80, y: 24, size: 48 },
  ];
  const ACTION_OPTS = [['ЛКМ', 'lmb'], ['ПКМ', 'rmb'], ['Ничего', 'none']];
  const MOUSE = { lmb: BTN.L, rmb: BTN.R, mmb: BTN.M, mb4: 8, mb5: 16 };
  const MEDIA_KEYS = { volup: 0xE9, voldown: 0xEA, mute: 0xE2, playpause: 0xCD, nexttrack: 0xB5, prevtrack: 0xB6, stopmedia: 0xB7 };
  // Chrome: alpha — ось X телефона, beta — Y, gamma — Z. Знаки для горизонтального положения с angle 90.
  const GYRO_AXES = ['alpha', 'beta', 'gamma'];
  const DEFAULT_GYRO_MAP = { yaw: { axis: 'alpha', sign: -1 }, pitch: { axis: 'beta', sign: 1 }, angle: 90 };
  const JOY_PWM_MS = 100;  // Minecraft читает клавиши раз в 50 мс: импульс короче двух тиков может потеряться
  const WHEEL = { wheelup: 1, wheeldown: -1 };
  const STRIP_THICKNESS = 46;
  const WASD = { w: 0x1A, a: 0x04, s: 0x16, d: 0x07, sprint: 0xE0 };
  const TAP_MS = 220, MOVE_TOL = 10, DOUBLE_MS = 300, JOY_DEAD = 0.25, JOY_AXIS = 0.38, JOY_SPRINT = 0.95, JOY_FULL = 0.9, JOY_MIN = 0.12;

  const G = { ...GAME_DEFAULTS, ...S.game };
  if (!Array.isArray(G.buttons)) G.buttons = DEFAULT_BUTTONS.map(b => ({ ...b }));
  if (S.game && S.game.layoutV !== 2) {
    // Кнопки ◀ ▶ из прошлой версии заменяет полоса прокрутки
    G.buttons = G.buttons.filter(b => !(WHEEL[b.action] && (b.label === '◀' || b.label === '▶')));
    G.buttons.push({ ...DEFAULT_BUTTONS.find(b => b.type === 'strip') });
    G.layoutV = 2;
  }
  const persist = () => { S.game = G; save(); };

  const root = $('#game'), surface = $('#gSurface'), layer = $('#gButtons'), joyBase = $('#gJoy'), joyNub = $('#gNub');
  let active = false, editing = false, menuMode = false, wentFullscreen = false;
  const down = new Map();  // код клавиши/кнопки мыши -> сколько источников держат

  // Браузер не создаёт click, пока другой палец на экране (держит джойстик) или сразу после быстрого жеста.
  // Поэтому верхние кнопки слушают само касание, а click отменяем, чтобы он не попал в открывшееся окно.
  function onTap(el, fn) {
    let pointer = null;
    el.addEventListener('pointerdown', e => {
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      pointer = e.pointerId;
    });
    el.addEventListener('pointerup', e => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) fn();
    });
    el.addEventListener('pointercancel', () => { pointer = null; });
    el.addEventListener('touchend', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  }

  // ---------- Нажатия: один код могут держать несколько источников ----------
  function press(kind, code) {
    const id = kind + code, n = down.get(id) || 0;
    down.set(id, n + 1);
    if (!n) link.cmd(kind === 'm' ? C.BTN_DOWN : C.KEY_DOWN, code);
  }
  function release(kind, code) {
    const id = kind + code, n = down.get(id) || 0;
    if (!n) return;
    if (n > 1) { down.set(id, n - 1); return; }
    down.delete(id);
    link.cmd(kind === 'm' ? C.BTN_UP : C.KEY_UP, code);
  }

  function actionDown(action) {
    if (action === 'none') return;
    if (MOUSE[action]) { press('m', MOUSE[action]); return; }
    if (WHEEL[action]) { link.wheel(WHEEL[action], 0); return; }
    if (MEDIA_KEYS[action]) { link.cmd(C.MEDIA, MEDIA_KEYS[action] & 255, MEDIA_KEYS[action] >> 8); return; }
    for (const c of Script.parseCombo(action) || []) press('k', c);
  }
  function actionUp(action) {
    if (MOUSE[action]) { release('m', MOUSE[action]); return; }
    if (action === 'none' || WHEEL[action] || MEDIA_KEYS[action]) return;
    for (const c of [...(Script.parseCombo(action) || [])].reverse()) release('k', c);
  }
  const validAction = a => a === 'none' || !!MOUSE[a] || !!WHEEL[a] || !!MEDIA_KEYS[a] || !!Script.parseCombo(a);

  function releaseAll(notify = true) {
    for (const [id] of down) {
      const code = +id.slice(1);
      if (notify) link.cmd(id[0] === 'm' ? C.BTN_UP : C.KEY_UP, code);
    }
    down.clear();
    joy.id = look.id = null;
    joy.keys.clear();
    clearInterval(joy.timer);
    joy.timer = 0;
    clearTimeout(look.timer);
    look.heldAction = null;
    layer.querySelectorAll('.gb').forEach(b => { b.classList.remove('dn'); b._toggled = false; });
    paintJoy(0, 0);
  }

  // ---------- Джойстик ----------
  const joy = { id: null, cx: 0, cy: 0, keys: new Set(), timer: 0,
    x: { key: 0, duty: 0, acc: 0, neg: 'a', pos: 'd' }, y: { key: 0, duty: 0, acc: 0, neg: 'w', pos: 's' } };

  function placeJoyAtRest() {
    joyBase.style.width = joyBase.style.height = G.joySize + 'px';
    joyBase.style.left = G.joyX + '%';
    joyBase.style.top = G.joyY + '%';
    joyBase.classList.remove('active');
  }
  function paintJoy(nx, ny) {
    const r = G.joySize / 2;
    joyNub.style.transform = `translate(calc(-50% + ${nx * r}px), calc(-50% + ${ny * r}px))`;
  }
  function setJoyKey(name, on) {
    if (on === joy.keys.has(name)) return;
    if (on) { joy.keys.add(name); press('k', WASD[name]); } else { joy.keys.delete(name); release('k', WASD[name]); }
  }
  function joyMove(x, y) {
    const r = G.joySize / 2;
    let nx = (x - joy.cx) / r, ny = (y - joy.cy) / r;
    const mag = Math.hypot(nx, ny);
    if (mag > 1) { nx /= mag; ny /= mag; }
    paintJoy(nx, ny);
    const live = mag > JOY_DEAD, ux = mag ? nx / Math.min(mag, 1) : 0, uy = mag ? ny / Math.min(mag, 1) : 0;
    setJoyKey('sprint', G.joySprint && !menuMode && mag >= JOY_SPRINT && uy < -JOY_AXIS);
    if (G.joyMode === 'smooth') { joySmooth(nx, ny, mag); return; }
    setJoyKey('w', live && uy < -JOY_AXIS);
    setJoyKey('s', live && uy > JOY_AXIS);
    setJoyKey('a', live && ux < -JOY_AXIS);
    setJoyKey('d', live && ux > JOY_AXIS);
  }
  // Клавиши бывают только «нажата» или «нет», поэтому скорость задаём долей времени, пока клавиша нажата.
  // Так же получается любое направление: сильная ось нажата всё время, слабая — частями.
  function joySmooth(nx, ny, mag) {
    const m = Math.min(mag, 1), major = Math.max(Math.abs(nx), Math.abs(ny));
    const power = m > JOY_DEAD ? (m - JOY_DEAD) / (1 - JOY_DEAD) : 0;
    const set = (axis, v) => {
      let duty = major ? power * Math.abs(v) / major : 0;
      if (duty >= JOY_FULL) duty = 1;
      if (duty < JOY_MIN) duty = 0;
      const was = axis.duty;
      axis.duty = duty;
      axis.key = duty ? (v < 0 ? axis.neg : axis.pos) : null;
      const other = v < 0 ? axis.pos : axis.neg;
      setJoyKey(other, false);
      if (!duty) { setJoyKey(axis.neg, false); setJoyKey(axis.pos, false); axis.acc = 0; return; }
      if (!was || duty === 1) { axis.acc = 0; setJoyKey(axis.key, true); }  // отклик сразу, без ожидания такта
    };
    set(joy.x, nx);
    set(joy.y, ny);
    if (!joy.timer) joy.timer = setInterval(joyPulse, JOY_PWM_MS);
  }
  function joyPulse() {
    for (const axis of [joy.x, joy.y]) {
      if (!axis.duty) continue;
      if (axis.duty === 1) { setJoyKey(axis.key, true); continue; }
      axis.acc += axis.duty;
      const on = axis.acc >= 1;
      if (on) axis.acc -= 1;
      setJoyKey(axis.key, on);
    }
  }
  function joyEnd() {
    joy.id = null;
    clearInterval(joy.timer);
    joy.timer = 0;
    joy.x.duty = joy.y.duty = 0;
    for (const k of [...joy.keys]) setJoyKey(k, false);
    paintJoy(0, 0);
    placeJoyAtRest();
  }

  // ---------- Обзор пальцем: тап — ЛКМ, удержание — зажатая ПКМ, тап+удержание — зажатая ЛКМ ----------
  const look = { id: null, sx: 0, sy: 0, lx: 0, ly: 0, t0: 0, moved: false, timer: 0, heldAction: null, rx: 0, ry: 0, lastTap: 0, lastX: 0, lastY: 0 };

  function turn(dx, dy, sensX, sensY) {
    look.rx += dx * sensX; look.ry += dy * sensY;
    const ix = Math.trunc(look.rx), iy = Math.trunc(look.ry);
    look.rx -= ix; look.ry -= iy;
    if (ix || iy) link.move(ix, iy);
  }
  function lookStart(e) {
    const now = performance.now();
    Object.assign(look, { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, t0: now, moved: false });
    if (now - look.lastTap < DOUBLE_MS && Math.hypot(e.clientX - look.lastX, e.clientY - look.lastY) < 80) {
      look.lastTap = 0;
      look.heldAction = G.doubleHoldAction;
      actionDown(look.heldAction);
      vib(25);
      return;
    }
    look.timer = setTimeout(() => {
      if (look.id === null || look.moved) return;
      look.heldAction = G.holdAction;
      actionDown(look.heldAction);
      vib(30);
    }, G.holdMs);
  }
  function lookMove(e) {
    if (!look.moved && Math.hypot(e.clientX - look.sx, e.clientY - look.sy) > MOVE_TOL) {
      look.moved = true;
      if (!look.heldAction) clearTimeout(look.timer);
    }
    const dx = e.clientX - look.lx, dy = e.clientY - look.ly;
    look.lx = e.clientX; look.ly = e.clientY;
    if (!look.moved) return;
    const k = menuMode ? G.menuSens : G.sens;
    turn(dx, dy, k, menuMode || !G.invertY ? k : -k);
  }
  function lookEnd(e) {
    clearTimeout(look.timer);
    look.id = null;
    if (look.heldAction) { actionUp(look.heldAction); look.heldAction = null; return; }
    if (!look.moved && performance.now() - look.t0 < Math.max(TAP_MS, G.holdMs)) {
      const m = MOUSE[G.tapAction];
      if (m) link.cmd(C.CLICK, m);
      look.lastTap = performance.now(); look.lastX = e.clientX; look.lastY = e.clientY;
    }
  }

  surface.addEventListener('pointerdown', e => {
    if (editing) return;
    e.preventDefault();
    surface.setPointerCapture(e.pointerId);
    if (e.clientX < innerWidth * 0.42) {
      if (joy.id !== null) return;
      joy.id = e.pointerId;
      if (G.joyFloat) {
        joyBase.style.left = e.clientX / innerWidth * 100 + '%';
        joyBase.style.top = e.clientY / innerHeight * 100 + '%';
        joy.cx = e.clientX; joy.cy = e.clientY;
      } else {
        const r = joyBase.getBoundingClientRect();
        joy.cx = r.left + r.width / 2; joy.cy = r.top + r.height / 2;
      }
      joyBase.classList.add('active');
      joyMove(e.clientX, e.clientY);
    } else if (look.id === null) lookStart(e);
  });
  surface.addEventListener('pointermove', e => {
    if (e.pointerId === joy.id) joyMove(e.clientX, e.clientY);
    else if (e.pointerId === look.id) lookMove(e);
  });
  const surfaceEnd = e => {
    if (e.pointerId === joy.id) joyEnd();
    else if (e.pointerId === look.id) lookEnd(e);
  };
  surface.addEventListener('pointerup', surfaceEnd);
  surface.addEventListener('pointercancel', surfaceEnd);

  // ---------- Настраиваемые кнопки ----------
  function renderButtons() {
    layer.innerHTML = '';
    G.buttons.forEach(cfg => {
      if (cfg.type === 'strip') { renderStrip(cfg); return; }
      const b = document.createElement('button');
      b.className = 'gb';
      b.textContent = cfg.label;
      b.style.left = cfg.x + '%';
      b.style.top = cfg.y + '%';
      b.style.width = b.style.height = cfg.size + 'px';
      b.style.fontSize = Math.max(12, cfg.size * 0.3) + 'px';
      b.classList.toggle('toggle', !!cfg.toggle);
      bindButton(b, cfg);
      layer.appendChild(b);
    });
  }

  function renderStrip(cfg) {
    const el = document.createElement('div');
    el.className = 'gs' + (cfg.vertical ? ' v' : '');
    el.style.left = cfg.x + '%';
    el.style.top = cfg.y + '%';
    el.style.width = (cfg.vertical ? STRIP_THICKNESS : cfg.len) + 'px';
    el.style.height = (cfg.vertical ? cfg.len : STRIP_THICKNESS) + 'px';
    let pointer = null, last = 0, acc = 0, drag = null;
    const coord = e => (cfg.vertical ? e.clientY : e.clientX);
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      if (editing) { drag = { x: e.clientX, y: e.clientY, moved: false }; return; }
      pointer = e.pointerId; last = coord(e); acc = 0;
      el.classList.add('dn');
    });
    el.addEventListener('pointermove', e => {
      if (editing) {
        if (dragWidget(e, drag, cfg)) { el.style.left = cfg.x + '%'; el.style.top = cfg.y + '%'; }
        return;
      }
      if (e.pointerId !== pointer) return;
      acc += coord(e) - last;
      last = coord(e);
      const ticks = Math.trunc(acc / cfg.step);
      if (!ticks) return;
      acc -= ticks * cfg.step;
      // по умолчанию палец влево или вверх — вперёд, это колесо вниз и следующий слот
      link.wheel(cfg.reverse ? -ticks : ticks, 0);
      vib(5);
    });
    const up = () => {
      if (editing) {
        if (drag && !drag.moved) openStripDialog(cfg);
        else if (drag) persist();
        drag = null;
        return;
      }
      pointer = null;
      el.classList.remove('dn');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    layer.appendChild(el);
  }

  function dragWidget(e, drag, cfg) {
    if (!drag) return false;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
    if (!drag.moved) return false;
    cfg.x = Math.max(0, Math.min(100, e.clientX / innerWidth * 100));
    cfg.y = Math.max(0, Math.min(100, e.clientY / innerHeight * 100));
    return true;
  }

  function bindButton(b, cfg) {
    let drag = null;
    b.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      if (editing) { drag = { x: e.clientX, y: e.clientY, moved: false }; return; }
      vib(10);
      if (cfg.toggle && !WHEEL[cfg.action]) {
        b._toggled = !b._toggled;
        b.classList.toggle('dn', b._toggled);
        if (b._toggled) actionDown(cfg.action); else actionUp(cfg.action);
        return;
      }
      b.classList.add('dn');
      b._down = true;
      actionDown(cfg.action);
    });
    b.addEventListener('pointermove', e => {
      if (editing && dragWidget(e, drag, cfg)) { b.style.left = cfg.x + '%'; b.style.top = cfg.y + '%'; }
    });
    const up = () => {
      if (editing) {
        if (drag && !drag.moved) openButtonDialog(cfg);
        else if (drag) persist();
        drag = null;
        return;
      }
      if (!b._down) return;
      b._down = false;
      b.classList.remove('dn');
      actionUp(cfg.action);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }

  const btnDlg = $('#gBtnDlg');
  let editingCfg = null;
  function openButtonDialog(cfg) {
    editingCfg = cfg;
    $('#gbLabel').value = cfg.label;
    $('#gbAction').value = cfg.action;
    $('#gbSize').value = cfg.size;
    $('#gbToggle').checked = !!cfg.toggle;
    $('#gbErr').textContent = '';
    paintActionHint();
    btnDlg.showModal();
    $('#gbLabel').blur();
  }
  function paintActionHint() {
    const item = KeyList.describe($('#gbAction').value.trim().toLowerCase());
    $('#gbHint').textContent = item ? item.desc : '';
  }
  $('#gbAction').addEventListener('input', paintActionHint);
  $('#gbList').addEventListener('click', () => {
    KeyList.open(item => {
      $('#gbAction').value = item.action;
      $('#gbLabel').value = item.short;
      $('#gbErr').textContent = '';
      paintActionHint();
    });
  });

  // ---------- Настройки полосы прокрутки ----------
  const stripDlg = $('#gStripDlg');
  let editingStrip = null;
  function paintStripLabels() {
    const vertical = $('#gsVertical').value === '1';
    $('#gsDirLabel').textContent = vertical ? 'Палец вверх' : 'Палец влево';
    $('#gsStepValue').textContent = $('#gsStep').value;
  }
  function openStripDialog(cfg) {
    editingStrip = cfg;
    $('#gsVertical').value = cfg.vertical ? '1' : '0';
    $('#gsReverse').value = cfg.reverse ? '1' : '0';
    $('#gsStep').value = cfg.step;
    $('#gsLen').value = cfg.len;
    paintStripLabels();
    stripDlg.showModal();
  }
  $('#gsVertical').addEventListener('change', paintStripLabels);
  $('#gsStep').addEventListener('input', paintStripLabels);
  $('#gsSave').addEventListener('click', () => {
    Object.assign(editingStrip, { vertical: $('#gsVertical').value === '1', reverse: $('#gsReverse').value === '1',
      step: +$('#gsStep').value, len: +$('#gsLen').value });
    persist(); renderButtons(); stripDlg.close();
  });
  $('#gsDelete').addEventListener('click', () => {
    G.buttons.splice(G.buttons.indexOf(editingStrip), 1);
    persist(); renderButtons(); stripDlg.close();
  });
  $('#gsCancel').addEventListener('click', () => stripDlg.close());
  $('#gbSave').addEventListener('click', () => {
    const action = $('#gbAction').value.trim().toLowerCase();
    if (!validAction(action)) { $('#gbErr').textContent = `Не знаю «${action}». Примеры: space, e, ctrl+z, lmb, rmb, wheelup`; return; }
    Object.assign(editingCfg, { label: $('#gbLabel').value.trim() || action, action, size: +$('#gbSize').value, toggle: $('#gbToggle').checked });
    persist(); renderButtons(); btnDlg.close();
  });
  $('#gbDelete').addEventListener('click', () => {
    G.buttons.splice(G.buttons.indexOf(editingCfg), 1);
    persist(); renderButtons(); btnDlg.close();
  });
  $('#gbCancel').addEventListener('click', () => btnDlg.close());

  function setEditing(on) {
    editing = on;
    if (on) releaseAll();
    root.classList.toggle('editing', on);
    $('#gEdit').classList.toggle('on', on);
    toast(on ? 'Двигай кнопки и джойстик. Тап по кнопке — её настройки' : 'Раскладка сохранена', 1800);
    if (!on) persist();
  }
  onTap($('#gEdit'), () => setEditing(!editing));
  onTap($('#gAdd'), () => $('#gAddDlg').showModal());
  $('#gAddButton').addEventListener('click', () => {
    const cfg = { label: 'R', action: 'r', x: 50, y: 40, size: 56 };
    G.buttons.push(cfg);
    persist(); renderButtons(); $('#gAddDlg').close(); openButtonDialog(cfg);
  });
  const addStrip = vertical => {
    const cfg = { type: 'strip', vertical, reverse: false, step: 28, len: 210, x: 50, y: 40 };
    G.buttons.push(cfg);
    persist(); renderButtons(); $('#gAddDlg').close(); openStripDialog(cfg);
  };
  $('#gAddH').addEventListener('click', () => addStrip(false));
  $('#gAddV').addEventListener('click', () => addStrip(true));
  $('#gAddClose').addEventListener('click', () => $('#gAddDlg').close());
  onTap($('#gReset'), () => {
    if (!confirm('Вернуть кнопки на места по умолчанию?')) return;
    G.buttons = DEFAULT_BUTTONS.map(b => ({ ...b }));
    G.joyX = GAME_DEFAULTS.joyX; G.joyY = GAME_DEFAULTS.joyY;
    persist(); renderButtons(); placeJoyAtRest();
  });

  // Джойстик тоже двигается в режиме настройки
  joyBase.addEventListener('pointerdown', e => {
    if (!editing) return;
    e.stopPropagation();
    joyBase.setPointerCapture(e.pointerId);
    joyBase._drag = true;
  });
  joyBase.addEventListener('pointermove', e => {
    if (!joyBase._drag) return;
    G.joyX = e.clientX / innerWidth * 100;
    G.joyY = e.clientY / innerHeight * 100;
    placeJoyAtRest();
  });
  const joyDragEnd = () => { if (joyBase._drag) { joyBase._drag = false; persist(); } };
  joyBase.addEventListener('pointerup', joyDragEnd);
  joyBase.addEventListener('pointercancel', joyDragEnd);

  // ---------- Гироскоп ----------
  const gyro = { listening: false, last: 0, gotEvent: false, checkTimer: 0 };

  function gyroWanted() {
    if (!active || editing || menuMode || cal.on) return false;
    return G.gyro === 1 || (G.gyro === 2 && look.id !== null);
  }
  function onMotion(e) {
    gyro.gotEvent = true;
    const r = e.rotationRate;
    const now = e.timeStamp;
    const dt = gyro.last ? Math.min(now - gyro.last, 50) / 1000 : 0;
    gyro.last = now;
    if (!r || !dt || !gyroWanted()) return;
    const map = G.gyroMap || DEFAULT_GYRO_MAP;
    // Перевернул телефон другой стороной: оси в плоскости экрана меняют знак, ось сквозь экран — нет
    const rollAxis = GYRO_AXES.find(a => a !== map.yaw.axis && a !== map.pitch.axis);
    const flip = (screen.orientation?.angle ?? map.angle) !== map.angle ? -1 : 1;
    const dead = v => (Math.abs(v) < G.gyroDead ? 0 : v);
    let yaw = flip * map.yaw.sign * dead(r[map.yaw.axis] || 0);
    if (G.gyroRoll) yaw -= dead(r[rollAxis] || 0);
    const pitch = flip * map.pitch.sign * dead(r[map.pitch.axis] || 0);
    turn(yaw * dt, pitch * dt, G.gyroX * (G.gyroInvX ? -1 : 1), G.gyroY * (G.gyroInvY ? -1 : 1));
  }
  async function gyroStart() {
    if (gyro.listening) return;
    if (typeof DeviceMotionEvent === 'undefined') { toast('Гироскоп в этом браузере недоступен'); return; }
    if (DeviceMotionEvent.requestPermission) {
      try { if (await DeviceMotionEvent.requestPermission() !== 'granted') { toast('Нет разрешения на датчики движения'); return; } } catch (e) { return; }
    }
    window.addEventListener('devicemotion', onMotion);
    gyro.listening = true; gyro.gotEvent = false; gyro.last = 0;
    clearTimeout(gyro.checkTimer);
    gyro.checkTimer = setTimeout(() => {
      if (gyro.listening && !gyro.gotEvent) toast('Гироскоп молчит. Проверь «Датчики движения» в настройках сайта Chrome', 4000);
    }, 2000);
  }
  function gyroStop() {
    window.removeEventListener('devicemotion', onMotion);
    gyro.listening = false;
    clearTimeout(gyro.checkTimer);
  }
  function syncGyro() {
    if (active && G.gyro) gyroStart(); else gyroStop();
    $('#gGyro').classList.toggle('on', !!G.gyro);
  }
  onTap($('#gGyro'), () => {
    G.gyro = G.gyro ? 0 : 1;
    persist(); syncGyro();
    toast(G.gyro ? 'Гироскоп включён' : 'Гироскоп выключен', 900);
    if (G.gyro && !G.gyroMap) calStart();
  });

  // ---------- Настройка гироскопа: человек показывает движения, сайт запоминает оси и знаки ----------
  const CAL_STEPS = [
    { id: 'up', icon: '⬆', text: 'Наклони телефон камерой вверх' },
    { id: 'down', icon: '⬇', text: 'Наклони телефон камерой вниз' },
    { id: 'left', icon: '⬅', text: 'Поверни телефон налево' },
    { id: 'right', icon: '➡', text: 'Поверни телефон направо' },
  ];
  const CAL_DEG = 30, CAL_NOISE = 3, CAL_STILL = 25, CAL_STILL_MS = 400;
  const cal = { on: false, step: 0, phase: 'move', sum: {}, got: {}, last: 0, stillSince: 0 };
  const calDlg = $('#gCalDlg');

  function calPaint() {
    const s = CAL_STEPS[cal.step];
    $('#gCalIcon').textContent = cal.phase === 'move' ? s.icon : '↩';
    $('#gCalText').textContent = cal.phase === 'move' ? s.text : 'Хорошо. Верни телефон обратно и замри';
    $('#gCalStep').textContent = `Шаг ${cal.step + 1} из ${CAL_STEPS.length}`;
    $('#gCalBar').style.width = (cal.phase === 'move'
      ? Math.min(1, calMax() / CAL_DEG) : 1) * 100 + '%';
  }
  const calMax = () => Math.max(...GYRO_AXES.map(a => Math.abs(cal.sum[a] || 0)));

  function calMotion(e) {
    const r = e.rotationRate;
    const dt = cal.last ? Math.min(e.timeStamp - cal.last, 50) / 1000 : 0;
    cal.last = e.timeStamp;
    if (!r || !dt) return;
    if (cal.phase === 'move') {
      for (const a of GYRO_AXES) if (Math.abs(r[a] || 0) > CAL_NOISE) cal.sum[a] = (cal.sum[a] || 0) + r[a] * dt;
      if (calMax() >= CAL_DEG) {
        cal.got[CAL_STEPS[cal.step].id] = { ...cal.sum };
        cal.phase = 'back';
        cal.stillSince = 0;
        vib(30);
      }
    } else {
      const moving = GYRO_AXES.some(a => Math.abs(r[a] || 0) > CAL_STILL);
      if (moving) cal.stillSince = 0;
      else if (!cal.stillSince) cal.stillSince = e.timeStamp;
      else if (e.timeStamp - cal.stillSince >= CAL_STILL_MS) {
        cal.step++;
        cal.phase = 'move';
        cal.sum = {};
        if (cal.step === CAL_STEPS.length) { calFinish(); return; }
      }
    }
    calPaint();
  }

  // Ось движения — та, что сильнее всех разошлась между двумя противоположными шагами
  function calAxis(a, b) {
    const diff = GYRO_AXES.map(ax => ({ axis: ax, v: (a[ax] || 0) - (b[ax] || 0) }));
    const best = diff.reduce((m, d) => (Math.abs(d.v) > Math.abs(m.v) ? d : m));
    return (a[best.axis] || 0) * (b[best.axis] || 0) < 0 ? best : null;
  }
  function calFinish() {
    calStop();
    const pitch = calAxis(cal.got.up, cal.got.down), yaw = calAxis(cal.got.left, cal.got.right);
    if (!pitch || !yaw || pitch.axis === yaw.axis) {
      $('#gCalIcon').textContent = '⚠';
      $('#gCalText').textContent = 'Не удалось разобрать движения. Наклоняй и поворачивай только в одну сторону за шаг';
      $('#gCalBar').style.width = '0';
      $('#gCalRetry').hidden = false;
      return;
    }
    // Смотреть вверх — мышь вверх (dy < 0), смотреть налево — мышь влево (dx < 0)
    G.gyroMap = { yaw: { axis: yaw.axis, sign: -Math.sign(yaw.v) }, pitch: { axis: pitch.axis, sign: -Math.sign(pitch.v) },
      angle: screen.orientation?.angle ?? 90 };
    G.gyroInvX = G.gyroInvY = false;
    if (!G.gyro) G.gyro = 1;
    persist(); syncGyro();
    calDlg.close();
    toast('Гироскоп настроен', 1500);
  }
  function calStop() {
    cal.on = false;
    window.removeEventListener('devicemotion', calMotion);
  }
  function calBegin() {
    Object.assign(cal, { on: true, step: 0, phase: 'move', sum: {}, got: {}, last: 0 });
    $('#gCalRetry').hidden = true;
    window.addEventListener('devicemotion', calMotion);
    calPaint();
  }
  function calStart() {
    if (typeof DeviceMotionEvent === 'undefined') { toast('Гироскоп в этом браузере недоступен'); return; }
    calBegin();
    calDlg.showModal();
  }
  $('#gCalRetry').addEventListener('click', calBegin);
  $('#gCalCancel').addEventListener('click', () => { calStop(); calDlg.close(); });
  $('#gCalStart').addEventListener('click', () => { $('#gSetDlg').close(); calStart(); });

  onTap($('#gMenu'), () => {
    menuMode = !menuMode;
    $('#gMenu').classList.toggle('on', menuMode);
    toast(menuMode ? 'Режим меню: курсор медленный, гироскоп на паузе' : 'Режим игры', 1200);
  });

  // ---------- Настройки ----------
  const SETTINGS = [
    { title: 'Обзор пальцем' },
    { key: 'sens', label: 'Чувствительность', min: 1, max: 100, step: 0.5 },
    { key: 'menuSens', label: 'Чувствительность в меню (🖱)', min: 0.3, max: 10, step: 0.1 },
    { key: 'invertY', label: 'Инвертировать вверх/вниз', check: true },
    { key: 'tapAction', label: 'Тап', select: ACTION_OPTS },
    { key: 'holdAction', label: 'Долгое нажатие (держит)', select: ACTION_OPTS },
    { key: 'doubleHoldAction', label: 'Тап + сразу держать', select: ACTION_OPTS },
    { key: 'holdMs', label: 'Долгое нажатие, мс', min: 120, max: 800, step: 10 },
    { title: 'Гироскоп' },
    { key: 'gyro', label: 'Работает', select: [['Выкл', 0], ['Всегда', 1], ['Пока палец на обзоре', 2]], number: true },
    { key: 'gyroX', label: 'Чувствительность влево/вправо', min: 1, max: 300, step: 1 },
    { key: 'gyroY', label: 'Чувствительность вверх/вниз', min: 1, max: 300, step: 1 },
    { key: 'gyroInvX', label: 'Инвертировать влево/вправо', check: true },
    { key: 'gyroInvY', label: 'Инвертировать вверх/вниз', check: true },
    { key: 'gyroRoll', label: 'Наклон как руль тоже поворачивает', check: true },
    { key: 'gyroDead', label: 'Игнорировать дрожание, °/с', min: 0, max: 10, step: 0.5 },
    { title: 'Джойстик' },
    { key: 'joyMode', label: 'Движение', select: [['Плавное (имитация аналога)', 'smooth'], ['Обычные WASD', 'keys']] },
    { key: 'joyFloat', label: 'Появляется под пальцем', check: true },
    { key: 'joySprint', label: 'Полный наклон вперёд — бег (Ctrl)', check: true },
    { key: 'joySize', label: 'Размер', min: 90, max: 260, step: 5 },
  ];
  const setList = $('#gSetList');
  function renderSettings() {
    setList.innerHTML = '';
    for (const item of SETTINGS) {
      if (item.title) {
        const h = document.createElement('b');
        h.textContent = item.title; h.className = 'gsh';
        setList.appendChild(h);
        continue;
      }
      const row = document.createElement('label');
      const name = document.createElement('span');
      row.appendChild(name);
      let input;
      if (item.check) {
        name.textContent = item.label;
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = G[item.key];
        input.addEventListener('change', () => { G[item.key] = input.checked; applySettings(); });
      } else if (item.select) {
        name.textContent = item.label;
        input = document.createElement('select');
        for (const [l, v] of item.select) {
          const o = document.createElement('option');
          o.textContent = l; o.value = v; o.selected = v === G[item.key];
          input.appendChild(o);
        }
        input.addEventListener('change', () => { G[item.key] = item.number ? +input.value : input.value; applySettings(); });
      } else {
        const paint = () => { name.textContent = `${item.label}: ${G[item.key]}`; };
        paint();
        input = document.createElement('input');
        input.type = 'range';
        input.min = item.min; input.max = item.max; input.step = item.step; input.value = G[item.key];
        input.addEventListener('input', () => { G[item.key] = +input.value; paint(); applySettings(); });
      }
      row.appendChild(input);
      setList.appendChild(row);
    }
  }
  function applySettings() { persist(); placeJoyAtRest(); paintJoy(0, 0); syncGyro(); }
  $('#gButtons').addEventListener('contextmenu', e => e.preventDefault());
  onTap($('#gSettings'), () => { renderSettings(); $('#gSetDlg').showModal(); });
  $('#gSetClose').addEventListener('click', () => $('#gSetDlg').close());

  // ---------- Вход и выход ----------
  async function enter() {
    active = true;
    root.hidden = false;
    menuMode = false;
    $('#gMenu').classList.remove('on');
    renderButtons();
    placeJoyAtRest();
    paintJoy(0, 0);
    syncStatus();
    syncGyro();
    try {
      if (!document.fullscreenElement) { await document.documentElement.requestFullscreen(); wentFullscreen = true; }
      await screen.orientation.lock('landscape');
    } catch (e) { console.warn('orientation', e); }
    keepAwake();
  }
  function exit() {
    if (editing) setEditing(false);
    releaseAll();
    active = false;
    root.hidden = true;
    gyroStop();
    try { screen.orientation.unlock(); } catch (e) {}
    if (wentFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    wentFullscreen = false;
  }
  function syncStatus() { $('#gDot').className = link.ch ? 'on' : ''; }

  $('#gameBtn').addEventListener('click', enter);
  onTap($('#gExit'), exit);
  root.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('visibilitychange', () => { if (active && document.visibilityState !== 'visible') releaseAll(); });

  return {
    linkLost() { releaseAll(false); syncStatus(); },
    linkUp: syncStatus,
    linkReset() { releaseAll(false); },
  };
})();
