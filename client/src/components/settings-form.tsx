"use client"

import { Button, Card, Stack, TextInput, NumberInput, Switch, Text } from '@mantine/core'
import { useState } from 'react'
import type { AppSettings } from '../types/energy'

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
}

const inputStyles = {
  input: {
    backgroundColor: '#404040',
    border: '1px solid #4A4A4A',
    color: '#E8E0D0',
    borderRadius: '12px',
    height: '44px',
    fontSize: '16px',
  },
  label: {
    color: '#999999',
    fontSize: '14px',
    fontWeight: 400 as const,
    marginBottom: '6px',
  },
}

export function SettingsForm() {
  const [s, setS] = useState<AppSettings>(DEFAULT)

  return (
    <Stack p="lg" gap="md" style={{ width: '100%', maxWidth: 600 }}>
      <Card
        p="md"
        radius="lg"
        style={{
          backgroundColor: '#353535',
          border: '1px solid #4A4A4A',
        }}
      >
        <Text fw={700} mb="sm" c="#E8E0D0">
          Connection
        </Text>

        <Stack gap="sm">
          <TextInput
            label="Gateway IP"
            value={s.device_ip}
            onChange={(e) => setS({ ...s, device_ip: e.target.value })}
            styles={inputStyles}
          />
          <TextInput
            label="MQTT broker"
            value={s.mqtt_broker}
            onChange={(e) => setS({ ...s, mqtt_broker: e.target.value })}
            styles={inputStyles}
          />
          <NumberInput
            label="MQTT port"
            value={s.mqtt_port}
            onChange={(v) => setS({ ...s, mqtt_port: Number(v) })}
            styles={inputStyles}
          />
          <TextInput
            label="MQTT topic"
            value={s.mqtt_topic}
            onChange={(e) => setS({ ...s, mqtt_topic: e.target.value })}
            styles={inputStyles}
          />
          <NumberInput
            label="Poll interval (s)"
            value={s.poll_interval}
            onChange={(v) => setS({ ...s, poll_interval: Number(v) })}
            min={1}
            styles={inputStyles}
          />
        </Stack>
      </Card>

      <Card
        p="md"
        radius="lg"
        style={{
          backgroundColor: '#353535',
          border: '1px solid #4A4A4A',
        }}
      >
        <Text fw={700} mb="sm" c="#E8E0D0">
          Alerts
        </Text>

        <Stack gap="sm">
          <Switch
            label="Notifications"
            checked={s.notifications_enabled}
            onChange={(e) => setS({ ...s, notifications_enabled: e.currentTarget.checked })}
            size="md"
            styles={{
              track: {
                backgroundColor: s.notifications_enabled ? '#F5A623' : '#404040',
                borderColor: s.notifications_enabled ? '#F5A623' : '#4A4A4A',
                cursor: 'pointer',
              },
              thumb: {
                backgroundColor: '#FFFFFF',
                borderColor: s.notifications_enabled ? '#F5A623' : '#4A4A4A',
              },
              label: {
                color: '#E8E0D0',
                fontSize: '14px',
                fontWeight: 400,
                cursor: 'pointer',
              },
            }}
          />
        </Stack>
      </Card>

      <Button
        fullWidth
        radius="xl"
        size="lg"
        onClick={() => console.log('save', s)}
        styles={{
          root: {
            backgroundColor: '#F5A623',
            color: '#1A1A1A',
            fontWeight: 500,
            fontSize: '16px',
            height: '48px',
          },
        }}
      >
        Save
      </Button>
    </Stack>
  )
}
