# Changelog

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
