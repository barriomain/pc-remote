// Гироскоп: общая настройка осей (человек показывает четыре движения) и «пульт» для обычного режима.
'use strict';
const GyroCal = (() => {
  const AXES = ['alpha', 'beta', 'gamma'];
  const DEG = 30, NOISE = 3, STILL = 25, STILL_MS = 400;
  const cal = { on: false, steps: null, onDone: null, step: 0, phase: 'move', sum: {}, got: {}, last: 0, stillSince: 0 };
  const dlg = $('#gCalDlg');

  const maxSum = () => Math.max(...AXES.map(a => Math.abs(cal.sum[a] || 0)));
  function paint() {
    const s = cal.steps[cal.step];
    $('#gCalIcon').textContent = cal.phase === 'move' ? s.icon : '↩';
    $('#gCalText').textContent = cal.phase === 'move' ? s.text : 'Хорошо. Верни телефон обратно и замри';
    $('#gCalStep').textContent = `Шаг ${cal.step + 1} из ${cal.steps.length}`;
    $('#gCalBar').style.width = (cal.phase === 'move' ? Math.min(1, maxSum() / DEG) : 1) * 100 + '%';
  }

  function onMotion(e) {
    const r = e.rotationRate;
    const dt = cal.last ? Math.min(e.timeStamp - cal.last, 50) / 1000 : 0;
    cal.last = e.timeStamp;
    if (!r || !dt) return;
    if (cal.phase === 'move') {
      for (const a of AXES) if (Math.abs(r[a] || 0) > NOISE) cal.sum[a] = (cal.sum[a] || 0) + r[a] * dt;
      if (maxSum() >= DEG) {
        cal.got[cal.steps[cal.step].id] = { ...cal.sum };
        cal.phase = 'back';
        cal.stillSince = 0;
        vib(30);
      }
    } else {
      const moving = AXES.some(a => Math.abs(r[a] || 0) > STILL);
      if (moving) cal.stillSince = 0;
      else if (!cal.stillSince) cal.stillSince = e.timeStamp;
      else if (e.timeStamp - cal.stillSince >= STILL_MS) {
        cal.step++;
        cal.phase = 'move';
        cal.sum = {};
        if (cal.step === cal.steps.length) { finish(); return; }
      }
    }
    paint();
  }

  // Ось движения — та, что сильнее всех разошлась между двумя противоположными шагами.
  // Шаг с dir -1 двигает мышь влево или вверх, поэтому знак оси обратен их разнице.
  function solve(axis) {
    const of = dir => cal.got[cal.steps.find(s => s.axis === axis && s.dir === dir).id];
    const a = of(-1), b = of(1);
    const best = AXES.map(ax => ({ axis: ax, v: (a[ax] || 0) - (b[ax] || 0) }))
      .reduce((m, d) => (Math.abs(d.v) > Math.abs(m.v) ? d : m));
    return (a[best.axis] || 0) * (b[best.axis] || 0) < 0 ? { axis: best.axis, sign: -Math.sign(best.v) } : null;
  }
  function finish() {
    stop();
    const yaw = solve('yaw'), pitch = solve('pitch');
    if (!yaw || !pitch || yaw.axis === pitch.axis) {
      $('#gCalIcon').textContent = '⚠';
      $('#gCalText').textContent = 'Не удалось разобрать движения. Двигай телефон только в одну сторону за шаг';
      $('#gCalBar').style.width = '0';
      $('#gCalRetry').hidden = false;
      return;
    }
    dlg.close();
    cal.onDone({ yaw, pitch, angle: screen.orientation?.angle ?? 90 });
  }
  function stop() {
    cal.on = false;
    window.removeEventListener('devicemotion', onMotion);
  }
  function begin() {
    Object.assign(cal, { on: true, step: 0, phase: 'move', sum: {}, got: {}, last: 0 });
    $('#gCalRetry').hidden = true;
    window.addEventListener('devicemotion', onMotion);
    paint();
  }
  $('#gCalRetry').addEventListener('click', begin);
  $('#gCalCancel').addEventListener('click', () => { stop(); dlg.close(); });

  return {
    AXES,
    active: () => cal.on,
    start(steps, onDone) {
      if (typeof DeviceMotionEvent === 'undefined') { toast('Гироскоп в этом браузере недоступен'); return; }
      cal.steps = steps; cal.onDone = onDone;
      begin();
      dlg.showModal();
    },
    async permission() {
      if (typeof DeviceMotionEvent === 'undefined') { toast('Гироскоп в этом браузере недоступен'); return false; }
      if (!DeviceMotionEvent.requestPermission) return true;
      try {
        if (await DeviceMotionEvent.requestPermission() === 'granted') return true;
        toast('Нет разрешения на датчики движения');
      } catch (e) {}
      return false;
    },
  };
})();

