#!/usr/bin/env node
// Read-only health check for a subway-times instance. Changes nothing, kills nothing.
//
//   node .cursor/skills/verify-subway-times/scripts/doctor.mjs [--port 3100] [--json]
//
// Answers: is the process up, is it this checkout at the commit it was launched from, does the
// listening socket belong to the process launch.sh started, and is the MTA feed live or mock.
// Exit 0 when every check passes, 1 otherwise.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const port = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : 3100);
const asJson = args.includes('--json');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const stateFile = path.join(process.env.VERIFY_STATE_ROOT ?? '/tmp/verify-subway-times', String(port), 'state.json');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null;
const results = [];
const report = (name, ok, detail) => results.push({ name, ok, detail });

const alive = (pid) => Number.isInteger(pid) && existsSync(`/proc/${pid}`);
const pgid = (pid) => Number(readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[2]);
const environ = (pid) => {
  try {
    return Object.fromEntries(readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
  } catch {
    return {};
  }
};

/** PID listening on 127.0.0.1/0.0.0.0/:: port, from /proc (no ss/lsof needed). */
function listenerPid(p) {
  const hex = p.toString(16).toUpperCase().padStart(4, '0');
  const inodes = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols[1]?.endsWith(`:${hex}`) && cols[3] === '0A') inodes.add(cols[9]);
    }
  }
  if (inodes.size === 0) return null;
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        const link = readlinkSync(`/proc/${pid}/fd/${fd}`);
        if (inodes.has(link.match(/^socket:\[(\d+)\]$/)?.[1])) return Number(pid);
      }
    } catch {}
  }
  return -1; // listening, but owned by a process we cannot inspect (another user)
}

async function get(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    return { status: res.status, body: await res.text() };
  } catch (error) {
    return { status: 0, body: error.message };
  }
}

report('launch state', Boolean(state), state ? stateFile : `no ${stateFile}: not started by launch.sh (doctor can still inspect the port)`);

const nextPid = state?.pids?.next;
const server = state?.mode === 'prod' ? 'next start' : 'next dev';
report(`${server} process up`, alive(nextPid), nextPid ? `pid ${nextPid}` : 'unknown pid');
for (const [name, pid] of Object.entries(state?.pids ?? {})) {
  if (name !== 'next' && pid !== null) report(`${name} process up`, alive(pid), `pid ${pid}`);
}

const owner = listenerPid(port);
const ours = owner > 0 && alive(nextPid) && pgid(owner) === nextPid;
report(`port ${port} is ours`, ours, owner === null ? 'nothing listening' : owner === -1 ? 'listener not inspectable (another user)' : `listener pid ${owner}, pgid ${owner > 0 ? pgid(owner) : '?'}${ours ? ` = launched ${server}` : ''}`);

if (alive(nextPid)) {
  const cwd = readlinkSync(`/proc/${nextPid}/cwd`);
  const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  report('right checkout', cwd === repo, `server cwd ${cwd}`);
  if (state.mode === 'prod') {
    const buildFile = path.join(repo, '.next', 'BUILD_ID');
    const onDisk = existsSync(buildFile) ? readFileSync(buildFile, 'utf8').trim() : null;
    report('right build', onDisk === state.buildId, `next start · BUILD_ID ${state.buildId}${onDisk === state.buildId ? '' : `, but .next/BUILD_ID is now ${onDisk} (rebuilt underneath; relaunch)`}`);
  } else {
    report('right build', true, 'next dev (compiles the working tree on request)');
  }
  report('right commit', head === state.gitSha, head === state.gitSha ? head.slice(0, 12) : `launched at ${state.gitSha.slice(0, 12)}, HEAD now ${head.slice(0, 12)} (dev hot-reloads files, but relaunch to be sure)`);
}

const home = await get(`http://localhost:${port}/`);
report('home page serves this app', home.status === 200 && home.body.includes('Subway Times'), `HTTP ${home.status}`);

const positions = await get(`http://localhost:${port}/api/train-positions`);
let feed = 'unknown';
if (positions.status === 200) {
  const json = JSON.parse(positions.body);
  const mockIds = json.trains.filter((t) => t.id.startsWith('MOCK_')).length;
  const env = alive(nextPid) ? environ(nextPid) : {};
  const configured = env.MTA_FEED_BASE_URL ? `mock (${env.MTA_FEED_BASE_URL})` : alive(nextPid) ? 'live (api-endpoint.mta.info)' : 'not inspectable';
  feed = mockIds > 0 ? 'mock' : json.trains.length > 0 ? 'live' : 'empty';
  report('build has train-positions with trackCoverage', 'trackCoverage' in json, `${json.trains.length} trains · ${json.failedFeeds} feeds failed`);
  report('feed', feed !== 'empty', `${feed.toUpperCase()} · server env says ${configured} · ${mockIds} MOCK_ trip IDs`);
  if (state?.feed) report('feed matches launch', state.feed === feed, `launched ${state.feed}, serving ${feed}`);
} else {
  report('feed', false, `/api/train-positions HTTP ${positions.status}: ${positions.body.slice(0, 200)}`);
}

if (alive(nextPid)) {
  const webhook = environ(nextPid).FEEDBACK_WEBHOOK_URL ?? '';
  report('feedback webhook', Boolean(webhook), webhook.startsWith('http://127.0.0.1') ? `local mock ${webhook}` : webhook ? 'real Apps Script URL (writes to the Sheet)' : 'unset: /feedback shows "Feedback channel offline"');
}

const ok = results.every((r) => r.ok);
if (asJson) console.log(JSON.stringify({ ok, port, feed, results }, null, 2));
else {
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name} · ${r.detail}`);
  console.log(ok ? `HEALTHY · ${feed} feed · http://localhost:${port}` : 'UNHEALTHY');
}
process.exit(ok ? 0 : 1);
