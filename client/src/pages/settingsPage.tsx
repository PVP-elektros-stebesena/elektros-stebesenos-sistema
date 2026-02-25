import { Button, Card, Stack, TextInput, NumberInput, Switch, Text } from '@mantine/core';
import { useState } from 'react';
import type { AppSettings } from '../types/energy';

const DEFAULT: AppSettings = {
  device_ip: '192.168.1.142',
  mqtt_broker: '192.168.1.10',
  mqtt_port: 1883,
  mqtt_topic: 'smartgateways/p1',
  poll_interval: 10,
  timezone: 'Europe/Amsterdam',
  dsmr_version: 'DSMR 5.0',
  meter_serial: 'E0021000000000000',
  notifications_enabled: true,
  high_usage_threshold: 3.5,
  retain_days: 90,
};

export function SettingsPage() {
  const [s, setS] = useState<AppSettings>(DEFAULT);

  return (
    <Stack p="lg" gap="md" style={{ width: '100%', maxWidth: 600 }}>
      <Card p="md">
        <Text fw={700} mb="sm">Settings</Text>

        <Stack gap="sm">
          <TextInput label="Gateway IP" value={s.device_ip} onChange={(e) => setS({ ...s, device_ip: e.target.value })} />
          <TextInput label="MQTT broker" value={s.mqtt_broker} onChange={(e) => setS({ ...s, mqtt_broker: e.target.value })} />
          <NumberInput label="MQTT port" value={s.mqtt_port} onChange={(v) => setS({ ...s, mqtt_port: Number(v) })} />
          <TextInput label="MQTT topic" value={s.mqtt_topic} onChange={(e) => setS({ ...s, mqtt_topic: e.target.value })} />
          <NumberInput label="Poll interval (s)" value={s.poll_interval} onChange={(v) => setS({ ...s, poll_interval: Number(v) })} />
          <Switch
            label="Notifications"
            checked={s.notifications_enabled}
            onChange={(e) => setS({ ...s, notifications_enabled: e.currentTarget.checked })}
          />
        </Stack>
      </Card>

      <Button onClick={() => console.log('save', s)}>Save</Button>
    </Stack>
  );
}