import { usePolling } from './usePolling';

export const SETTINGS_DEVICES_QUERY_KEY = ['settings', 'all'] as const;

export interface DeviceOption {
  id: number;
  name: string;
}

export function resolveDeviceSelection(
  requestedDeviceId: string | null,
  devices: DeviceOption[],
): string | null {
  if (requestedDeviceId && devices.some((device) => String(device.id) === requestedDeviceId)) {
    return requestedDeviceId;
  }

  return devices[0] ? String(devices[0].id) : null;
}

export function useDeviceOptions(intervalSeconds = 30) {
  const query = usePolling<DeviceOption[]>(
    SETTINGS_DEVICES_QUERY_KEY,
    '/api/settings',
    { intervalSeconds },
  );

  return {
    ...query,
    devices: query.data ?? [],
  };
}
