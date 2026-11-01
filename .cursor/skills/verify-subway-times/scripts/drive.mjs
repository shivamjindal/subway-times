#!/usr/bin/env node
// Drive subway-times in headless Chrome over CDP, the way a user would, and write evidence.
// Zero dependencies: Node 22's global WebSocket talks to Chrome's DevTools protocol.
//
//   node .cursor/skills/verify-subway-times/scripts/drive.mjs <journey> [--port 3100] [--out DIR]
//
// Journeys: ready | map | search | closeup | feedback
// Evidence: $EVIDENCE_ROOT (default /opt/cursor/artifacts/verify-subway-times)/<journey>-<UTC stamp>/
//   *.png screenshots, report.json (every check, pass/fail), network.json (/api/* traffic), console.json.
// Exit code 1 if any check fails. Chrome is started per run and always killed before exit.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const journey = args[0];
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(arg('--port', '3100'));
const stateDir = path.join(process.env.VERIFY_STATE_ROOT ?? '/tmp/verify-subway-times', String(port));
const state = existsSync(path.join(stateDir, 'state.json')) ? JSON.parse(readFileSync(path.join(stateDir, 'state.json'), 'utf8')) : null;
const base = `http://localhost:${port}`;
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
const out = arg('--out', path.join(process.env.EVIDENCE_ROOT ?? '/opt/cursor/artifacts/verify-subway-times', `${journey}-${stamp}`));
const CHROME = process.env.CHROME_BIN ?? 'google-chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const JOURNEYS = { ready, map, search, 'search-shots': searchShots, closeup, 'card-closeup': cardCloseup, feedback };
if (!JOURNEYS[journey]) {
  console.error(`usage: drive.mjs <${Object.keys(JOURNEYS).join('|')}> [--port N] [--out DIR]`);
  process.exit(2);
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` · ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  return Boolean(ok);
}

// ---------- Chrome + CDP ----------
async function startChrome() {
  const profile = path.join(stateDir, `chrome-${process.pid}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1440,1000',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      'about:blank',
    ],
    { stdio: 'ignore', detached: true }
  );
  writeFileSync(path.join(profile, 'chrome.pid'), String(chrome.pid));
  let wsPort;
  for (let i = 0; i < 100 && !wsPort; i++) {
    await sleep(100);
    const file = path.join(profile, 'DevToolsActivePort');
    if (existsSync(file)) wsPort = readFileSync(file, 'utf8').split('\n')[0];
  }
  if (!wsPort) throw new Error('Chrome did not open a DevTools port');
  const targets = await (await fetch(`http://127.0.0.1:${wsPort}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const kill = () => {
    try {
      process.kill(-chrome.pid, 'SIGKILL');
    } catch {}
    rmSync(profile, { recursive: true, force: true });
  };
  return { ws: page.webSocketDebuggerUrl, kill };
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return new Promise((resolve) => (ws.onopen = () => resolve({ send, on: (l) => listeners.push(l), close: () => ws.close() })));
}

// ---------- page helpers ----------
let cdp;
const network = [];
const consoleLog = [];

async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(name, expression, timeoutMs = 30000) {
  const start = Date.now();
  let value;
  while (Date.now() - start < timeoutMs) {
    // DOM nodes don't survive returnByValue, so report "found" as true.
    value = await evaluate(`(() => { const v = (${expression}); return v instanceof Node ? true : v; })()`).catch(() => undefined);
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${name}`);
}

async function goto(route) {
  await cdp.send('Page.navigate', { url: `${base}${route}` });
  await waitFor(`load ${route}`, `document.readyState === 'complete' && location.pathname === ${JSON.stringify(route.split('?')[0])}`, 120000);
}

/** Element finder used inside the page: CSS selector, optionally narrowed to elements whose text includes `text`. */
const find = (css, text) =>
  `[...document.querySelectorAll(${JSON.stringify(css)})].find((el) => ${text === undefined ? 'true' : `el.textContent.includes(${JSON.stringify(text)})`})`;

/** Real pointer input at the element's centre, so React sees the same events a user's click produces. */
async function click(label, css, text) {
  const rect = await waitFor(
    label,
    `(() => { const el = ${find(css, text)}; if (!el || el.disabled) return null; el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect(); return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`
  );
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  }
}

