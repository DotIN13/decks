# Decks — running it on another machine

Decks is written for one person on one machine, and this document is about the case where
that machine is not the one you are sitting at: a small server you reach from a laptop, a
phone and a tablet, with the deck living there instead of on any of them.

Everything below follows from a single fact, so it comes first.

---

## 1. Decks has no authentication

There is no login, no token, and no origin check. `ws.ts` accepts every frame that arrives
on `/ws`, and those frames drive a Pi session with live tool execution — `bash`, `write`,
`edit`, `stage_eval`. Decks ships no permission gate either, deliberately (§6.8): that is an
extension's job, and if no extension is installed there is nothing in the way.

So a reachable Decks port is arbitrary code execution as the user running it, plus a
spendable API key. The consequences for a deployment:

- **Never bind it to a public interface.** Not behind a password either — a single shared
  secret in front of an RCE endpoint is thin, and a leaked one is unrecoverable.
- **Put it on a private network.** A WireGuard mesh (Tailscale, Netbird, plain WireGuard) or
  an SSH tunnel. §8 uses Tailscale because it also solves TLS.
- **Bind the process to loopback** and let the private-network proxy be the only way in, so
  the plain-HTTP port is unreachable even from inside that network.
- **Do not expose it with a public tunnel.** `tailscale funnel` sits one word away from
  `tailscale serve` in the CLI and does the opposite thing: Serve is private to your
  network, Funnel is the public internet.

Everything else here is ordinary deployment work. This part is the part that matters.

## 2. What production looks like

One process, one port. `http.ts` mounts `apps/web/dist` as static files when that directory
exists and falls through to `index.html` for anything unmatched, so the built UI and the API
share an origin and Vite is never needed at runtime — only at build time. That origin
sharing is not incidental: boards load into same-origin frames (§4), and "same origin" has
to be true of the origin the browser actually loaded.

```
browser ──https──▶ private-network proxy ──http──▶ 127.0.0.1:4329
                                                    │
                                                    ├── /api/*        the API
                                                    ├── /ws           the socket
                                                    └── /*            apps/web/dist
```

The server runs from TypeScript source under `tsx`; there is no compile-to-`dist` step for
it. `npm run build --workspace @decks/server` is a typecheck (`tsc --noEmit`) and emits
nothing. Only the web build produces artifacts.

## 3. Prerequisites

| | |
|---|---|
| Node | **>= 22.19** (`engines.node`). Match your development version if you can. |
| git | to clone and to update |
| Private network client | see §1 |

Nothing else. No database, no reverse proxy of your own, no process manager beyond systemd.

## 4. A service user

The agent executes code by design, so the account it runs as is the blast radius. Give it
one of its own rather than running it as your admin user:

```bash
sudo useradd --create-home --home-dir /home/decks --shell /bin/bash decks
sudo passwd -l decks            # no password: no login path
sudo chmod 750 /home/decks      # your admin user cannot read the credentials either
```

Two details that look like mistakes and are not:

- **The shell is real.** `/usr/sbin/nologin` is the reflex for a service account, but Pi's
  shell tools spawn a shell, and running them is the entire point. Login is prevented by the
  locked password and the absent `~/.ssh`, not by the shell.
- **No sudo, ever.** Do not add it to `sudo`, `wheel` or `adm`. Combined with
  `NoNewPrivileges=yes` in §7 there is no escalation path out of the account.

Because `/home/decks` is `750`, your admin user cannot `cd` into it. Every command in the
rest of this document therefore runs the `cd` *inside* the service user's shell:

```bash
sudo -u decks -H bash -c "cd /home/decks/app && ..."
```

`sudo -u decks -H cd /home/decks/app && ...` fails, because the `cd` runs as you.

## 5. The code

```bash
sudo -u decks -H git clone <repo-url> /home/decks/app
sudo -u decks -H bash -c "cd /home/decks/app && npm ci && npm run build"
sudo -u decks -H mkdir -p /home/decks/data
```

- **Do not pass `--omit=dev`.** `tsx` is a devDependency of `@decks/server` and the server
  runs under it. A production-only install produces a service that cannot start.
- **npm >= 11 does not run install scripts** by default (`allowScripts`), including
  esbuild's. That is usually harmless — the `@esbuild/<platform>` package carries the binary
  and esbuild resolves it at runtime — but it is worth one check on an unfamiliar
  architecture, because the failure otherwise appears later as a confusing build error:

  ```bash
  sudo -u decks -H bash -c "cd /home/decks/app && ./node_modules/.bin/esbuild --version"
  ```

- A lockfile committed from one platform installs fine on another; the optional
  platform packages for every architecture are recorded in it.
- `npm test` is a fair smoke test of a fresh deployment, and it needs no credentials.

### The browser

