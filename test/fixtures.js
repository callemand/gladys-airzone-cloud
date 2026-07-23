// Shared Airzone Cloud API fixtures (shapes taken from the real Airzone API:
// temperatures are `{ celsius, fah }` objects, setpoints/ranges are per-mode,
// and only the master zone advertises `mode_available`).

export const ZONE_DEVICE = {
  device_id: 'zone-1',
  name: 'Living room',
  type: 'az_zone',
  ws_type: 'ws_az',
};

export const SYSTEM_DEVICE = {
  device_id: 'system-1',
  name: 'System',
  type: 'az_system',
};

// GET /installations
export const INSTALLATIONS_RESPONSE = {
  installations: [{ installation_id: 'install-1' }],
};

// GET /installations/install-1 : a group with one zone and one system.
export const INSTALLATION_DETAIL_RESPONSE = {
  groups: [
    {
      devices: [ZONE_DEVICE, SYSTEM_DEVICE],
    },
  ],
};

// GET /devices/zone-1/status : a master zone (advertises mode_available) in
// heating mode (Airzone mode 3). Temperatures are Celsius/Fahrenheit objects
// and the setpoint/range live in the mode-specific "heat"/"hot" fields.
export const ZONE_STATUS = {
  power: true,
  mode: 3,
  mode_available: [2, 3, 4, 5],
  local_temp: { celsius: 19.5, fah: 67 },
  setpoint_air_heat: { celsius: 21, fah: 70 },
  range_sp_hot_air_min: { celsius: 16, fah: 61 },
  range_sp_hot_air_max: { celsius: 30, fah: 86 },
  humidity: 42,
  // aq_present but no particulate sensor: values stay null (real-world case).
  aq_present: true,
  aqpm2_5: null,
  aqpm10: null,
};

// A non-master zone (no mode_available): same system mode, but it cannot change
// the mode, so it exposes no Mode feature. In cooling mode (2) here.
export const REGULAR_ZONE_STATUS = {
  power: false,
  mode: 2,
  local_temp: { celsius: 24.2, fah: 76 },
  setpoint_air_cool: { celsius: 25, fah: 77 },
  range_sp_cool_air_min: { celsius: 18, fah: 64 },
  range_sp_cool_air_max: { celsius: 30, fah: 86 },
  humidity: 55,
};

// A zone that actually ships a particulate sensor (rare): PM2.5 / PM10 report
// numeric values, so the air-quality features are exposed.
export const AIR_QUALITY_ZONE_STATUS = {
  power: true,
  mode: 2,
  local_temp: { celsius: 23, fah: 73 },
  setpoint_air_cool: { celsius: 24, fah: 75 },
  range_sp_cool_air_min: { celsius: 18, fah: 64 },
  range_sp_cool_air_max: { celsius: 30, fah: 86 },
  humidity: 48,
  aq_present: true,
  aqpm2_5: 12,
  aqpm10: 20,
};
