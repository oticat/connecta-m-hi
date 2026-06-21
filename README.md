# connecta-m'hi

**connecta-m'hi** is an IPK package for the [SMHUB Nano MG24](https://smlight.tech/product/smhub-nano-mg24/) that connects the device to a [Home Assistant](https://www.home-assistant.io/) instance managed by [oti.cat](https://oti.cat).

Once installed, the app appears in the SMHUB sidebar. With a single click you link your SMHUB to your oti.cat Home Assistant instance and then selectively enable three integrations:

| Integration | What it does |
|---|---|
| **Mosquitto bridge** | Extends the SMHUB's local MQTT broker to your HA instance over TLS. Point any Tasmota device at the SMHUB and it auto-discovers in HA. |
| **Zigbee2MQTT** | Connects the built-in Zigbee radio directly to your HA instance via MQTTS. Zigbee devices paired on the SMHUB appear in HA automatically. |
| **LAN proxy** | Bridges your home network to HA. HA can reach any device on your home LAN by IP, and your HA instance is reachable from home at `http://smhub.local:8123`. |

---

## Requirements

- **SMHUB Nano MG24** running SMHUB OS 1.0.0 beta4 or later
- An **oti.cat account** with at least one active Home Assistant instance

---

## Installation

The package will be available at `pkg.smlight.tech` once reviewed. Until then, install manually via SSH.

### Step 1 — Download the IPK

Download the latest `.ipk` file from the [Releases](../../releases/latest) page.

### Step 2 — Copy to SMHUB

```bash
scp dom.oti.cat_<version>-1_all.ipk smlight@smhub.local:/tmp/
```

### Step 3 — Install

```bash
ssh smlight@smhub.local "sudo opkg install /tmp/dom.oti.cat_<version>-1_all.ipk"
```

To upgrade from a previous version:

```bash
ssh smlight@smhub.local "sudo opkg remove dom.oti.cat; sudo opkg install /tmp/dom.oti.cat_<version>-1_all.ipk"
```

After installation, **connecta-m'hi** appears in the SMHUB sidebar.

![SMHUB sidebar entry](docs/screenshots/01-sidebar.png)

---

## Linking to oti.cat

Open the **connecta-m'hi** app from the SMHUB sidebar. Before linking, it shows the device ID and a button to start the process.

![App unlinked state](docs/screenshots/02-unlinked.png)

Click **Link to dom.oti.cat**. A new browser tab opens on the oti.cat website where you can select which of your Home Assistant instances to link to this SMHUB.

![HA instance selector](docs/screenshots/03-link-page.png)

Once you confirm the selection, the tab shows a success message and the app card refreshes automatically — no page reload needed.

![App linked — integrations pending](docs/screenshots/04-linked-pending.png)

The status badge turns green when the WebSocket connection to your HA instance is established.

---

## Integrations

### Mosquitto bridge — Tasmota devices

Click **Apply** next to *Mosquitto bridge*. The app will:

1. Open a password-protected MQTT listener on port **1883** (accessible from your home network)
2. Bridge `tele/#`, `stat/#`, `cmnd/#` and `tasmota/#` topics to your HA instance over MQTTS (port 8883, TLS)
3. Restart the Mosquitto broker

After applying, click **Device setup** to get the connection details and a ready-to-paste Tasmota one-liner.

![Mosquitto device setup](docs/screenshots/05-mqtt-device-setup.png)

Point any Tasmota device at the SMHUB using the displayed credentials. Each device auto-discovers in Home Assistant under **Settings → Devices & Services → MQTT**.

---

### Zigbee2MQTT — Zigbee devices

Click **Apply** next to *Zigbee2MQTT*. The app writes the MQTT connection block directly into Zigbee2MQTT's `configuration.yaml` (server, credentials, client ID, TLS CA) and enables Home Assistant discovery, then restarts Zigbee2MQTT.

After applying, click **Device setup** for the pairing guide.

![Zigbee device setup](docs/screenshots/06-zigbee-setup.png)

Paired Zigbee devices appear in Home Assistant under **Settings → Devices & Services → Zigbee2MQTT** with all sensors, switches, and controls created automatically.

You can also manage Zigbee devices from the Zigbee2MQTT frontend at `http://smhub.local:8080`.

---

### LAN proxy — reach home devices from HA

Click **Apply** next to *LAN proxy*. This enables two things at once:

- **HA accessible at home** — your HA instance is reachable at `http://smhub.local:8123` from any browser on your home network. Use this as the *Local server URL* in the Home Assistant companion app.
- **HA can reach LAN devices** — HA can connect to any device on your home network by its local IP. Just enter the device's IP directly when configuring any integration — no proxy settings needed. Useful for integrations like ESPHome, local cameras, or other local APIs.

---

## Unlink

Each integration has its own **Unlink** button that reverts only that integration. The **Unlink** button at the bottom of the card removes all applied integrations and disconnects the SMHUB from oti.cat entirely.

---

## How it works (architecture overview)

```
SMHUB Nano MG24              oti.cat cloud              Your HA instance
┌─────────────────┐          ┌──────────────┐           ┌───────────────┐
│  connecta-m'hi  │◄─MQTTS──►│  gw (nginx)  │◄─plain──►│  Mosquitto    │
│  (this package) │          │  SNI routing │           │               │
│                 │          └──────────────┘           │  Zigbee2MQTT  │
│  Mosquitto      │                                     │               │
│  (bridge mode)  │◄──WebSocket (wss)───────────────────│  oticonnect   │
│                 │                                     │  sidecar      │
│  Zigbee2MQTT    │──MQTTS direct──────────────────────►│               │
└─────────────────┘                                     └───────────────┘
```

The SMHUB-side app (this package) communicates with a sidecar service running on your HA instance via a persistent WebSocket. The LAN proxy and SOCKS5 tunnel for transparent LAN routing are both multiplexed over this same WebSocket connection — no extra ports needed on the cloud side.

MQTT traffic uses the nginx stream module on `gw.i.oti.cat` for SNI-based routing — each HA instance gets its own subdomain and the connection is terminated at the instance's local Mosquitto broker.

---

## Building from source

Requires `bash`, `tar`, and `binutils` (for `ar`).

```bash
git clone https://github.com/oticat/connecta-m-hi.git
cd connecta-m-hi
bash build.sh
# → out/dom.oti.cat_1.7.7-1_all.ipk
```

To build a specific version:

```bash
VERSION=1.8.0 bash build.sh
```

---

## Releasing

Releases are created via the **Release IPK** GitHub Actions workflow (manual trigger). It builds the IPK, bumps the version in `control/control`, creates a git tag, and publishes a GitHub Release with the IPK attached.

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).

Copyright 2026 [oti.cat](https://oti.cat)
