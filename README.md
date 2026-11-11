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

## Calendar

A built-in **Calendar** window for stall days, college events, coupon end dates and anything else with a date.

- Month view (Monday first) plus a "Coming up" list; on a phone it shows just the list. The Calendar card on the desktop shows the next event.
- Click a day to add an event, click an event to edit or delete it. Kinds: Stall, College event, Coupon ends, Other.
- **Import CSV**: save the pop-up sheet (for example "Goa Sundays master") as CSV and pick it. It needs a `Sunday` or `Date` column and an `Event` or `Title` column. A cell like `2026-11-01 / 2026-11-08` becomes one event per day. Rows marked Skip, or with no real date, are left out and listed. Venue, status, next step, fee and contact go into the event's place and notes. Importing the same sheet again only adds what's new.
- **Export .ics**: downloads every event as `house-of-stix.ics`, which opens in Google Calendar, Apple Calendar or Outlook.
- Saved on the box in `data/calendar.json` (the `hos-data` Docker volume, so rebuilds keep it). Set `CALENDAR_FILE` to keep it somewhere else. Back it up with `docker cp houseofstix-houseofstix-1:/app/data/calendar.json .`

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
