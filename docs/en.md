# Airzone Cloud

## Overview

This integration connects Gladys Assistant to **Airzone Cloud** to control your
Airzone ducted air conditioning zones from Gladys.

Once configured, every zone of your Airzone Cloud account appears in the Gladys
**Discovery** screen. Each zone exposes these features:

- **Power** — turn the zone on or off;
- **Mode** — cooling, heating, fan, drying or auto (on the master zone only);
- **Temperature** — the target temperature, within the min/max bounds of the zone;
- **Room temperature** — the current temperature measured in the zone (read-only);
- **Humidity** — the relative humidity measured in the zone (read-only).

If your installation includes an Airzone air-quality sensor, it is published as
its own device exposing temperature, humidity, CO2, PM2.5, PM10, TVOC, pressure
and a global air-quality index (all read-only, with history).

Zone states are refreshed every minute, so changes made from the Airzone
thermostat or the Airzone Cloud app show up in Gladys shortly after. That
frequency is deliberately moderate: the Airzone Cloud API rate-limits the number
of requests per account.

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
     secret, never displayed back);
   - **Airzone webserver address (local API)** — optional, but recommended: see
     the "Local API" section below;
   - **Local API port** — optional, 3000 by default;
   - **Verbose logs** — tick it only to diagnose a problem: every refresh is
     then logged in detail in the Logs tab. It takes effect immediately, no
     restart needed.
3. Save. The integration logs in to Airzone Cloud and loads your zones.
4. Open the **Discovery** screen: your zones are listed there. Add the ones you
   want, then place them in your rooms and dashboards like any Gladys device.

The Configuration screen also shows the Airzone Cloud connection status and two
buttons:

- **Test the Airzone Cloud connection** — logs in and counts the zones of your
  account;
- **Refresh the Airzone devices** — reloads the zones and sensors and
  republishes them to Gladys.

Every device carries the **cloud** badge: this integration goes through the
Airzone Cloud service, there is no local connection. The badge turns degraded
(orange dot) for a zone whose last refresh failed, with the reason in the
tooltip.

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
- **Some zones report no temperature** — first make sure those zones have been
  **added** from the Discovery screen: a zone that is only discovered is not a
  Gladys device yet, and the states published for it are ignored. The
  integration logs list the zones that are discovered but not added on every
  start. If the zone is added, its logs tell why the refresh fails (Airzone
  error) or that Airzone reports no room temperature for it (zone without a
  thermostat).
- **Commands seem ignored** — Airzone can take a few seconds to push a command
  to the unit; the state in Gladys reflects the cloud state and catches up at
  the next poll (one minute). Also check that the installation is online in the
  Airzone Cloud app (webserver connected).
- **States stop updating** — the Airzone session may have expired; the
  integration refreshes its token automatically. If the problem persists, check
  the integration logs from its configuration page in Gladys (tick **Verbose
  logs** first to get the detail of every refresh).