The `board-debug` skill drives Chromium to screenshot a board, read its console and
measure its elements. That is a capability of the agent rather than a test tool, so a
deployment that skips it ships an agent that cannot see its own work. Two halves, and they
need different privileges:

```bash
# System libraries Chromium links against. Needs root, so not the service user.
sudo npx --yes playwright@<version> install-deps chromium

# The browser itself, as the service user, into its own cache.
sudo -u decks -H bash -c "cd /home/decks/app && npx playwright install chromium"
```

The version should match the `playwright` devDependency, so the dependency list matches the
browser. The binary lands in `~/.cache/ms-playwright` — inside the service user's home, so
`ReadWritePaths=` already covers it, and no unit change is needed.

`npm ci` will *not* fetch the browser for you: npm >= 11 skips Playwright's postinstall
along with everything else, which is why this is a separate step rather than a side effect.

Chromium runs happily under the §7 sandbox — verified with the directives applied, writing
into the private `/tmp`. Notably it also survives `kernel.apparmor_restrict_unprivileged_userns=1`
(the default on Ubuntu 24.04, which breaks many headless-Chrome setups), because Playwright
installs Chrome Headless Shell rather than full Chromium. No sysctl needs relaxing.

## 6. Credentials

Decks reads the same `~/.pi/agent/` the Pi CLI uses. **Copying `auth.json` alone is usually
not enough**: the key lives there, but the provider definition lives in `models-store.json`
and the default provider and model live in `settings.json`. Copy all three, or the server
starts and then cannot reach a model.

```bash
# from your machine, into a staging directory you own
scp ~/.pi/agent/auth.json ~/.pi/agent/models-store.json ~/.pi/agent/settings.json <host>:<stage>/

# on the server
sudo -u decks -H mkdir -p /home/decks/.pi/agent
sudo -u decks -H chmod 700 /home/decks/.pi /home/decks/.pi/agent
for f in auth.json models-store.json settings.json; do
  sudo install -o decks -g decks -m 600 <stage>/$f /home/decks/.pi/agent/$f
done
shred -u <stage>/*        # a staging copy of a key is still a copy of a key
```

- **Trim `settings.json`.** Its `packages` array names Pi extensions your workstation
  installs; on a server they are startup failures at best. Delete the array and keep the
  rest.
- **Skip `~/.pi/agent/bin/`.** Those `fd` and `rg` binaries are built for your workstation's
  platform. Pi fetches the right ones itself.
- **Alternatively, authenticate on the server** (`pi auth`) and keep its credentials
  separate from your laptop's, or supply a key by environment variable in the unit file.

The transcripts do not live in the deck: Pi keys them to a slug of the deck's path under
`~/.pi/agent/sessions/`. A deployed deck therefore starts with no history even if you copy
the boards, and its conversations stay on the server.

## 7. The service

```ini
[Unit]
Description=Decks
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=decks
Group=decks
WorkingDirectory=/home/decks/app

Environment=HOME=/home/decks
Environment=NODE_ENV=production
Environment=DECKS_DATA_DIR=/home/decks/data
# Loopback only. The private-network proxy (§8) is the sole way in, so the
# plain-HTTP port is unreachable from every interface on the host. It is also
# the address the board-debug skill's browser connects back to.
Environment=DECKS_HOST=127.0.0.1
Environment=DECKS_PORT=4329

ExecStart=/usr/bin/node --import tsx apps/server/src/index.ts

Restart=always
RestartSec=3

# The agent executes code by design, so this is the blast radius: everything
# read-only except its own home, a private /tmp, and no capabilities at all.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=/home/decks
ProtectControlGroups=yes
ProtectKernelTunables=yes
RestrictSUIDSGID=yes
CapabilityBoundingSet=
AmbientCapabilities=
UMask=0077

StandardOutput=journal
StandardError=journal
SyslogIdentifier=decks

[Install]
WantedBy=multi-user.target
```

Install it at `/etc/systemd/system/decks.service`, then
`sudo systemctl enable --now decks`.

On the sandbox directives: `ProtectSystem=strict` remounts the whole filesystem read-only
inside a mount namespace private to the service, and `ReadWritePaths=` hands back only the
service user's home. It is enforced by the kernel's mount table, so every child process
inherits it — including shells the agent spawns, which is the point. It buys integrity, not
confidentiality: the agent can still *read* anything world-readable, so the `750` home from
§4 is what keeps secrets out of reach. `PrivateTmp=yes` is a pair with it, because `strict`
would otherwise leave `/tmp` read-only too.

`systemd-analyze security decks.service` will still report a middling score, and that is
expected: an agent that runs arbitrary code cannot be given a syscall filter or a narrowed
set of address families without breaking the thing it is for.

