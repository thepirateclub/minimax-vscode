// CDP driver for the live check of the panel.
//   node cdp.mjs targets
//   node cdp.mjs eval <title filter> <javascript>
//   node cdp.mjs shot <title filter> <file>
//   node cdp.mjs key <title filter> <key> <code> <vk> <modifiers>
//   node cdp.mjs text <title filter> <text>
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:' + (process.env.CDP_PORT ?? '9222');

async function listTargets() {
  const res = await fetch(BASE + '/json');
  return await res.json();
}

function pickTarget(list, filter) {
  const f = filter.toLowerCase();
  return list.find(
    (t) =>
      (t.title || '').toLowerCase().includes(f) ||
      (t.url || '').toLowerCase().includes(f)
  );
}

function connect(target) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => {
      const send = (method, params = {}) =>
        new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, (msg) =>
            msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
          );
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      resolve({ ws, send });
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    ws.onerror = () => reject(new Error('websocket error'));
  });
}

const [action, ...args] = process.argv.slice(2);
const list = await listTargets();
if (action === 'targets') {
  console.log(
    JSON.stringify(
      list.map((t) => ({ type: t.type, title: t.title, url: (t.url || '').slice(0, 90) })),
      null,
      1
    )
  );
  process.exit(0);
}
const filter = args[0] ?? '';
const target = pickTarget(list, filter);
if (!target) {
  console.log('NO_TARGET:' + filter);
  process.exit(2);
}
const { ws, send } = await connect(target);
if (action === 'eval') {
  const expression = args.slice(1).join(' ');
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (r.exceptionDetails) {
    console.log('EXCEPTION ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
  }
  console.log(JSON.stringify(r.result?.value ?? null));
} else if (action === 'shot') {
  await send('Page.enable');
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(args[1], Buffer.from(r.data, 'base64'));
  console.log('SAVED ' + args[1]);
} else if (action === 'key') {
  const [key, code, vk, mods] = args.slice(1);
  const base = {
    key,
    code,
    windowsVirtualKeyCode: Number(vk),
    nativeVirtualKeyCode: Number(vk),
    modifiers: Number(mods ?? 0)
  };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  console.log('KEY_SENT');
} else if (action === 'text') {
  await send('Input.insertText', { text: args.slice(1).join(' ') });
  console.log('TEXT_SENT');
}
ws.close();
process.exit(0);