async function type(text) {
  await cdp.send('Input.insertText', { text });
}

async function press(key) {
  const { code, vk, text } = { Enter: { code: 'Enter', vk: 13, text: '\r' }, Escape: { code: 'Escape', vk: 27 }, Tab: { code: 'Tab', vk: 9 }, ' ': { code: 'Space', vk: 32, text: ' ' } }[key];
  for (const t of ['keyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', { type: t, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(t === 'keyDown' && text ? { text } : {}) });
  }
}

/** The cloud artifacts mount occasionally fails a write with EIO; retry before giving up on evidence. */
async function writeEvidence(file, data) {
  for (let attempt = 1; ; attempt++) {
    try {
      writeFileSync(file, data);
      return;
    } catch (error) {
      if (error.code !== 'EIO' || attempt === 5) throw error;
      await sleep(200 * attempt);
    }
  }
}

async function shot(name, clip) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip && { clip: { ...clip, scale: 1 } }) });
  const file = path.join(out, `${name}.png`);
  await writeEvidence(file, Buffer.from(data, 'base64'));
  console.log(`  screenshot ${file}`);
  return file;
}

const MAP_IMG = `document.querySelector('[role=img][aria-label^="3D network of NYC subway spaceports"]')`;
const mapRockets = `(() => { const m = ${MAP_IMG}?.getAttribute('aria-label').match(/with (\\d+) rockets/); return m ? Number(m[1]) : 0; })()`;

/** The map is usable when the scene's canvas exists, the fleet has rockets, and the ticker shows them. */
async function waitForMap() {
  const rockets = await waitFor('rockets on the map', `${MAP_IMG}?.querySelector('canvas') && ${mapRockets} > 0 && document.querySelector('[data-testid=network-ticker]') && ${mapRockets}`, 120000);
  check('map canvas mounted with rockets', rockets > 0, `${rockets} rockets`);
  const ticker = await evaluate(`document.querySelector('[data-testid=network-ticker]').textContent`);
  check('network ticker live', /in flight/.test(ticker), ticker);
  return rockets;
}

function lastResponse(urlPart) {
  return [...network].reverse().find((n) => n.url.includes(urlPart) && n.status);
}

async function waitForResponse(urlPart, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = lastResponse(urlPart);
    if (hit) return hit;
    await sleep(250);
  }
  return null;
}

// ---------- journeys ----------
async function ready() {
  await goto('/?perf=1');
  await waitForMap();
  // ?perf=1 publishes the renderer's own frame stats: proof frames are drawing rockets, not just that the DOM exists.
  const perf = await waitFor('rendered frames with visible rockets', `(() => { const p = window.__spaceNetworkPerf; return p && p.fps > 0 && p.visible > 0 ? p : null; })()`, 60000);
  check('renderer drawing rockets', perf.visible > 0 && perf.fps > 0, `${perf.fps} FPS · ${perf.visible}/${perf.total} rockets visible · ${perf.drawCalls} draws`);
  await shot('ready');
}

async function map() {
  await goto('/');
  const rockets = await waitForMap();
  const api = lastResponse('/api/train-positions');
  check('map fed by /api/train-positions', api?.status === 200, api && `${api.status} ${api.url}`);
  const trains = await evaluate(`fetch('/api/train-positions').then((r) => r.json()).then((j) => ({ n: j.trains.length, failed: j.failedFeeds, mock: j.trains.some((t) => t.id.startsWith('MOCK_')) }))`);
  check('rocket count tracks train count', Math.abs(rockets - trains.n) <= Math.max(25, trains.n * 0.2), `${rockets} rockets vs ${trains.n} trains now (${trains.mock ? 'mock' : 'live'} feed, ${trains.failed} feeds failed)`);
  await shot('map-overview');
  await click('Collapse button', 'button[aria-controls=orbital-map-body]');
  await waitFor('map collapsed', `!document.getElementById('orbital-map-body') && localStorage.getItem('orbitalMapOpen') === 'false'`);
  check('collapse hides the map and is remembered', true, 'orbitalMapOpen=false');
  await shot('map-collapsed');
  await click('Open network button', 'button[aria-controls=orbital-map-body]', 'Open network');
  const reopened = await waitFor(
    'map or fallback after reopening',
    `${mapRockets} > 0 && ${MAP_IMG}?.querySelector('canvas') ? 'rockets' : (() => { const s = ${find('#orbital-map-body [role=status]', '3D network unavailable')}; return s ? s.querySelector('p').textContent : null; })()`,
    120000
  );
  await shot('map-reopened');
  check('map reopens with rockets', reopened === 'rockets', reopened);
}