// Обычный режим: телефон как пульт телевизора. Наклон — вверх и вниз, поворот как руль — влево и вправо.
// Оси считаем от корпуса телефона: если экран сам повернётся от поворота, управление не собьётся.
const AirMouse = (() => {
  const DEFAULT_MAP = { yaw: { axis: 'gamma', sign: -1 }, pitch: { axis: 'alpha', sign: -1 } };
  const STEPS = [
    { id: 'down', axis: 'pitch', dir: 1, icon: '⬇', text: 'Наклони телефон вниз' },
    { id: 'up', axis: 'pitch', dir: -1, icon: '⬆', text: 'Наклони телефон вверх' },
    { id: 'cw', axis: 'yaw', dir: 1, icon: '↻', text: 'Поверни телефон по часовой стрелке, как руль' },
    { id: 'ccw', axis: 'yaw', dir: -1, icon: '↺', text: 'Поверни телефон против часовой стрелки' },
  ];
  const btn = $('#airBtn');
  let on = false, last = 0, rx = 0, ry = 0, gotEvent = false, checkTimer = 0;

  // Пока пишешь текст, открыто окно или игра — курсор стоит
  const paused = () => !link.ch || Game.isActive() || !!document.querySelector('dialog[open]') || isTextField(document.activeElement);

  function onMotion(e) {
    gotEvent = true;
    const r = e.rotationRate;
    const dt = last ? Math.min(e.timeStamp - last, 50) / 1000 : 0;
    last = e.timeStamp;
    if (!r || !dt || paused()) return;
    const map = S.airMap || DEFAULT_MAP;
    const dead = v => (Math.abs(v) < S.airDead ? 0 : v);
    rx += map.yaw.sign * dead(r[map.yaw.axis] || 0) * dt * S.airX;
    ry += map.pitch.sign * dead(r[map.pitch.axis] || 0) * dt * S.airY;
    const ix = Math.trunc(rx), iy = Math.trunc(ry);
    rx -= ix; ry -= iy;
    if (ix || iy) link.move(ix, iy);
  }
  function setOn(v) {
    on = v;
    btn.classList.toggle('on', v);
    clearTimeout(checkTimer);
    window.removeEventListener('devicemotion', onMotion);
    if (!v) return;
    last = 0; gotEvent = false;
    window.addEventListener('devicemotion', onMotion);
    checkTimer = setTimeout(() => {
      if (on && !gotEvent) toast('Гироскоп молчит. Проверь «Датчики движения» в настройках сайта Chrome', 4000);
    }, 2000);
  }
  function calibrate() {
    GyroCal.start(STEPS, map => {
      S.airMap = map;
      save();
      setOn(true);
      toast('Гироскоп настроен', 1500);
    });
  }
  btn.addEventListener('click', async () => {
    vib(10);
    if (on) { setOn(false); toast('Гироскоп выключен', 900); return; }
    if (!await GyroCal.permission()) return;
    setOn(true);
    if (S.airMap) toast('Гироскоп включён', 900); else calibrate();
  });
  $('#sAirCal').addEventListener('click', () => {
    $('#closeSettings').click();
    calibrate();
  });
})();
