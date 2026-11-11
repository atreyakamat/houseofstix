# Hosting House of Stix on the Linux home lab

`stixctl` boots, stops and checks the tools. It uses each tool's own Docker Compose file, adds small port overrides, and never deletes volumes.

| Tool | Tier | Address (default) | How it runs |
| --- | --- | --- | --- |
| House of Stix | base | `:8200` | built from this repo |
| CutDesk | base | `:8304` | built from `atreyakamat/cutdesk` (design + cut studio, also makes Cricut A4 sheets at `/sheets`) |
| Cricut sheets | base | `:8300` | built from `atreyakamat/cricut` (CutDesk `/sheets` does the same; turn this off once you are happy) |
| ReNameX | base | `:8303` | built from `atreyakamat/ReNameX`, moved off 3000 |
| InWoice | core | `:5000` | built from `atreyakamat/InWoice` (Postgres + app) |
| Sticker maker | heavy | web `:8301`, API `:8000` | built from `atreyakamat/Stix-Sticker-Maker`, web moved off 8080 |
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
```

The agent prompt that does this step by step, with safety rules, is in [AGENT_PROMPT.md](AGENT_PROMPT.md).

## Commands

| Command | What |
| --- | --- |
| `stixctl doctor` | Checks Docker, Compose 2.24+, memory, disk and ports |
| `stixctl status` | What runs and what is off |
| `stixctl up <base\|core\|heavy\|id\|all>` | Build and start |
| `stixctl stop <...>` | Stop, keep data |
| `stixctl down <...>` | Remove containers, keep data (volumes are never removed) |
| `stixctl update <...>` | Pull the latest code and rebuild |
| `stixctl logs <id> [-f]` | Logs |
| `stixctl install-boot` | Prints a systemd unit for start at power-on (you install it) |

Turn a tool off for good: change `yes` to `no` in `deploy/stack.conf`.

## Where things live

- Code of the other tools: `~/stix/src/<id>` (cloned, not committed anywhere).
- Secrets: `~/stix/env/<id>.env`, mode 600, outside every repository. Bootstrap generates random database passwords and login secrets and leaves anything you must supply (passwords, API keys) for you.
- Data: Docker volumes of each tool. `stixctl` never removes them.

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
