// Язык скриптов: одна команда на строку. Разбор в список операций и выполнение через ESP.
'use strict';
const Script = (() => {
  const KEYS = {
    enter: 0x28, return: 0x28, esc: 0x29, escape: 0x29, backspace: 0x2A, bksp: 0x2A, tab: 0x2B, space: 0x2C,
    caps: 0x39, capslock: 0x39, prtsc: 0x46, printscreen: 0x46, scrolllock: 0x47, pause: 0x48,
    ins: 0x49, insert: 0x49, home: 0x4A, pgup: 0x4B, pageup: 0x4B, del: 0x4C, delete: 0x4C, end: 0x4D,
    pgdn: 0x4E, pagedown: 0x4E, right: 0x4F, left: 0x50, down: 0x51, up: 0x52, numlock: 0x53, menu: 0x65,
    ctrl: 0xE0, control: 0xE0, lctrl: 0xE0, shift: 0xE1, lshift: 0xE1, alt: 0xE2, lalt: 0xE2, win: 0xE3, gui: 0xE3, lwin: 0xE3,
    rctrl: 0xE4, rshift: 0xE5, ralt: 0xE6, altgr: 0xE6, rwin: 0xE7,
    // по-русски
    ввод: 0x28, энтер: 0x28, эск: 0x29, таб: 0x2B, пробел: 0x2C, удалить: 0x4C, вверх: 0x52, вниз: 0x51, влево: 0x50, вправо: 0x4F,
    вин: 0xE3, контрол: 0xE0, ктрл: 0xE0, шифт: 0xE1, альт: 0xE2,
  };
  for (let i = 1; i <= 12; i++) KEYS['f' + i] = 0x3A + i - 1;

  const MEDIA = { play: 0xCD, pause: 0xCD, stop: 0xB7, next: 0xB5, prev: 0xB6, volup: 0xE9, voldown: 0xEA, mute: 0xE2 };
  const CMD_ALIASES = {
    пиши: 'type', текст: 'type', строка: 'line', сырой: 'raw', жди: 'wait', пауза: 'wait', нажми: 'press', зажми: 'hold',
    отпусти: 'release', повтор: 'repeat', конец: 'end', клик: 'click', лкм: 'click', пкм: 'rclick', скм: 'mclick',
    двойной: 'dblclick', двигай: 'move', колесо: 'scroll', медиа: 'media', язык: 'lang',
  };

  // Кириллическая буква — та же физическая клавиша, что и в раскладке ЙЦУКЕН
  function keyCode(name) {
    const n = name.toLowerCase();
    if (KEYS[n] !== undefined) return KEYS[n];
    if ([...n].length !== 1) return undefined;
    const direct = charCode(n);
    if (direct !== undefined) return direct;
    const latin = Object.keys(RU_LABEL).find(k => RU_LABEL[k] === n);
    return latin === undefined ? undefined : charCode(latin);
  }

  // 'ctrl+shift+t' -> коды клавиш; undefined, если что-то не клавиша
  function parseCombo(spec) {
    const codes = spec.split('+').map(keyCode);
    return codes.length && codes.every(c => c !== undefined) ? codes : undefined;
  }

  const SHIFTED = '!@#$%^&*()_+{}|:"<>?~', PLAIN = "1234567890-=[]\\;',./`";
  function rawKey(c) {
    if (c === ' ') return [0x2C, false];
    if (c >= 'A' && c <= 'Z') return [charCode(c.toLowerCase()), true];
    const i = SHIFTED.indexOf(c);
    if (i >= 0) return [charCode(PLAIN[i]), true];
    const code = charCode(c);
    return code === undefined ? null : [code, false];
  }

  function parseWait(arg) {
    const m = /^(\d+(?:[.,]\d+)?)\s*(ms|мс|s|с|сек)?$/i.exec(arg);
    if (!m) return null;
    const v = parseFloat(m[1].replace(',', '.'));
    const ms = m[2] && !/^(ms|мс)$/i.test(m[2]) ? v * 1000 : v;
    return ms <= 600000 ? Math.round(ms) : null;
  }

  const MAX_OPS = 20000;

  function parse(src) {
    const root = [];
    const stack = [{ body: root, line: 0 }];
    const lines = src.split(/\r?\n/);
    const fail = (ln, msg) => { const e = new Error(msg); e.line = ln + 1; throw e; };
    lines.forEach((rawLine, ln) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) return;
      const sp = line.search(/\s/);
      const word = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
      const cmd = CMD_ALIASES[word] || word;
      // текст берём из исходной строки: пробелы в конце тоже важны
      const rest = sp < 0 ? '' : rawLine.trimStart().slice(sp + 1);
      const arg = rest.trim();
      const body = stack[stack.length - 1].body;
      const combos = s => s.split(/\s+/).map(tok => {
        const codes = parseCombo(tok);
        if (!codes) fail(ln, `не знаю клавишу «${tok}». Текст пиши так: type ${line}`);
        return { k: 'combo', codes };
      });
      const num = (s, what) => {
        if (!/^-?\d+$/.test(s || '')) fail(ln, `${word}: нужно число — ${what}`);
        return parseInt(s, 10);
      };
      switch (cmd) {
        case 'type': case 'line': {
          if (!rest && cmd === 'type') fail(ln, 'type: после команды нужен текст');
          body.push({ k: 'text', s: cmd === 'line' ? rest + '\n' : rest });
          break;
        }
        case 'raw': {
          if (!rest) fail(ln, 'raw: после команды нужен текст');
          for (const c of rest) if (!rawKey(c)) fail(ln, `raw умеет только английские символы, а тут «${c}»`);
          body.push({ k: 'raw', s: rest });
          break;
        }
        case 'wait': {
          const ms = parseWait(arg);
          if (ms === null) fail(ln, 'wait: нужно время, например wait 500 или wait 2s (до 10 минут)');
          body.push({ k: 'wait', ms });
          break;
        }
        case 'press':
          if (!arg) fail(ln, 'press: какую клавишу нажать?');
          body.push(...combos(arg));
          break;
        case 'hold': case 'release': {
          const codes = parseCombo(arg);
          if (!codes) fail(ln, `${word}: не знаю клавишу «${arg}»`);
          for (const code of codes) body.push({ k: cmd === 'hold' ? 'down' : 'up', code });
          break;
        }
        case 'repeat': {
          const n = num(arg, 'сколько раз');
          if (n < 1) fail(ln, 'repeat: нужно число больше нуля');
          const op = { k: 'repeat', n, body: [] };
          body.push(op);
          stack.push({ body: op.body, line: ln });
          break;
        }
        case 'end':
          if (stack.length === 1) fail(ln, 'end без repeat');
          stack.pop();
          break;
        case 'click': body.push({ k: 'click', mask: BTN.L }); break;
        case 'rclick': body.push({ k: 'click', mask: BTN.R }); break;
        case 'mclick': body.push({ k: 'click', mask: BTN.M }); break;
        case 'dblclick':
          body.push({ k: 'click', mask: BTN.L }, { k: 'wait', ms: 60 }, { k: 'click', mask: BTN.L });
          break;
        case 'move': {
          const [x, y] = arg.split(/\s+/);
          body.push({ k: 'move', dx: num(x, 'сдвиг по X'), dy: num(y, 'сдвиг по Y') });
          break;
        }
        case 'scroll': body.push({ k: 'scroll', n: num(arg, 'на сколько щелчков') }); break;
        case 'media': {
          const u = MEDIA[arg.toLowerCase()];
          if (!u) fail(ln, `media: бывает ${Object.keys(MEDIA).join(', ')}`);
          body.push({ k: 'media', u });
          break;
        }
        case 'lang': {
          const v = { en: 0, ru: 1 }[arg.toLowerCase()];
          if (v === undefined) fail(ln, 'lang: нужно en или ru');
          body.push({ k: 'lang', v });
          break;
        }
        default:
          body.push(...combos(line));
      }
    });
    if (stack.length > 1) fail(stack[stack.length - 1].line, 'repeat без end');

    const ops = [];
    const flatten = list => {
      for (const op of list) {
        if (op.k !== 'repeat') {
          ops.push(op);
          if (ops.length > MAX_OPS) { const e = new Error(`слишком много действий (больше ${MAX_OPS})`); e.line = 0; throw e; }
        } else for (let i = 0; i < op.n; i++) flatten(op.body);
      }
    };
    flatten(root);
    return ops;
  }

  const SYNC_EVERY = 200;  // байт команд между подтверждениями, чтобы не переполнить очередь ESP
  const BASE_TIMEOUT = 15000;
  let running = false, stopped = false, wake = null;

  const sleep = ms => new Promise(res => {
    const t = setTimeout(() => { wake = null; res(); }, ms);
    wake = () => { clearTimeout(t); wake = null; res(); };
  });

  async function run(ops, onProgress) {
    if (running) return false;
    if (!link.ch) throw new Error('Сначала подключись к ESP');
    running = true; stopped = false;
    let pending = 0;
    const held = new Set();
    const emit = (...bytes) => { link.cmd(...bytes); pending += bytes.length; };
    const pause = ms => emit(C.DELAY, ms & 255, ms >> 8);
    const flush = async () => {
      if (pending) { pending = 0; await link.sync(BASE_TIMEOUT); }
      if (stopped) throw new Error('stopped');
    };
    try {
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        onProgress?.(i, ops.length);
        switch (op.k) {
          case 'combo':
            for (const c of op.codes) emit(C.KEY_DOWN, c);
            pause(30);
            for (const c of [...op.codes].reverse()) emit(C.KEY_UP, c);
            pause(30);
            break;
          case 'down': emit(C.KEY_DOWN, op.code); held.add(op.code); break;
          case 'up': emit(C.KEY_UP, op.code); held.delete(op.code); break;
          case 'text': {
            await flush();
            link.text(op.s);
            // Alt-код — это примерно 12 нажатий на символ
            await link.sync(BASE_TIMEOUT + [...op.s].length * S.typeDelay * 24);
            break;
          }
          case 'raw':
            for (const c of op.s) {
              const [code, shift] = rawKey(c);
              if (shift) emit(C.KEY_DOWN, 0xE1);
              emit(C.KEY_DOWN, code);
              pause(S.typeDelay);
              emit(C.KEY_UP, code);
              if (shift) emit(C.KEY_UP, 0xE1);
              pause(S.typeDelay);
              if (pending >= SYNC_EVERY) await flush();
            }
            break;
          case 'wait':
            await flush();
            await sleep(op.ms);
            break;
          case 'click': emit(C.CLICK, op.mask); break;
          case 'move':
            link.move(op.dx, op.dy);
            pending += 3 * (Math.ceil(Math.max(Math.abs(op.dx), Math.abs(op.dy)) / 127) + 1);
            break;
          case 'scroll': link.wheel(op.n, 0); pending += 3; break;
          case 'media': emit(C.MEDIA, op.u & 255, op.u >> 8); break;
          case 'lang': emit(C.LAYOUT, op.v); pause(100); break;
        }
        if (pending >= SYNC_EVERY) await flush();
        if (stopped) throw new Error('stopped');
      }
      for (const c of held) emit(C.KEY_UP, c);  // забытый hold не должен залипнуть
      await flush();
      return true;
    } catch (e) {
      if (stopped) return false;
      link.abort();
      throw e;
    } finally {
      running = false;
    }
  }

  function stop() {
    if (!running) return;
    stopped = true;
    if (wake) wake();
    link.abort();
  }

  return { parse, parseCombo, run, stop, get running() { return running; } };
})();
