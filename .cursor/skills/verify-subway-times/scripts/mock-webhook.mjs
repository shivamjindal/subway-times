#!/usr/bin/env node
// Stand-in for the Google Apps Script web app behind FEEDBACK_WEBHOOK_URL. Appends every POST body
// (one JSON object per line) to --log, answers {"ok":true} like the real doPost, so a run can check
// exactly what /api/feedback forwarded without writing to the user's Sheet.
//
//   node .cursor/skills/verify-subway-times/scripts/mock-webhook.mjs --port 3902 --log /tmp/verify-subway-times/3100/webhook.jsonl
//
// --fail makes it answer 500, to drive the "Signal lost" path.
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(arg('--port', '3902'));
const log = arg('--log', 'webhook.jsonl');
const fail = args.includes('--fail');

createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = { unparsed: raw };
    }
    appendFileSync(log, `${JSON.stringify({ receivedAt: new Date().toISOString(), path: req.url, contentType: req.headers['content-type'], body })}\n`);
    res.writeHead(fail ? 500 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fail ? { ok: false } : { ok: true }));
  });
}).listen(port, '127.0.0.1', () => console.log(`mock Apps Script webhook on http://127.0.0.1:${port}/exec · log ${log}${fail ? ' · failing' : ''}`));
