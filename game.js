// Игровой режим: джойстик слева, обзор пальцем справа, настраиваемые кнопки, гироскоп.
'use strict';
const Game = (() => {
  const GAME_DEFAULTS = {
    sens: 8, menuSens: 1.5, invertY: false,
    tapAction: 'lmb', holdAction: 'rmb', doubleHoldAction: 'lmb', holdMs: 300,
    gyro: 0, gyroX: 30, gyroY: 30, gyroInvX: false, gyroInvY: false, gyroRoll: false, gyroDead: 1,
    joyFloat: true, joySprint: true, joySize: 150, joyX: 16, joyY: 70,
    buttons: null,
  };
  const DEFAULT_BUTTONS = [
    { label: '⬆', action: 'space', x: 91, y: 62, size: 76 },
    { label: '⬇', action: 'shift', x: 91, y: 86, size: 76 },
    { label: '⚔', action: 'lmb', x: 77, y: 84, size: 68 },
    { label: '✋', action: 'rmb', x: 66, y: 88, size: 60 },
    { label: 'E', action: 'e', x: 96, y: 24, size: 48 },
    { label: 'Q', action: 'q', x: 88, y: 24, size: 48 },
    { label: 'Esc', action: 'esc', x: 5, y: 16, size: 46 },
    { label: '◀', action: 'wheelup', x: 42, y: 92, size: 46 },
    { label: '▶', action: 'wheeldown', x: 52, y: 92, size: 46 },
    { label: 'F5', action: 'f5', x: 80, y: 24, size: 48 },
  ];
  const ACTION_OPTS = [['ЛКМ', 'lmb'], ['ПКМ', 'rmb'], ['Ничего', 'none']];
  const MOUSE = { lmb: BTN.L, rmb: BTN.R, mmb: BTN.M };
  const WHEEL = { wheelup: 1, wheeldown: -1 };
  const WASD = { w: 0x1A, a: 0x04, s: 0x16, d: 0x07, sprint: 0xE0 };
  const TAP_MS = 220, MOVE_TOL = 10, DOUBLE_MS = 300, JOY_DEAD = 0.25, JOY_AXIS = 0.38, JOY_SPRINT = 0.95;

  const G = { ...GAME_DEFAULTS, ...S.game };
  if (!Array.isArray(G.buttons)) G.buttons = DEFAULT_BUTTONS.map(b => ({ ...b }));
  const persist = () => { S.game = G; save(); };

  const root = $('#game'), surface = $('#gSurface'), layer = $('#gButtons'), joyBase = $('#gJoy'), joyNub = $('#gNub');
  let active = false, editing = false, menuMode = false, wentFullscreen = false;
  const down = new Map();  // код клавиши/кнопки мыши -> сколько источников держат

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
    for (const c of Script.parseCombo(action) || []) press('k', c);
  }
  function actionUp(action) {
    if (MOUSE[action]) { release('m', MOUSE[action]); return; }
    if (action === 'none' || WHEEL[action]) return;
    for (const c of [...(Script.parseCombo(action) || [])].reverse()) release('k', c);
  }
  const validAction = a => a === 'none' || !!MOUSE[a] || !!WHEEL[a] || !!Script.parseCombo(a);

  function releaseAll(notify = true) {
    for (const [id] of down) {
      const code = +id.slice(1);
      if (notify) link.cmd(id[0] === 'm' ? C.BTN_UP : C.KEY_UP, code);
    }
    down.clear();
    joy.id = look.id = null;
    joy.keys.clear();
    clearTimeout(look.timer);
    look.heldAction = null;
    layer.querySelectorAll('.gb').forEach(b => { b.classList.remove('dn'); b._toggled = false; });
    paintJoy(0, 0);
  }

  // ---------- Джойстик ----------
  const joy = { id: null, cx: 0, cy: 0, keys: new Set() };

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
    setJoyKey('w', live && uy < -JOY_AXIS);
    setJoyKey('s', live && uy > JOY_AXIS);
    setJoyKey('a', live && ux < -JOY_AXIS);
    setJoyKey('d', live && ux > JOY_AXIS);
    setJoyKey('sprint', G.joySprint && !menuMode && mag >= JOY_SPRINT && uy < -JOY_AXIS);
  }
  function joyEnd() {
    joy.id = null;
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
      if (!editing || !drag) return;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
      if (!drag.moved) return;
      cfg.x = Math.max(0, Math.min(100, e.clientX / innerWidth * 100));
      cfg.y = Math.max(0, Math.min(100, e.clientY / innerHeight * 100));
      b.style.left = cfg.x + '%';
      b.style.top = cfg.y + '%';
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
    btnDlg.showModal();
  }
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
  $('#gEdit').addEventListener('click', () => setEditing(!editing));
  $('#gAdd').addEventListener('click', () => {
    const cfg = { label: 'R', action: 'r', x: 50, y: 40, size: 56 };
    G.buttons.push(cfg);
    persist(); renderButtons(); openButtonDialog(cfg);
  });
  $('#gReset').addEventListener('click', () => {
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
    if (!active || editing || menuMode) return false;
    return G.gyro === 1 || (G.gyro === 2 && look.id !== null);
  }
  function onMotion(e) {
    gyro.gotEvent = true;
    const r = e.rotationRate;
    const now = e.timeStamp;
    const dt = gyro.last ? Math.min(now - gyro.last, 50) / 1000 : 0;
    gyro.last = now;
    if (!r || !dt || !gyroWanted()) return;
    // Оси телефона в горизонтальном положении: beta — поворот влево/вправо, gamma — наклон вверх/вниз,
    // alpha — наклон как руль. angle 90 и 270 — две стороны горизонтального положения.
    const flip = (screen.orientation?.angle ?? 90) === 270 ? -1 : 1;
    const dead = v => (Math.abs(v) < G.gyroDead ? 0 : v);
    let yaw = -flip * dead(r.beta || 0);
    if (G.gyroRoll) yaw -= dead(r.alpha || 0);
    const pitch = flip * dead(r.gamma || 0);
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
  $('#gGyro').addEventListener('click', () => {
    G.gyro = G.gyro ? 0 : 1;
    persist(); syncGyro();
    toast(G.gyro ? 'Гироскоп включён' : 'Гироскоп выключен', 900);
  });

  $('#gMenu').addEventListener('click', () => {
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
  $('#gSettings').addEventListener('click', () => { renderSettings(); $('#gSetDlg').showModal(); });
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
  $('#gExit').addEventListener('click', exit);
  root.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('visibilitychange', () => { if (active && document.visibilityState !== 'visible') releaseAll(); });

  return {
    linkLost() { releaseAll(false); syncStatus(); },
    linkUp: syncStatus,
    linkReset() { releaseAll(false); },
  };
})();
