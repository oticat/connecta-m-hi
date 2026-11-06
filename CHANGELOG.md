# Changelog

## 1.15.0

- **The camera relay follows the control plane.** The link payload used to be a
  snapshot: a cam JWT bound to one relay id, stored forever. Creating, deleting
  or replacing a relay then needed an Update link by hand. The hub now keeps the
  device-scoped token and asks `GET /api/cameras/endpoint` for the current relay
  — at boot, after every link, every 5 minutes while connected, every minute
  while the cam socket is down, and immediately when it drops (which also
  refreshes the short-lived cam token). A different `ws` reconnects the socket; a
  missing relay clears the camera link. No relink when a relay changes.
- The endpoint answer wins over `config.json` (`camRuntime`), so the refreshed
  one-hour cam token is not written to flash every few minutes. Only a relay
  change is persisted.
- **Revoke works for camera-only links.** `/unlink` falls back to the device
  token, and `/api/ha/link/revoke` accepts it (`scope: "device"`), so a hub with
  no HA instance can drop its own link.
- `DOMOTICAT_API`, `DOMOTICAT_CAM_POLL_CONNECTED_MS` and
  `DOMOTICAT_CAM_POLL_BROKEN_MS` are test hooks; `test/camera-endpoint.js` runs
  the real server against a fake control plane and proves the relay switch.

## 1.14.2

- **Relink without unlinking.** The linked page gains an **Update link** button
  that runs the same link flow as a fresh setup and stores the new payload with
  `relink: true`. `/store` keeps the applied integrations when the Home
  Assistant instance is unchanged and only resets them to pending when the
  instance's WebSocket URL differs; `/unlink` remains the only thing that tears
  them down. Fixes having to unlink (and lose the LAN proxy/VPN) just to pick up
  a new or re-created camera relay.
- **Camera-only devices can complete a link.** The unlinked page's poll only
  accepted a payload with an HA `token`, so a camera-only link (`token: null`)
  was polled forever and never stored. It now accepts either connection.

## 1.14.1

- Discovery waits 4 s and drops WS-Discovery responders that are not ONVIF
  (NAS, printers), which answer the generic probe too. Labels combine the
  ONVIF name and hardware (`IPC-BO RLC-510A`).

## 1.14.0

- **ONVIF discovery for the camera service.** `GET /discover` runs a
  WS-Discovery probe on the LAN, and the `cam` WebSocket accepts a `discover`
  request and replies with `discover_result` (id + devices). The relay's
  `cam-agent` uses this to list the cameras it can reach without exposing a
  discovery socket itself.

## 1.13.0

- **Camera-only link.** A hub can now be linked to a camera relay with no Home
  Assistant instance. `/store` accepts a payload whose only connection is
  `cam`, the page is considered linked when either `token` or `cam` exists, the
  status badge follows `camConnected` when there is no HA, and the MQTT/Z2M
  integrations are hidden because there is no broker to bridge to. The server
  side offers "Link cameras only" when the user has a relay but no instance.
- `device_link.instance_id` is nullable to allow that row.

## 1.12.0

- **Two WebSocket connections: HA and the camera relay.** `server.js` used to
  hold a single connection. It now keeps independent `ha` and `cam` sockets,
  each with its own backoff, token and tunnel maps. The `ha` socket keeps the
  existing sidecar work (credentials, LAN proxy, Open SMHUB, UDP forwards); the
  `cam` socket carries only the camera tunnel to the per-customer media relay.
  Video can no longer head-of-line-block HA control traffic.
- **Optional camera link.** `config.json` gains `cam: {token, wsUrl}`. `/store`
  accepts an optional `cam` object and leaves an existing link untouched when
  it is absent; `/status.json` reports `camConnected` alongside `connected`.
  Hubs without a `cam` entry behave exactly as before.
- **Local test hooks.** `DOMOTICAT_PORT` and `DOMOTICAT_CONFIG_DIR` let the
  server run against a temporary config in integration tests.

## 1.11.2

- **VPN-bridge conflict banner reworded.** It claimed "LAN proxy takes precedence for TCP traffic",
  which stopped being the whole story once UDP forwards landed in 1.10.0: a configured UDP endpoint
  is DNAT'd to the hub in `nat OUTPUT`, so it overrides the VPN route too. The banner now states the
  real split — LAN proxy takes TCP, configured UDP endpoints take those flows, everything else keeps
  using the VPN bridge — and notes that broadcast discovery only works over the VPN, since the
  forwards are unicast per (ip, port).

  It also said "Conflicts with d't HUB", which reads oddly inside the d't HUB app itself; the subject
  is now "a VPN bridge", matching the portal's own wording.

## 1.11.1

- **LAN proxy modal copy: TCP vs UDP.** The "Local HA access" and "Enable LAN proxy?" modals
  claimed HA could reach any LAN device transparently. That is true for TCP only — the transparent
  routing is a TCP redirect through redsocks, so UDP-only integrations (Broadlink IR blasters and
  similar) are not covered. Both modals now say TCP explicitly and point the user at the UDP
  forwards in the d't HUB device connection modal at dom.oti.cat.