async function addTimesSq() {
  await click('station search', '#station-search');
  await type('Times Sq');
  await waitFor('Times Sq suggestion', `${find('form button', 'Times Sq-42 St')}`);
  await shot('search-suggestions');
  await press('Enter');
  await waitFor('Times Sq chip', `document.querySelector('[aria-label="Remove Times Sq-42 St"]')`);
  const saved = await evaluate(`localStorage.getItem('selectedStations')`);
  check('Enter locks the first Times Sq result', /"127"/.test(saved ?? ''), saved);
  const card = await waitFor('Times Sq station card with arrivals', `(() => { const h = ${find('h2', 'Times Sq-42 St')}; return h ? h.textContent : null; })()`, 60000);
  check('station card shows Times Sq-42 St', card === 'Times Sq-42 St', card);
  const api = await waitForResponse('/api/subway-times?stations=127');
  check('/api/subway-times?stations=127 answered', api?.status === 200 && /stations=127/.test(api.url), api && `${api.status} ${api.url}`);
}

async function search() {
  await goto('/');
  await evaluate(`localStorage.removeItem('selectedStations'); true`);
  await goto('/');
  await waitFor('search box', `document.querySelector('#station-search')`);
  await addTimesSq();
  await shot('search-tracked');
  await goto('/');
  await waitFor('Times Sq chip after reload', `document.querySelector('[aria-label="Remove Times Sq-42 St"]')`, 30000);
  check('tracked station survives reload', true);
  await click('remove Times Sq chip', '[aria-label="Remove Times Sq-42 St"]');
  await waitFor('chip removed', `!document.querySelector('[aria-label="Remove Times Sq-42 St"]')`);
  check('removing the chip untracks it', !/"127"/.test((await evaluate(`localStorage.getItem('selectedStations')`)) ?? ''));
}

/** Screenshots of the suggestion list for each query in SHOT_QUERIES ("tag=query;tag=query"). */
async function searchShots() {
  const queries = (process.env.SHOT_QUERIES ?? 'times=Times Sq').split(';').map((q) => q.split('='));
  await goto('/');
  await evaluate(`localStorage.removeItem('selectedStations'); true`);
  await goto('/');
  await waitFor('search box', `document.querySelector('#station-search')`);
  for (const [tag, query] of queries) {
    await click('station search', '#station-search');
    await evaluate(`document.querySelector('#station-search').select(); true`);
    await type(query);
    await sleep(600);
    await evaluate(`document.querySelector('#station-search').scrollIntoView({ block: 'start' }); window.scrollBy(0, -40); true`);
    await sleep(300);
    await shot(`search-${tag}`);
  }
}

