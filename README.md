# Gladys Airzone Cloud integration

External integration for [Gladys Assistant](https://gladysassistant.com) that
controls your **Airzone ducted air conditioning** zones through the
[Airzone Cloud](https://airzonecloud.com) service.

Built from the official
[`integration-template-js`](https://github.com/GladysAssistant/integration-template-js)
template with the JavaScript SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

## What it does

- Logs in to Airzone Cloud with the email / password filled in the integration
  settings (the password is a `secret` config field, never sent back to the
  frontend).
- Lists every zone of the Airzone Cloud account (installations, groups and
  systems are flattened to their zones) and publishes them as **discovered
  devices**: the user creates them from the Gladys Discovery screen.
- Each **zone** exposes four features:

  | Feature          | Category / type                           | Mapping                                         |
  | ---------------- | ----------------------------------------- | ----------------------------------------------- |
  | Power            | `air-conditioning` / `binary`             | Airzone `power`                                 |
  | Mode             | `air-conditioning` / `mode`               | Airzone `mode` (cool / heat / fan / dry / auto) |
  | Temperature      | `air-conditioning` / `target-temperature` | Airzone `setpoint`, bounded by the zone range   |
  | Room temperature | `temperature-sensor` / `decimal`          | Airzone `local_temp` (read-only, history kept)  |

- Zones are **polled every 10 seconds** and the states are pushed back to Gladys.
- User commands are written back with `PATCH /devices/{id}` (`{ param, value, installation_id }`).
- The Airzone `installationId` is stored as a device param: Gladys sends the
  params back with every poll / set-value command, and the status / command
  endpoints require it.
- When the Airzone session expires (HTTP 401), the client refreshes the token
  once (falling back to a full login) and retries the request.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring
├─ src/
│  ├─ airzone/client.js              # Airzone Cloud API client (fetch)
│  ├─ devices/convertDevice.js       # Airzone zone -> Gladys discovery payload
│  ├─ devices/zone.js                # zone features + value mappings
│  ├─ constants.js                   # Airzone constants (+ AC modes, poll frequency)
│  └─ config.js                      # config defaults + normalization
├─ test/                             # node:test unit + end-to-end tests
├─ gladys-assistant-integration.json # manifest (name, config schema, image…)
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ .github/workflows/ci.yml          # lint, format check and tests
├─ .github/workflows/release.yml     # UI-driven release: bump + tag + build
└─ .github/workflows/build.yml       # multi-arch build (git tag or called by release)
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="airzone-cloud" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the
integration runs inside its sandboxed container. The SDK reads them
automatically.

## Tests

```bash
npm test
```

The test suite needs no network and no Airzone account: unit tests cover the
zone conversion, the API client and the value mappings, and an end-to-end test
boots the real integration process against a fake Gladys host (WebSocket +
REST) and a fake Airzone Cloud API, then exercises discovery, polling and
commands.

## Notes

Airzone Cloud is a reverse-engineered cloud API (the one used by the official
mobile app), the same approach as the Home Assistant `airzone_cloud`
integration. It requires an Airzone webserver (Airzone Cloud) associated with
your account and Internet access from your Gladys instance.

## License

Apache-2.0