Two failure modes worth knowing. Writes outside the home fail as `EROFS`, which reads like a
disk fault rather than a policy decision — if the agent should be able to edit a project
elsewhere on the host, add that path to `ReadWritePaths=`. And `ProtectSystem=strict` is the
first directive to relax if the agent starts failing in ways that make no sense.

## 8. HTTPS on a private network

A WireGuard mesh with a hostname service gives TLS for free, on a name that resolves only
inside the network. With Tailscale, once MagicDNS and HTTPS certificates are enabled for the
network:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:4329
tailscale serve status
```

That is the whole configuration. The proxy terminates TLS with a real certificate, forwards
to the loopback port, and handles the WebSocket upgrade without further setup. The client
needs no changes at any point: `socket.ts` derives `wss://` from `location.protocol` and
`api.ts` uses relative paths, so Decks works at whatever origin it is served from.

Worth deciding before you provision, because it is baked into the certificate and published
permanently in public Certificate Transparency logs: **the machine's name becomes part of a
public record.** Only the name, not the content, and it resolves only inside your network —
but rename the machine to something you are happy to publish *before* the first certificate
is issued, not after.

Two more notes:

- **HTTPS is worth it beyond eavesdropping.** A secure context is what unlocks clipboard
  access and other browser APIs the palette benefits from.
- **If the host uses `iptables-persistent`, do not run `netfilter-persistent save` after the
  mesh client is up.** Tailscale installs its own chain dynamically and reinstalls it on
  every start; saving would freeze that moment's rules into a snapshot restored at boot. It
  also means you generally need no firewall rule of your own — the mesh client adds one.

## 9. The clients

A `.ts.net` name resolves only for devices with MagicDNS enabled. Mobile clients usually
enable it by default; desktop ones often do not. If the name fails to resolve while the
machine is plainly visible as a peer, that is the cause rather than the server:

```bash
tailscale set --accept-dns=true      # revert with --accept-dns=false
```

This changes DNS for the whole device, scoped to the network's domain, which is worth
knowing on a machine that also uses a corporate or campus resolver.

## 10. Updating

```bash
sudo -u decks -H bash -c "cd /home/decks/app && git pull && npm ci && npm run build"
sudo systemctl restart decks
```

`npm ci` is cheap when the lockfile has not changed and mandatory when it has. `npm run
build` is required for any change under `apps/web/`, because the browser is served the built
`dist` rather than source. Server-only changes need just the restart — but running the build
anyway also typechecks the server, which is a better default than remembering which kind of
change you made.

Rolling back is `git checkout <sha>` plus the same two lines. Boards and revisions live in
`DECKS_DATA_DIR`, not in the repo, so they are untouched by either direction.

## 11. Verifying

Checks worth making once, in the order that isolates the most likely failures first:

```bash
systemctl is-active decks
journalctl -u decks -n 20                    # expect the deck name and data dir

# bound to loopback and nothing else
sudo ss -tlnp | grep 4329

# from a device on the private network
curl -s -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://<name>/
curl -s https://<name>/api/deck

# the socket, which is the whole application
curl -s -i --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://<name>/ws
```

**`--http1.1` on that last one is not optional.** Over HTTP/2 the `Upgrade` headers are
ignored, the request falls through to the SPA catch-all, and you get `200` and a page of
HTML — a false pass that looks like success. A working socket answers `101 Switching
Protocols` and then immediately sends `deck.state`, the agent list and the model catalogue,
which incidentally confirms §6 worked.

Then the containment checks, which are the ones people skip:

```bash
sudo -u decks -H sudo -n true                # must fail
sudo -u decks -H ls /home/<your-user>/       # must be denied
cat /home/decks/.pi/agent/auth.json          # as your admin user: must be denied
curl -m 5 http://<the-host-public-address>:4329/     # must not connect
```

And confirm the sandbox is real rather than merely declared, by reading the service's own
view of the filesystem — `/` should be `ro`:

```bash
sudo awk '{print $5, $6}' /proc/$(systemctl show -p MainPID --value decks)/mountinfo \
  | grep -E '^(/|/home|/tmp) '
```

## 12. Known edges

- **One deck per deployment.** A deck is a working directory, so "which deck" and "which
  history" are one choice (§2). Serving two decks means two services with two data
  directories on two ports.
- **The agent can modify its own deployment.** `/home/decks/app` is writable by the account
  the agent runs as. That is convenient and worth knowing: an agent asked to fix a bug in
  Decks can edit the copy it is running from. Move the checkout outside the writable path if
  you would rather it could not.
- **No backups are configured.** `DECKS_DATA_DIR` holds the boards, their revisions and the
  arrangement; nothing here replicates it.
- **Restarting is not resuming.** Each start is a new conversation; older ones are reachable
  with `pi -r` from inside the deck directory.
