# Airzone Cloud

## Overview

This integration connects Gladys Assistant to **Airzone Cloud** to control your
Airzone ducted air conditioning zones from Gladys.

Once configured, every zone of your Airzone Cloud account appears in the Gladys
**Discovery** screen. Each zone exposes four features:

- **Power** — turn the zone on or off;
- **Mode** — cooling, heating, fan, drying or auto;
- **Temperature** — the target temperature, within the min/max bounds of the zone;
- **Room temperature** — the current temperature measured in the zone (read-only).

Zone states are refreshed every 10 seconds, so changes made from the Airzone
thermostat or the Airzone Cloud app show up in Gladys shortly after.

## Prerequisites

- An **Airzone Cloud account** ([airzonecloud.com](https://airzonecloud.com))
  with your installation already registered in it: your Airzone system needs an
  Airzone webserver (Airzone Cloud) paired with the Airzone Cloud app.
- The installation must be reachable from Airzone Cloud: this integration talks
  to the Airzone cloud, so your Gladys instance needs Internet access.

## Configuration

1. Install the integration from the Gladys store.
2. Open its **Configuration** screen and fill in:
   - **Airzone Cloud email** — the email address of your Airzone Cloud account;
   - **Airzone Cloud password** — the password of that account (stored as a
     secret, never displayed back).
3. Save. The integration logs in to Airzone Cloud and loads your zones.
4. Open the **Discovery** screen: your zones are listed there. Add the ones you
   want, then place them in your rooms and dashboards like any Gladys device.

To use another Airzone Cloud account later, just update the email and password
in the Configuration screen: the integration reconnects and refreshes the zone
list automatically.

## Troubleshooting

- **"Airzone Cloud is not configured" during discovery** — the email or
  password is missing: fill in both fields in the Configuration screen and save.
- **Login fails** — double-check your credentials by signing in at
  [airzonecloud.com](https://airzonecloud.com).
- **A zone is missing from Discovery** — make sure it is visible in the Airzone
  Cloud app with the same account, then run the discovery again.
- **Commands seem ignored** — Airzone can take a few seconds to push a command
  to the unit; the state in Gladys reflects the cloud state and catches up at
  the next 10-second poll. Also check that the installation is online in the
  Airzone Cloud app (webserver connected).
- **States stop updating** — the Airzone session may have expired; the
  integration refreshes its token automatically. If the problem persists, check
  the integration logs from its configuration page in Gladys.
