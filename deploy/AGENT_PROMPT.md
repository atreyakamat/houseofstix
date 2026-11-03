# Prompt for the home lab agent

Paste everything between the lines into your agent on the home lab.

---

You are setting up "House of Stix", a control room dashboard plus a few small tools, on this Debian Linux home lab. Work step by step and report after each step. Be careful: this machine already runs about 25 containers that I depend on.

## Hard rules

1. Recon first, changes later. Steps 1 and 2 only read.
2. Never stop, restart, remove or reconfigure any existing container, image, volume or network without showing me the exact command and getting a clear "yes" from me for that command. Stopping is allowed only with `docker stop` (never `docker rm`, `docker rmi`, `docker system prune`, `docker volume rm`, or `compose down -v`).
3. Never touch `portainer` or `scaleup`.
4. If a port the new tools need is already in use, stop and ask me. Do not move other containers.
5. Do not print, log or commit secrets. Do not invent passwords or API keys for me: I set `HOUSE_PASSWORD` myself. Random secrets that `stixctl bootstrap` generates are fine.
6. No `sudo` without asking me first. No router, firewall or internet exposure changes. This stays on my home network (I reach it over Tailscale or the LAN).
7. Everything new lives under `~/stix`. If something fails, fix it inside `~/stix` only.

## Step 1: look at the machine (read only)

Run and show me a short summary of:
`free -h`, `nproc`, `df -h /`, `docker compose version`, `docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}"`, `ss -ltn`, and for every container its restart policy (`docker inspect -f '{{.Name}} {{.HostConfig.RestartPolicy.Name}}' $(docker ps -q)`).

Then tell me: total and free RAM, the 8 hungriest containers, and whether ports 8200, 8300, 8301, 8303, 5000 and 8000 are free.

## Step 2: propose what to stop (still read only)

Based on the numbers, propose which containers I could stop to leave room, as a table: name, memory used, why it is a candidate, the exact `docker stop <name>` command, and the command to bring it back (`docker start <name>`). Start from this list and adjust to the real numbers:

- I do not need these, so propose stopping them (all containers of each stack, e.g. `snikket*`, `seafile*` including `seafile-caddy`, `seadoc`, `monica` and `monica-db`): `snikket`, `monica`, `adguardhome`, `homarr`, `seafile`, `seadoc`. Stop only, never remove, and keep every volume. Before stopping `adguardhome`, warn me that devices using it as DNS lose name lookup until I change their DNS, and ask again specifically for that one.
- Candidates next (heavy, dev tools): `sonarqube`, `jenkins`.
- Candidates if memory is still tight: `odoo` and `odoo-db`, `n8n`.
- Probably leave running: `webamp`, `filebrowser`, `navidrome`, `qbittorrent`.
- Never: `portainer`, `scaleup`.

Also tell me which of the candidates have restart policy `always`, because those come back after a reboot unless the policy changes. Wait for my answer. Stop only the ones I approve.

## Step 3: get the code

```
mkdir -p ~/stix && cd ~/stix
git clone https://github.com/atreyakamat/houseofstix.git
cd houseofstix
ls deploy/stixctl
```

If `deploy/stixctl` is missing, the kit is not merged yet: run `git checkout claude/project-thread-l9mz40` and carry on.

## Step 4: check, then bootstrap

```
./deploy/stixctl doctor
./deploy/stixctl bootstrap
```

`doctor` must show no FAIL. Show me every WARN and wait if a port is used by something else.

`bootstrap` clones the other tools into `~/stix/src` and writes env files into `~/stix/env` (outside every repo). Then ask me two things:

1. The address my browser uses to reach this machine (LAN IP or Tailscale name). Put it in `~/stix/env/hub.env` as `HOME_LAB_HOST=`.
2. Tell me to set `HOUSE_PASSWORD=` (8+ characters) in `~/stix/env/hub.env` myself, with `nano`. Wait until I say it is done. Do not read the file back to me.

## Step 5: start the base and core tools

```
./deploy/stixctl up base
./deploy/stixctl up core
```

The first build takes several minutes. Do not start the `heavy` tier (`bgremover`); it stays off until I ask. `scaleup` already runs here and is not rebuilt.

If a build fails, show me the last 40 lines, explain the cause, and fix it inside `~/stix` only. Do not retry blindly more than twice.

## Step 6: verify

1. `./deploy/stixctl status`
2. `curl -fsS http://localhost:8300/health` (Cricut) and `curl -fsS http://localhost:5000/health` (InWoice).
3. `curl -sI http://localhost:8200/ | head -1` should be `200`.
4. Tell me to open `http://<HOME_LAB_HOST>:8200`, sign in, and check that the icons show Up or Down honestly.
5. Run `free -h` again and tell me how much memory the new tools use.

## Step 7: start at boot (ask first)

Run `./deploy/stixctl install-boot` and show me the unit it prints. Do not install it. Tell me the two `sudo` commands from its header and wait for my go-ahead.

## Final report

Give me: what is running with its URL, memory before and after, anything that failed or looks risky, the containers I chose to stop and how to bring each back, and the one next thing you recommend.
