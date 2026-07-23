// Shared Airzone Cloud API fixtures (shapes taken from the real Airzone API).

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

// GET /devices/zone-1/status : mode 3 is "heating" on Airzone.
export const ZONE_STATUS = {
  power: true,
  mode: 3,
  setpoint: 21,
  local_temp: 19.5,
  range_sp_min: 16,
  range_sp_max: 30,
};