async function closeup() {
  await goto('/');
  await evaluate(`localStorage.removeItem('selectedStations'); true`);
  await goto('/');
  await waitForMap();
  await addTimesSq();
  await click('Tracked spaceports: Times Sq-42 St', 'button[aria-pressed]', 'Times Sq-42 St');
  await waitFor('Target locked readout', `${find('h3', 'Times Sq-42 St')}`);
  await shot('closeup-target-locked');
  await click('Enter spaceport', 'button', 'Enter spaceport');
  const title = await waitFor('close-up dialog', `document.querySelector('dialog[open] #spaceport-title')?.textContent`, 60000);
  check('close-up dialog open for Times Sq-42 St', title === 'Times Sq-42 St', title);
  const padCount = await evaluate(`document.querySelector('[data-testid=pad-count]').textContent`);
  const manifestPads = await evaluate(`document.querySelectorAll('[data-testid=pad-manifest] [data-pad]').length`);
  // Times Sq has 10 platforms; pads split further per NYCT track when the feed carries tracks (live usually does).
  check('every platform listed as a pad', Number(padCount.match(/^(\d+) pad/)?.[1]) >= 10 && manifestPads === 10, `${padCount} · ${manifestPads} manifest rows`);
  const scene = await waitFor('close-up scene', `document.querySelector('dialog[open] [role=img][aria-label^="Close-up of the Times Sq-42 St spaceport"]')?.querySelector('canvas') && document.querySelector('[data-testid=pad-phase]')?.textContent`, 60000);
  check('close-up scene rendering', Boolean(scene), scene);
  const first = await evaluate(`({ phase: document.querySelector('[data-testid=pad-phase]').textContent, manifest: document.querySelector('[data-testid=pad-manifest]').innerText })`);
  const events = (first.manifest.match(/\d{1,2}:\d{2}|T[−-]/g) ?? []).length;
  check('manifest lists landings or launches', events > 0 || /nothing inbound/i.test(await evaluate('document.body.innerText')), `${events} timed entries`);
  await shot('closeup-live');
  await sleep(8000);
  const later = await evaluate(`({ phase: document.querySelector('[data-testid=pad-phase]').textContent, countdowns: [...document.querySelectorAll('dialog[open] aside .grid > *')].map((e) => e.innerText.replace(/\\s+/g, ' ')) })`);
  check('live apron state after 8 s', Boolean(later.phase), later);
  await shot('closeup-live-8s');
  await click('Replay', 'dialog[open] button[aria-pressed]', 'Replay');
  await waitFor('replay mode', `${find('dialog[open] [role=status] span', 'Replay')}`);
  check('Replay switches the close-up to replay', true);
  await sleep(4000);
  await shot('closeup-replay');
  await click('Close spaceport', 'dialog[open] [aria-label="Close spaceport"]');
  await waitFor('dialog closed', `!document.querySelector('dialog[open]')`);
  check('close button dismisses the close-up', true);
}

/** Track a station by search, clicking the suggestion whose text (name + lines) matches, e.g. "7 AvLock target ↵BDE". */
async function trackStation(query, suggestionText, name) {
  await click('station search', '#station-search');
  await evaluate(`document.querySelector('#station-search').select(); true`);
  await type(query);
  await waitFor(`${name} suggestion`, `${find('form button', suggestionText)}`);
  await click(`${name} suggestion`, 'form button', suggestionText);
  await waitFor(`${name} chip`, `document.querySelector('[aria-label="Remove ${name}"]')`);
  await waitFor(`${name} station card`, `${find('section.hud-panel h2', name)}`, 60000);
}

// `open` drops synchronously on close, but the `close` event that unmounts the close-up fires a task later.
const CLOSEUP_GONE = `!document.querySelector('#spaceport-title')`;
const cardButton = (name) => `[aria-label="Enter spaceport: ${name}"]`;

async function assertCloseup(label, title, stationsWith) {
  const got = await waitFor('close-up dialog', `document.querySelector('dialog[open] #spaceport-title')?.textContent`, 60000);
  check(`${label}: close-up opens on ${title}`, got === title, got);
  if (stationsWith) {
    const others = await evaluate(`document.querySelector('dialog[open] #spaceport-title').nextElementSibling?.textContent ?? ''`);
    check(`${label}: complex lists ${stationsWith}`, others.includes(stationsWith), others);
  }
  const pads = await evaluate(`({ count: document.querySelector('[data-testid=pad-count]').textContent, rows: document.querySelectorAll('[data-testid=pad-manifest] [data-pad]').length })`);
  check(`${label}: pads listed`, pads.rows > 0 && Number(pads.count.match(/^(\d+) pad/)?.[1]) >= pads.rows, pads);
  const scene = await waitFor('close-up scene', `document.querySelector('dialog[open] [role=img][aria-label^="Close-up of the ${title} spaceport"]')?.querySelector('canvas') && document.querySelector('[data-testid=pad-phase]')?.textContent`, 60000);
  check(`${label}: scene rendering`, Boolean(scene), scene);
  const manifest = await evaluate(`document.querySelector('[data-testid=pad-manifest]').innerText`);
  const events = (manifest.match(/T[−-]|\d{1,2}:\d{2}/g) ?? []).length;
  check(`${label}: manifest has live traffic`, events > 0 || /nothing inbound/i.test(await evaluate('document.body.innerText')), `${events} timed entries`);
}