## 1.11.0

- **Sidebar icon shipped by the package.** SMHUB 1.0.2 added `GET /smhub/packages/<key>/icon`,
  which resolves the icon from the package's own schema, so the icon no longer has to be patched
  into SMLIGHT's React bundle — a patch that was keyed to the bundle's content hash and did not
  survive the 1.0.2 firmware upgrade. `schema.json` now declares `system.icons.icon` and the file
  ships as `icon.svg`.

- **Payload moved from `/opt/oticonnect` to `/opt/dom.oti.cat`.** The icon path is resolved
  against `PACKAGE_BASE/<package>` (`/opt/<package>`) and rejected if it escapes that directory,
  so the app's own directory has to be named after the package for the icon to be served at all.
  `config.json` moves with it.

  `config.json` is written at runtime and so is not owned by opkg, which means the upgrade does
  not carry it across. On a hub coming from <= 1.10.0 it must be copied into the new directory
  before the new version starts, or the hub comes back up unlinked.

## 1.10.0

- **UDP forwards: reach UDP-only LAN devices from Home Assistant.** The existing LAN proxy is
  TCP-only (redsocks has no UDP support, and SOCKS5 `UDP ASSOCIATE` is not implemented), so
  devices that speak UDP — Broadlink IR blasters being the common case, which use UDP/80 for
  everything — were unreachable even with the hub connected.

  The HA sidecar now DNATs a specific `(LAN ip, port)` pair to one of its own local sockets and
  relays each datagram here over the existing WebSocket as a new `udp` frame; we replay it onto
  the LAN and send replies back. Because the destination is encoded in the iptables rule, each
  socket serves exactly one target and no per-datagram destination recovery (TPROXY) is needed.
  Conntrack rewrites the reply's source back to the device, so HA is none the wiser.

  Forwards are managed by the instance owner from the d't HUB modal on dom.oti.cat.

- **Capability advertisement in `hello`.** The frame now carries `version` (read from opkg's own
  control file, so it can't drift) and `features`. The sidecar installs UDP rules only for a hub
  that advertises `udp` — without this an updated sidecar paired with an older hub would install
  rules that silently swallow traffic a VPN bridge might otherwise carry. Older hubs are
  unaffected: they ignore unknown frames and simply never get UDP forwards.

## 1.9.2

- **Mosquitto: defer to the SMHUB's native broker (Option B).** We no longer write our own
  `listener 1883` + `password_file` into `conf.d` — that collided with the SMHUB's own
  "Mosquitto MQTT Broker" page (duplicate `listener`/`password_file` → mosquitto refused to
  start once a user configured MQTT in the UI). Now `applyMosquitto`:
  - writes a **bridge-only** `conf.d/oti-bridge.conf` (just the `connection` to the HA instance),
  - registers the HA MQTT user via the SMHUB API (`POST /users/create-mqtt-user` →
    `/var/lib/mosquitto/passwd`),
  - brings up the native listener via `POST /pages/mqtt/settings`
    (`port 1883`, `allow_external`, `allow_anonymous: false`).
  The SMHUB's listener is now the single owner of port 1883. `removeMosquitto` deletes only our
  bridge file and leaves the SMHUB broker intact. The idempotent `include_dir` append is kept as
  a safety net (mosquitto is a base-OS component here, not an opkg package).

## 1.9.1

- **Zigbee2MQTT `client_id`**: the z2m config written on Apply now sets a unique
  `client_id` (`z2m_<mac>`, path `mqtt.client_id`) via the SMHUB settings API. Without it,
  two SMHUBs bridged to the same HA instance share z2m's default client id and the broker
  kicks them off in a duplicate-client-id disconnect loop (`base_topic` separates topics but
  not the connection). Cleared again on Remove. Requires `zigbee2mqtt ≥ 2.12.1` (the release
  that added the `client_id` schema field).

## 1.9.0

Config-system rework to align with the SMHUB packaging conventions (ahead of hosting on
`pkg.smlight.tech`). The package now integrates through the SMHUB's schema-driven config
system instead of hand-editing files the OS owns.

- **schema.json** moved to `control/` and reformatted to the canonical `system` block
  (`iframe_port`/`service` with types). The SMHUB backend now derives the app registration,
  sidebar entry and stunnel HTTPS port from it.
- **postinst** greatly simplified: no longer writes to the SMHUB backend DB, the opkg lists,
  or stunnel config — it only enables/starts the service (plus cleanup of pre-schema cruft).
- **Zigbee2MQTT** config is now written through the SMHUB packages settings API
  (`POST /api/v1/smhub/packages/zigbee2mqtt/settings`), so it persists in the SMHUB config
  store and is no longer clobbered when the z2m settings page is opened. `configuration.yaml`
  is no longer edited directly.
- **Self-healing boot reconcile removed** — no longer needed now that config lives in the
  SMHUB config store.
- **postrm** added: on uninstall (only), removes the mosquitto bridge config so mosquitto
  returns to local-only mode.
