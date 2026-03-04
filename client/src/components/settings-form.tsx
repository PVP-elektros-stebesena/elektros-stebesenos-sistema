"use client"

import { Button, Card, Stack, TextInput, NumberInput, Switch, Text } from '@mantine/core'
import { useState, useEffect } from 'react'
import type { AppSettings } from '../types/energy'
import { apiFetch, apiPost, apiPatch } from '../services/apiClient'

interface Device {
  id: number;
  name: string;
  deviceIp: string | null;
  mqttBroker: string | null;
  mqttPort: number | null;
  mqttTopic: string | null;
  pollInterval: number;
  isActive: boolean;
}

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
  const [deviceName, setDeviceName] = useState('P1 Device')
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    // Load existing device settings
    apiFetch<Device[]>('/api/settings')
      .then((devices) => {
        if (devices.length > 0) {
          const device = devices[0]; // Use the first device
          setDeviceId(device.id);
          setDeviceName(device.name);
          setS({
            device_ip: device.deviceIp || '',
            mqtt_broker: device.mqttBroker || '',
            mqtt_port: device.mqttPort || 1883,
            mqtt_topic: device.mqttTopic || '',
            poll_interval: device.pollInterval,
            timezone: s.timezone,
            dsmr_version: s.dsmr_version,
            meter_serial: s.meter_serial,
            notifications_enabled: s.notifications_enabled,
            high_usage_threshold: s.high_usage_threshold,
            retain_days: s.retain_days,
          });
        }
      })
      .catch((err) => {
        console.error('Failed to load settings:', err);
      });
  }, []);

  const handleSave = async () => {
    setMessage(null);

    if (!deviceName.trim()) {
      setMessage({ type: 'error', text: 'Device name is required.' });
      return;
    }

    const hasDeviceIp = s.device_ip && s.device_ip.trim();
    const hasMqttBroker = s.mqtt_broker && s.mqtt_broker.trim();
    const hasMqttTopic = s.mqtt_topic && s.mqtt_topic.trim();
    const hasMqttPort = s.mqtt_port !== null && s.mqtt_port !== undefined;

    const hasMqttConfig = hasMqttBroker && hasMqttTopic && hasMqttPort;

    if (!hasDeviceIp && !hasMqttConfig) {
      setMessage({ 
        type: 'error', 
        text: 'Please provide either Device IP or complete MQTT configuration (broker, port, and topic).' 
      });
      return;
    }

    if (hasDeviceIp) {
      const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (!ipPattern.test(s.device_ip.trim())) {
        setMessage({ type: 'error', text: 'Invalid IP address format.' });
        return;
      }
      const parts = s.device_ip.split('.');
      if (parts.some(part => parseInt(part) > 255)) {
        setMessage({ type: 'error', text: 'Invalid IP address. Each part must be 0-255.' });
        return;
      }
    }

    if (hasMqttBroker || hasMqttTopic || hasMqttPort) {
      if (!hasMqttBroker) {
        setMessage({ type: 'error', text: 'MQTT broker is required when configuring MQTT.' });
        return;
      }
      if (!hasMqttTopic) {
        setMessage({ type: 'error', text: 'MQTT topic is required when configuring MQTT.' });
        return;
      }
      if (!hasMqttPort) {
        setMessage({ type: 'error', text: 'MQTT port is required when configuring MQTT.' });
        return;
      }
    }

    if (hasMqttPort) {
      if (s.mqtt_port < 1 || s.mqtt_port > 65535) {
        setMessage({ type: 'error', text: 'MQTT port must be between 1 and 65535.' });
        return;
      }
    }

    if (!s.poll_interval || s.poll_interval < 1) {
      setMessage({ type: 'error', text: 'Poll interval must be at least 1 second.' });
      return;
    }

    if (s.poll_interval > 3600) {
      setMessage({ type: 'error', text: 'Poll interval cannot exceed 3600 seconds (1 hour).' });
      return;
    }

    setLoading(true);

    try {
      const deviceData = {
        name: deviceName.trim(),
        deviceIp: s.device_ip || null,
        mqttBroker: s.mqtt_broker || null,
        mqttPort: s.mqtt_port || null,
        mqttTopic: s.mqtt_topic || null,
        pollInterval: s.poll_interval,
        isActive: true,
      };

      if (deviceId) {
        await apiPatch<Device, Partial<typeof deviceData>>(`/api/settings/${deviceId}`, deviceData);
        setMessage({ type: 'success', text: 'Settings updated successfully!' });
      } else {
        const newDevice = await apiPost<Device, typeof deviceData>('/api/settings', deviceData);
        setDeviceId(newDevice.id);
        setMessage({ type: 'success', text: 'Settings saved successfully!' });
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      setMessage({ type: 'error', text: 'Failed to save settings. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

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
            label="Device Name"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="e.g., P1 Device"
            styles={inputStyles}
          />
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
        onClick={handleSave}
        loading={loading}
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

      {message && (
        <Card
          p="sm"
          radius="lg"
          style={{
            backgroundColor: message.type === 'success' ? '#2d4a2b' : '#4a2b2b',
            border: `1px solid ${message.type === 'success' ? '#4a7c47' : '#7c4747'}`,
          }}
        >
          <Text c={message.type === 'success' ? '#9ddb9a' : '#db9a9a'} size="sm">
            {message.text}
          </Text>
        </Card>
      )}
    </Stack>
  )
}
