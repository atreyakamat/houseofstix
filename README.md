# House of Stix

The Stix control room: one screen to open, watch and operate every tool. Each tool opens in its own window (drag, resize, minimise, maximise), with a status light on every icon.

| Group | Tools |
| --- | --- |
| Stix N Vibes | Shop, Shop admin, Website |
| Business | InWoice, Receipt maker |
| Studio tools | [Cricut sheets](https://github.com/atreyakamat/cricut), Sticker maker (background remover), ScaleUp, ReNameX |

## How it works

- `services.yaml` lists every tool: where your browser opens it, where the server checks its health, and how it boots (`base`, `core`, `heavy`, `cloud`).
- The server checks each health address every 15 seconds and shows Up (with response time) or Down. A tool with no health address shows "Not checked".
- Health addresses never reach the browser, so they can be Docker-internal.
- A tool that forbids being shown in a window can set `embed: false` and opens in a browser tab instead. Every window also has an "open in a new tab" button.
- Window positions are remembered in your browser.
- On a phone each window fills the screen; the bar at the bottom switches between them.

## Run it

```sh
cp .env.example .env        # set HOUSE_PASSWORD and HOUSE_SECRET
npm install
npm run dev                 # http://localhost:8200
npm run check               # lint, typecheck, tests
```

Or with Docker:

```sh
docker compose up -d --build
```

The control room stays closed (it shows a setup message, not the tools) until `HOUSE_PASSWORD` (8+ characters) and `HOUSE_SECRET` (32+ random characters) are set.

## Security

- Home network only. Do not expose this to the internet.
- One password, checked in constant time, 5 tries a minute per visitor. The login cookie is signed, HTTP-only, and lasts 7 days.
- The control room only *reads* each tool's health address. It does not touch Docker yet.

## Not built yet

- Start, Stop, Restart and live logs per container (needs a locked-down Docker socket proxy).
- One front door: every tool under one address and login through a reverse proxy.
- Live numbers on the cards (orders today, unpaid invoices).

## Ports

| Tool | Port |
| --- | --- |
| House of Stix | 8200 |
| Cricut sheets | 8300 |
| Sticker maker (frontend; API on 127.0.0.1:8000) | 8301 |
| Receipt maker | 8302 |
| ReNameX | 8303 |
| ScaleUp | 7756 |
| InWoice | 5000 |

The ports for Sticker maker, Receipt maker and ReNameX are the plan for the full stack; those tools don't use them yet. Receipt maker's address is a placeholder until I've confirmed where its web page is served.
