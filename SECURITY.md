# Security notes

House of Stix is a home-lab tool. It is built to be reached only from the home network or Tailscale.

- **Login**: one password (`HOUSE_PASSWORD`, 8+ characters; use 16+), checked in constant time. The session is an HMAC-signed cookie (`HOUSE_SECRET`, 32+ characters), `HttpOnly`, `SameSite=Lax`, `Secure` over https, 7 days. Without both settings the control room stays closed.
- **Guessing**: 10 tries a minute. `X-Forwarded-For` is only believed with `TRUST_PROXY=1`, so the limit can't be dodged with a made-up header.
- **Other sites**: login and logout refuse posts from other origins. The control room can't be framed (`frame-ancestors 'none'`, `X-Frame-Options: DENY`).
- **What the browser sees**: tool names and addresses only. Health addresses (which may be internal) stay on the server.
- **Container**: runs as `node`, all Linux capabilities dropped, `no-new-privileges`, 192 MB cap. `HUB_BIND` pins it to one network.
- **Alerts**: messages carry only a tool's name, up/down and the HTTP status, never addresses or secrets. Treat `ALERT_WEBHOOK_URL` as a secret: anyone with an ntfy topic name can read it, so use a long random topic (or your own n8n).
- **Exposure**: helper ports (the sticker maker API) are bound to 127.0.0.1; `stixctl verify` warns if one is open to the network or the control room listens on every network.
- **Secrets**: only in `~/stix/env/*.env` (mode 600), never in a repo. `stixctl` never removes volumes.

Changing `HOUSE_SECRET` signs everyone out. Rotate it if a device that was signed in is lost.
