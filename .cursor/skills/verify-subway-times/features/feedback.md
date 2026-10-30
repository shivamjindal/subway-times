# Feedback

## Sub-features

- `/feedback` page (header link `aria-label="Send feedback"`, back link `aria-label="Back to mission control"`).
- Form fields: "What were you doing?" (`#feedback-context`, optional, max 200 characters) and "What happened?" (`#feedback-message`, required, max 4000). There's also a hidden honeypot `#feedback-website`.
- The submit button reads "Transmit", then "Transmitting…" while sending, then shows "Transmission received" (`#feedback-sent-title`). On failure it shows "Signal lost" (`role=alert`) and the button becomes "Retry transmission".
- `POST /api/feedback` validates the body. It returns 400 on validation errors, 503 when `FEEDBACK_WEBHOOK_URL` is missing (the page shows "Feedback channel offline"), and 502 when the webhook fails. A filled honeypot is dropped but still answered `{ok:true}`. Otherwise it forwards `{context, message, submittedAt}` to the Apps Script web app.

## How to get to it (user POV)

Click the speech-bubble button in the header of `/`. Optionally fill in "What were you doing?", describe the problem, and click Transmit. A success panel replaces the form.

## Driving it with drive.mjs

```bash
.cursor/skills/verify-subway-times/scripts/launch.sh             # starts the mock Apps Script webhook on port+802
node .cursor/skills/verify-subway-times/scripts/drive.mjs feedback
```

The journey runs these steps:

1. It clicks "Send feedback" on `/` and waits for `/feedback`.
2. It types a context and a message stamped with the run time (`feedback-filled.png`).
3. It clicks Transmit and waits for "Transmission received" (`feedback-sent.png`).
4. It asserts the captured browser `POST /api/feedback` returned 200 with exactly the typed context and message, and the honeypot empty.
5. It asserts the mock webhook's newest line in `webhook.jsonl` has a body with exactly `{context, message, submittedAt}`, matching values, and a parseable timestamp. That file is copied into the evidence.

For error paths, use the API directly: `curl -s -XPOST localhost:3100/api/feedback -H 'content-type: application/json' -d '{"message":""}'` (400). For 502, restart only the mock webhook with `--fail` on the same port and log.

## Gotchas

- **Don't point a verification run at the real Apps Script** unless the user asks. `script.google.com` was reachable from this VM (HTTP 302), but a real deployment URL appends rows to the user's Sheet. The local mock webhook is the sanctioned boundary mock. `--real-webhook` exists for an explicit end-to-end check.
- `/feedback` is prerendered by `next build`, so in `--prod` the "online" state is fixed at build time from `FEEDBACK_WEBHOOK_URL`. `launch.sh` exports the same env for build and start. If you build by hand without it, the page says "Feedback channel offline" even if the server has the variable.
- The real Apps Script answers with a 302 to googleusercontent. The server follows redirects (`redirect: 'follow'`), and the mock answers 200 directly, so redirect handling is only exercised against the real webhook.
- The form has no email field (removed on purpose). Don't add one to the journey.