async function cardCloseup() {
  await goto('/');
  await evaluate(`localStorage.removeItem('selectedStations'); localStorage.removeItem('orbitalMapOpen'); true`);
  await goto('/');
  await waitForMap();
  await trackStation('7 Av', '7 AvLock target ↵BDE', '7 Av');
  await trackStation('42 St-Port', '42 St-Port Authority', '42 St-Port Authority Bus Terminal');
  const saved = await evaluate(`localStorage.getItem('selectedStations')`);
  check('both stations tracked', /"D14"/.test(saved ?? '') && /"A27"/.test(saved ?? ''), saved);
  const cards = await evaluate(`[...document.querySelectorAll('section.hud-panel')].filter((s) => s.querySelector('h2.hud-title')).map((s) => ({ name: s.querySelector('h2').textContent, button: Boolean(s.querySelector('[aria-label^="Enter spaceport: "]')) }))`);
  check('every station card has Enter spaceport', cards.length === 2 && cards.every((c) => c.button), cards);

  // Mouse, plain station: 7 Av (D14) is its own spaceport.
  await evaluate(`document.querySelector('${cardButton('7 Av')}').closest('section').scrollIntoView({ block: 'center' }); true`);
  await shot('card-button-desktop');
  await click('card Enter spaceport: 7 Av', cardButton('7 Av'));
  await assertCloseup('7 Av card', '7 Av');
  await sleep(2000);
  await shot('closeup-desktop');
  await click('Close spaceport', 'dialog[open] [aria-label="Close spaceport"]');
  await waitFor('close-up unmounted', CLOSEUP_GONE);

  // Keyboard, complex member: 42 St-Port Authority (A27) opens the whole Times Sq complex.
  const a27 = cardButton('42 St-Port Authority Bus Terminal');
  await evaluate(`[...document.querySelector('${a27}').closest('section').querySelectorAll('button[aria-pressed]')].filter((b) => /^[↑↓]|^All$/.test(b.textContent)).at(-1).focus(); true`);
  await press('Tab');
  check('Tab reaches the card button', await evaluate(`document.activeElement === document.querySelector('${a27}')`));
  await press('Enter');
  await assertCloseup('A27 card via Enter', 'Times Sq-42 St', '42 St-Port Authority Bus Terminal');
  await sleep(2000);
  await shot('closeup-complex-keyboard');
  await press('Escape');
  await waitFor('close-up unmounted after Escape', CLOSEUP_GONE);
  check('focus returns to the card button', await evaluate(`document.activeElement === document.querySelector('${a27}')`));
  await press(' ');
  const viaSpace = await waitFor('close-up via Space', `document.querySelector('dialog[open] #spaceport-title')?.textContent`, 30000);
  check('Space also opens the close-up', viaSpace === 'Times Sq-42 St', viaSpace);
  await press('Escape');
  await waitFor('close-up unmounted', CLOSEUP_GONE);

  // Cold load with the map collapsed: the map never polled, so the card's click has to start the telemetry itself.
  await click('Collapse button', 'button[aria-controls=orbital-map-body]');
  await waitFor('map collapsed', `!document.getElementById('orbital-map-body') && localStorage.getItem('orbitalMapOpen') === 'false'`);
  const polls = () => network.filter((n) => n.url.includes('/api/train-positions'));
  const pollsAtReload = polls().length;
  await goto('/');
  await waitFor('7 Av card after reload', `document.querySelector('${cardButton('7 Av')}')`, 60000);
  await sleep(2000);
  check('collapsed map: no telemetry polled before the click', polls().length === pollsAtReload, `${polls().length - pollsAtReload} requests`);
  await click('card Enter spaceport: 7 Av (map collapsed)', cardButton('7 Av'));
  let polled = null;
  for (let i = 0; i < 120 && !polled; i++, await sleep(250)) polled = polls().slice(pollsAtReload).find((n) => n.status);
  check('collapsed map: card click fetches rocket telemetry', polled?.status === 200, polled ? `${polled.status} ${polled.url}` : 'no request');
  await assertCloseup('7 Av card, map collapsed', '7 Av');
  await click('Close spaceport', 'dialog[open] [aria-label="Close spaceport"]');
  await waitFor('close-up unmounted', CLOSEUP_GONE);
  await click('Open network button', 'button[aria-controls=orbital-map-body]', 'Open network');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1000);
  await evaluate(`(() => { const top = document.querySelector('${cardButton('7 Av')}').closest('section').getBoundingClientRect().top; scrollBy(0, top - document.querySelector('header').getBoundingClientRect().height - 12); return true; })()`);
  await sleep(500);
  const fits = await evaluate(`(() => { const r = document.querySelector('${cardButton('7 Av')}').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth ? r.width : null; })()`);
  check('mobile: card button fits the viewport', Boolean(fits), `${fits}px wide at 390px`);
  await shot('card-button-mobile');
  await click('mobile card Enter spaceport: 7 Av', cardButton('7 Av'));
  await assertCloseup('7 Av card, mobile', '7 Av');
  await sleep(1500);
  await shot('closeup-mobile');
  await click('Replay', 'dialog[open] button[aria-pressed]', 'Replay');
  await waitFor('replay mode', `${find('dialog[open] [role=status] span', 'Replay')}`);
  await sleep(4000);
  await shot('closeup-mobile-replay');
  await click('Close spaceport', 'dialog[open] [aria-label="Close spaceport"]');
  await waitFor('close-up unmounted', CLOSEUP_GONE);
  check('close button dismisses the close-up', true);
}

