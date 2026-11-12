# Hosting House of Stix on the Linux home lab

`stixctl` boots, stops and checks the tools. It uses each tool's own Docker Compose file, adds small port overrides, and never deletes volumes.

| Tool | Tier | Address (default) | How it runs |
| --- | --- | --- | --- |
| House of Stix | base | `:8200` | built from this repo |
| CutDesk | base | `:8304` | built from `atreyakamat/cutdesk` (design + cut studio, also makes Cricut A4 sheets at `/sheets`) |
| Cricut sheets | base | `:8300` | built from `atreyakamat/cricut` (CutDesk `/sheets` does the same; turn this off once you are happy) |
| ReNameX | base | `:8303` | built from `atreyakamat/ReNameX`, moved off 3000 |
| InWoice | core | `:5000` | built from `atreyakamat/InWoice` (Postgres + app) |
| Sticker maker | heavy | web `:8301`, API `127.0.0.1:8000` (this machine only) | built from `atreyakamat/Stix-Sticker-Maker`, web moved off 8080 |
| ScaleUp | heavy | `:7756` | **already running** on the home lab; only started, stopped and checked |
| Uptime + shop backup | off | `:3001` | `homelab/` in `atreyakamat/stixnvibes-nv`, see below |
| Receipt maker | off | `:8302` | disabled, see below |

Tiers: **base** and **core** start at boot (`stixctl boot`). **heavy** starts only when you ask (`stixctl up heavy`).

## Quick start

```sh
git clone https://github.com/atreyakamat/houseofstix.git ~/stix/houseofstix
cd ~/stix/houseofstix
./deploy/stixctl doctor
./deploy/stixctl bootstrap     # clones the tools, writes ~/stix/env/*.env
nano ~/stix/env/hub.env        # set HOUSE_PASSWORD and HOME_LAB_HOST
./deploy/stixctl up base
./deploy/stixctl up core
./deploy/stixctl verify        # everything a person would notice, checked for you
```

The agent prompt that does this step by step, with safety rules, is in [AGENT_PROMPT.md](AGENT_PROMPT.md).

## Commands

| Command | What |
| --- | --- |
| `stixctl doctor` | Checks Docker, Compose 2.24+, memory, disk and ports |
| `stixctl status` | What runs and what is off |
| `stixctl verify [tier\|id\|all]` | Live check of every running tool: containers running (not crash-looping, not unhealthy), health answers with the expected text, its window can be framed by the control room (no blank windows), helper ports stay on this machine, the control room is not on every network. Exit code 1 if anything failed |
| `stixctl up <base\|core\|heavy\|id\|all>` | Build and start |
| `stixctl stop <...>` | Stop, keep data |
| `stixctl down <...>` | Remove containers, keep data (volumes are never removed) |
| `stixctl update <...>` | Pull the latest code and rebuild, only if there is new code (`FORCE=1` rebuilds anyway). It then waits for the tool to be healthy (90 s, 5 min for heavy tools); if it isn't, it shows the last log lines, **rolls back to the previous commit** and rebuilds that, so a bad release never stays up. The next `update` tries the new code again |
| `stixctl logs <id> [-f]` | Logs |
| `stixctl install-boot` | Prints a systemd unit for start at power-on (you install it) |

`up` also waits for each tool to be healthy and says so.

Turn a tool off for good: change `yes` to `no` in `deploy/stack.conf`.

## Alerts

Set `ALERT_WEBHOOK_URL` in `~/stix/env/hub.env` and run `stixctl up hub`. The control room then checks every tool once a minute, even when nobody has it open, and sends one message when a tool is down for two checks in a row and one when it is back. Free choices: the ntfy phone app with `https://ntfy.sh/<long random topic>`, your n8n (`http://host.docker.internal:5678/webhook/<id>`), or a Discord/Slack webhook. Heavy tools only alert after they were running (switched off is not broken). `ALERT_IGNORE=receipts,uptime` silences tools you keep off.

## Changing ports or adding a tool

`services.yaml`, `deploy/stack.conf`, `deploy/overrides/` and `deploy/reserved-ports.conf` must agree. CI fails the pull request if two tools share a port, a tool takes a port another program owns (AdGuard 3000, Filebrowser 8080, ...), a tool stixctl runs has no card or no health address, or an override publishes a port the card doesn't use. When you install something new on the box, add its port to `reserved-ports.conf`.

## Where things live

- Code of the other tools: `~/stix/src/<id>` (cloned, not committed anywhere).
- Secrets: `~/stix/env/<id>.env`, mode 600, outside every repository. Bootstrap generates random database passwords and login secrets and leaves anything you must supply (passwords, API keys) for you.
- Data: Docker volumes of each tool, plus `~/stix/data/<id>` for tools that keep files on the host (shop backups). `stixctl` never removes either.

## Not running yet, and worth starting

- **Uptime Kuma and the nightly shop backup** (`homelab/` in `stixnvibes-nv`) did not appear in your `docker ps`. The backup protects the shop's data, so it is the next thing to start: set `BACKUP_TOKEN` on Netlify and in that folder's `.env`, then `docker compose up -d --build` there.

## Uptime + shop backup (`shopops`)

After the stixnvibes-nv "House of Stix" PR is merged: set `BACKUP_TOKEN` on Netlify, set `shopops` to `yes` in `deploy/stack.conf`, run `stixctl bootstrap`, put the same token in `~/stix/env/shopops.env`, then `stixctl up shopops`.

## Receipt maker

Disabled until the invoice-receipt-maker "House of Stix" PR is merged. That PR makes its server serve the web page, takes the database password from `~/stix/env/receipts.env`, uses the NVIDIA key its code actually reads, and refuses to start without real login secrets. Then set `receipts` to `yes`, run `stixctl bootstrap` and `stixctl up receipts`.

## Keeping it off the internet

- Set `HUB_BIND` in `~/stix/env/hub.env` to the home lab's LAN or Tailscale IP. `stixctl doctor` warns while it is empty.
- Never forward 8200 (or any tool port) on the router, and don't put it behind a tunnel. Reach it over Tailscale from outside.
- The tools themselves (Cricut, CutDesk, ReNameX, Sticker maker, ScaleUp) have no login of their own: anyone on the same network can open them. That's fine on a home LAN; on a shared Wi-Fi, bind them to the Tailscale IP too.

How each tool plugs in (ports, health, framing) is in [INTEGRATION.md](INTEGRATION.md).

## Start, stop and logs from the dashboard

Portainer already runs on your home lab and does this well, so House of Stix links to it (the "Containers" card) instead of duplicating it.
