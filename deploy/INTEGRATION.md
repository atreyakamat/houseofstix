# How a tool plugs into House of Stix

Every tool the control room shows follows the same small contract. When you add a tool, check these four things.

| | What | Why |
| --- | --- | --- |
| 1 | A fixed host port in the 83xx range (or its existing one) | So the tools never fight over 3000/8080 |
| 2 | A health address that answers 200 only when it really works | The status light. Add `expect:` in `services.yaml` when the reply has a clear marker |
| 3 | `Content-Security-Policy: frame-ancestors 'self' <control room>` instead of `X-Frame-Options: DENY/SAMEORIGIN` | So it opens in a control-room window, but no other site can frame it |
| 4 | Secrets from `~/stix/env/<id>.env` (via `--env-file`, or `env_file: ${STIX_ENV_FILE:-.env}`) | No secret ever lives in a clone or a repo |

`stixctl bootstrap` writes `CONTROL_ROOM_ORIGIN=http://<HOME_LAB_HOST>:8200` into each tool's env file. Each tool turns that into its `frame-ancestors` header.

## Current tools

| id | Repo | Port | Health | Framing |
| --- | --- | --- | --- | --- |
| hub | houseofstix | 8200 | `/` | never framed (`frame-ancestors 'none'`) |
| cricut | cricut | 8300 | `/health` → `"ok":true` | `CONTROL_ROOM_ORIGIN` (nginx) |
| bgremover | Stix-Sticker-Maker | 8301 (web), 8000 (API) | `:8301/health` (proxied to the API; API on 127.0.0.1:8000 only) | `CONTROL_ROOM_ORIGIN` (nginx) |
| receipts | invoice-receipt-maker | 8302 | `/health` → `"status":"OK"` | `CONTROL_ROOM_ORIGIN` (helmet) |
| renamex | ReNameX | 8303 | `/healthz` | `CONTROL_ROOM_ORIGIN` (nginx) |
| cutdesk | cutdesk | 8304 | `/health.json` | `CONTROL_ROOM_ORIGIN` (Next proxy) |
| inwoice | InWoice | 5000 | `/health` → `"database":"ok"` | `CONTROL_ROOM_ORIGIN` (helmet) |
| scaleup | ScaleUp | 7756 | `/api/health` | no header (embeds) |
| uptime / shopops | stixnvibes-nv `homelab/` | 3001 | `/api/entry-page` | Uptime Kuma's own |
| shop, admin | stixnvibes-nv (Netlify) | - | `/api/health` → `"ok":true` | `X-Frame-Options: DENY` on purpose: opens in a tab |
| landing | stixnvibes (Netlify) | - | home page | embeds |
| portainer | (existing) | 9999 | not checked | opens in a tab |

The Android apps (stix-app, stix-admin) talk to the shop's API, not to the home lab, so they have nothing to plug in.

## Checked for you

- **On every pull request** (CI): `services.yaml`, `stack.conf`, `overrides/` and `reserved-ports.conf` must agree (no shared ports, no port another program owns, every tool health-checked); `stixctl` passes shellcheck and its own tests.
- **On the box**: `stixctl verify` checks the running tools (health, framing, ports, crash loops). `stixctl update` rolls a tool back to its last good commit if the new code doesn't come up healthy.
- **All the time**: with `ALERT_WEBHOOK_URL` set, the control room messages you when a tool goes down or comes back.