const HEADER_WIDTHS = [1440, 1024, 768, 390];

/** The header's feedback button at each width: full label, centred in the bar, clear of the title and controls. */
async function headerFeedbackButton() {
  for (const width of HEADER_WIDTHS) {
    const mobile = width < 640;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 900, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await sleep(500);
    const m = await evaluate(`(() => {
      const bar = document.querySelector('header > div');
      const btn = bar.querySelector('[aria-label="Submit feedback"]');
      const [left, , right] = bar.children;
      const h1 = left.querySelector('h1');
      const rightContent = [...right.querySelectorAll(':scope > *')].filter((el) => el.getBoundingClientRect().width > 0);
      const r = (el) => el.getBoundingClientRect();
      const barR = r(bar), b = r(btn);
      const text = document.createRange();
      text.selectNodeContents(h1);
      const pad = parseFloat(getComputedStyle(bar).paddingLeft);
      return {
        label: btn.innerText.trim(),
        height: b.height,
        bg: getComputedStyle(btn).backgroundColor,
        labelFits: btn.scrollWidth <= btn.clientWidth,
        offCentre: Math.abs((b.left + b.right) / 2 - (barR.left + pad + barR.right - pad) / 2),
        titleGap: b.left - Math.min(text.getBoundingClientRect().right, r(h1).right),
        controlsGap: Math.min(...rightContent.map((el) => r(el).left)) - b.right,
        titleFull: h1.scrollWidth <= h1.clientWidth,
        buttonWidth: b.width,
      };
    })()`);
    const wide = width >= 1024;
    check(`${width}px: button reads "${wide ? 'SUBMIT FEEDBACK' : 'FEEDBACK'}" untruncated`, m.label === (wide ? 'SUBMIT FEEDBACK' : 'FEEDBACK') && m.labelFits, m);
    check(`${width}px: button centred in the header and clear of title and controls`, m.offCentre <= 1 && m.titleGap >= 12 && m.controlsGap >= 12 && m.height >= 40, m);
    check(`${width}px: title "Subway Times" not truncated`, m.titleFull);
    await shot(`header-${width}`, { x: 0, y: 0, width, height: 64 });
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const focused = `document.activeElement?.getAttribute('aria-label') === 'Submit feedback'`;
  for (let i = 0; i < 6 && !(await evaluate(focused)); i++) await press('Tab');
  const outline = await evaluate(`(() => { const s = getComputedStyle(document.activeElement); return ${focused} && s.outlineStyle !== 'none' ? s.outlineWidth + ' ' + s.outlineStyle : null; })()`);
  check('keyboard Tab focuses the button with a visible outline', Boolean(outline), outline);
  await shot('header-1440-focus', { x: 0, y: 0, width: 1440, height: 72 });
}

async function feedback() {
  if (state?.webhook !== 'mock') check('local mock webhook configured', false, 'launch without --real-webhook so the payload can be checked');
  const webhookLog = path.join(stateDir, 'webhook.jsonl');
  const before = existsSync(webhookLog) ? readFileSync(webhookLog, 'utf8').split('\n').filter(Boolean).length : 0;
  await goto('/');
  await headerFeedbackButton();
  await click('Submit feedback button', '[aria-label="Submit feedback"]');
  await waitFor('feedback page', `location.pathname === '/feedback' && document.querySelector('#feedback-title')`, 60000);
  const context = 'verify-subway-times: watching Times Sq';
  const message = `Proof run ${stamp}: rocket landed and launched on the 7 pad.`;
  await click('context field', '#feedback-context');
  await type(context);
  await click('message field', '#feedback-message');
  await type(message);
  await shot('feedback-filled');
  await click('Transmit', 'button[type=submit]', 'Transmit');
  await waitFor('Transmission received', `document.querySelector('#feedback-sent-title')?.textContent.includes('Transmission received')`);
  await shot('feedback-sent');
  const post = network.find((n) => n.url.endsWith('/api/feedback') && n.method === 'POST');
  const sent = post?.postData ? JSON.parse(post.postData) : null;
  check('browser POSTed the form to /api/feedback', post?.status === 200 && sent?.message === message && sent?.context === context, { status: post?.status, body: sent });
  check('honeypot left empty', sent && (sent.website ?? '') === '', sent?.website);
  const lines = readFileSync(webhookLog, 'utf8').split('\n').filter(Boolean);
  const forwarded = lines.length > before ? JSON.parse(lines.at(-1)) : null;
  check(
    'webhook received {context, message, submittedAt} only',
    forwarded?.body?.message === message && forwarded.body.context === context && !Number.isNaN(Date.parse(forwarded.body.submittedAt)) && Object.keys(forwarded.body).sort().join() === 'context,message,submittedAt',
    forwarded
  );
  copyFileSync(webhookLog, path.join(out, 'webhook.jsonl'));
}

// ---------- run ----------
mkdirSync(out, { recursive: true });
const browser = await startChrome();
let failed = null;
try {
  cdp = await connect(browser.ws);
  cdp.on((msg) => {
    if (msg.method === 'Network.requestWillBeSent' && msg.params.request.url.includes('/api/')) {
      network.push({ id: msg.params.requestId, method: msg.params.request.method, url: msg.params.request.url, postData: msg.params.request.postData });
    } else if (msg.method === 'Network.responseReceived') {
      const entry = network.find((n) => n.id === msg.params.requestId);
      if (entry) entry.status = msg.params.response.status;
    } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      consoleLog.push({ type: msg.params.type, text: msg.params.args.map((a) => a.value ?? a.description).join(' ') });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleLog.push({ type: 'exception', text: msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text });
    }
  });
  await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable'].map((m) => cdp.send(m)));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await JOURNEYS[journey]();
} catch (error) {
  failed = error;
  check(`journey ${journey} completed`, false, error.message);
  await shot('failure').catch(() => {});
} finally {
  await writeEvidence(path.join(out, 'network.json'), JSON.stringify(network, null, 2));
  await writeEvidence(path.join(out, 'console.json'), JSON.stringify(consoleLog, null, 2));
  await writeEvidence(
    path.join(out, 'report.json'),
    JSON.stringify({ journey, url: base, feed: state?.feed ?? 'unknown', gitSha: state?.gitSha, at: new Date().toISOString(), checks }, null, 2)
  );
  cdp?.close();
  browser.kill();
}
const ok = !failed && checks.every((c) => c.ok);
console.log(`${ok ? 'OK' : 'FAILED'} ${journey} · evidence ${out}`);
process.exit(ok ? 0 : 1);
