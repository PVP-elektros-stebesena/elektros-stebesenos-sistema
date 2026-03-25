import { Button, Card, Stack, TextInput, NumberInput, Switch, Text, Select, MultiSelect } from '@mantine/core'
import { useState, useEffect } from 'react'
import type { AppSettings } from '../types/energy'
import { apiFetch, apiPost, apiPatch } from '../services/apiClient'

interface Device {
  id: number
  name: string
  deviceIp: string | null
  mqttBroker: string | null
  mqttPort: number | null
  mqttTopic: string | null
  pollInterval: number
  isActive: boolean
  notificationChannel: 'email' | 'sms' | 'push' | 'none' | null
  notificationTarget: string | null
}

type NotificationChannel = 'email' | 'sms' | 'push' | 'none'

type NotificationEventType =
  | 'ANOMALY_DETECTED'
  | 'DEVICE_UNREACHABLE'
  | 'DEVICE_RECOVERED'
  | 'REPORT_GENERATED'

interface NotificationSettingsResponse {
  notificationsEnabled: boolean
  selectedEvents: NotificationEventType[]
  availableEvents?: NotificationEventType[]
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
  notification_channel: 'email',
  notification_target: '',
  high_usage_threshold: 3.5,
  retain_days: 90,
}

const inputStyles = {
  input: {
    backgroundColor: '#404040',
    border: '1px solid #4A4A4A',
    color: '#EBEBEB',
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

const EVENT_OPTIONS: { value: NotificationEventType; label: string }[] = [
  { value: 'ANOMALY_DETECTED', label: 'Anomaly detected' },
  { value: 'DEVICE_UNREACHABLE', label: 'Device unreachable' },
  { value: 'DEVICE_RECOVERED', label: 'Device recovered' },
  { value: 'REPORT_GENERATED', label: 'Report generated' },
]

const DEFAULT_SELECTED_EVENTS: NotificationEventType[] = [
  'ANOMALY_DETECTED',
  'DEVICE_UNREACHABLE',
  'DEVICE_RECOVERED',
  'REPORT_GENERATED',
]

export function SettingsForm() {
  const [s, setS] = useState<AppSettings>(DEFAULT)
  const [deviceName, setDeviceName] = useState('P1 Device')
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [selectedEvents, setSelectedEvents] = useState<NotificationEventType[]>(DEFAULT_SELECTED_EVENTS)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const devices = await apiFetch<Device[]>('/api/settings')

        if (devices.length === 0) {
          return
        }

        const device = devices[0]
        setDeviceId(device.id)
        setDeviceName(device.name)

        setS((prev) => ({
          ...prev,
          device_ip: device.deviceIp || '',
          mqtt_broker: device.mqttBroker || '',
          mqtt_port: device.mqttPort || 1883,
          mqtt_topic: device.mqttTopic || '',
          poll_interval: device.pollInterval,
          notification_channel: device.notificationChannel || 'email',
          notification_target: device.notificationTarget || '',
        }))

        try {
          const notificationSettings = await apiFetch<NotificationSettingsResponse>(
            `/api/settings/${device.id}/notifications`,
          )

          setS((prev) => ({
            ...prev,
            notifications_enabled: notificationSettings.notificationsEnabled,
          }))

          setSelectedEvents(
            notificationSettings.selectedEvents?.length
              ? notificationSettings.selectedEvents
              : [],
          )
        } catch (notificationErr) {
          console.error('Failed to load notification settings:', notificationErr)
        }
      } catch (err) {
        console.error('Failed to load settings:', err)
      }
    }

    loadSettings()
  }, [])

  const handleSave = async () => {
    setMessage(null)

    if (!deviceName.trim()) {
      setMessage({ type: 'error', text: 'Device name is required.' })
      return
    }

    const hasDeviceIp = s.device_ip && s.device_ip.trim()
    const hasMqttBroker = s.mqtt_broker && s.mqtt_broker.trim()
    const hasMqttTopic = s.mqtt_topic && s.mqtt_topic.trim()
    const hasMqttPort = s.mqtt_port !== null && s.mqtt_port !== undefined

    if (!hasDeviceIp && !hasMqttBroker && !hasMqttTopic) {
      setMessage({
        type: 'error',
        text: 'Please provide either a device endpoint or complete MQTT configuration (broker, port, and topic).',
      })
      return
    }

    if (!hasDeviceIp) {
      if (!hasMqttBroker) {
        setMessage({ type: 'error', text: 'MQTT broker is required when no Device IP is provided.' })
        return
      }
      if (!hasMqttTopic) {
        setMessage({ type: 'error', text: 'MQTT topic is required when no Device IP is provided.' })
        return
      }
      if (!hasMqttPort) {
        setMessage({ type: 'error', text: 'MQTT port is required when no Device IP is provided.' })
        return
      }
      if (s.mqtt_port < 1 || s.mqtt_port > 65535) {
        setMessage({ type: 'error', text: 'MQTT port must be between 1 and 65535.' })
        return
      }
    }

    if (!s.poll_interval || s.poll_interval < 1) {
      setMessage({ type: 'error', text: 'Poll interval must be at least 1 second.' })
      return
    }

    if (s.poll_interval > 3600) {
      setMessage({ type: 'error', text: 'Poll interval cannot exceed 3600 seconds (1 hour).' })
      return
    }

    if (s.notifications_enabled) {
      if (!s.notification_channel || s.notification_channel === 'none') {
        setMessage({ type: 'error', text: 'Please select a notification channel.' })
        return
      }

      if (
        (s.notification_channel === 'email' || s.notification_channel === 'sms') &&
        !s.notification_target.trim()
      ) {
        setMessage({ type: 'error', text: 'Please enter a notification target.' })
        return
      }

      if (selectedEvents.length === 0) {
        setMessage({ type: 'error', text: 'Please select at least one notification event.' })
        return
      }
    }

    setLoading(true)

    try {
      const deviceData = {
        name: deviceName.trim(),
        deviceIp: s.device_ip || null,
        mqttBroker: s.mqtt_broker || null,
        mqttPort: s.mqtt_port || null,
        mqttTopic: s.mqtt_topic || null,
        pollInterval: s.poll_interval,
        isActive: true,
        notificationChannel: s.notifications_enabled ? s.notification_channel : 'none',
        notificationTarget:
          s.notifications_enabled &&
          (s.notification_channel === 'email' || s.notification_channel === 'sms')
            ? s.notification_target.trim() || null
            : null,
      }

      let savedDeviceId = deviceId

      if (deviceId) {
        await apiPatch<Device, Partial<typeof deviceData>>(`/api/settings/${deviceId}`, deviceData)
      } else {
        const newDevice = await apiPost<Device, typeof deviceData>('/api/settings', deviceData)
        setDeviceId(newDevice.id)
        savedDeviceId = newDevice.id
      }

      if (savedDeviceId === null) {
        throw new Error('Device ID is missing after save.')
      }

      await apiPatch<
        NotificationSettingsResponse,
        { notificationsEnabled: boolean; selectedEvents: NotificationEventType[] }
      >(`/api/settings/${savedDeviceId}/notifications`, {
        notificationsEnabled: s.notifications_enabled,
        selectedEvents,
      })

      setMessage({
        type: 'success',
        text: deviceId ? 'Settings updated successfully!' : 'Settings saved successfully!',
      })
    } catch (err) {
      console.error('Failed to save settings:', err)
      setMessage({ type: 'error', text: 'Failed to save settings. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

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
        <Text fw={400} mb="sm" c="#EBEBEB">
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
            label="Device endpoint"
            placeholder="e.g., 192.168.1.142 or http://gateway.local"
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
        <Text fw={400} mb="sm" c="#EBEBEB">
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
                backgroundColor: s.notifications_enabled ? '#FFCC59' : '#404040',
                borderColor: s.notifications_enabled ? '#FFCC59' : '#4A4A4A',
                cursor: 'pointer',
              },
              thumb: {
                backgroundColor: '#FFFFFF',
                borderColor: s.notifications_enabled ? '#FFCC59' : '#4A4A4A',
              },
              label: {
                color: '#EBEBEB',
                fontSize: '14px',
                fontWeight: 400,
                cursor: 'pointer',
              },
            }}
          />

          {s.notifications_enabled && (
            <>
              <Select
                label="Notification channel"
                value={s.notification_channel as NotificationChannel}
                onChange={(value) =>
                  setS({
                    ...s,
                    notification_channel: (value as NotificationChannel) ?? 'none',
                  })
                }
                data={[
                  { value: 'email', label: 'Email' },
                  { value: 'sms', label: 'SMS' },
                  { value: 'push', label: 'Push notification' },
                  { value: 'none', label: 'None' },
                ]}
                styles={inputStyles}
              />

              {s.notification_channel === 'email' && (
                <TextInput
                  label="Email address"
                  placeholder="e.g. user@example.com"
                  value={s.notification_target}
                  onChange={(e) => setS({ ...s, notification_target: e.target.value })}
                  styles={inputStyles}
                />
              )}

              {s.notification_channel === 'sms' && (
                <TextInput
                  label="Phone number"
                  placeholder="e.g. +37061234567"
                  value={s.notification_target}
                  onChange={(e) => setS({ ...s, notification_target: e.target.value })}
                  styles={inputStyles}
                />
              )}

              {s.notification_channel === 'push' && (
                <Text size="sm" c="dimmed">
                  Push notifications are sent to the connected application.
                </Text>
              )}

              <MultiSelect
                label="Notification events"
                placeholder="Select events"
                data={EVENT_OPTIONS}
                value={selectedEvents}
                onChange={(values) => setSelectedEvents(values as NotificationEventType[])}
                disabled={!s.notifications_enabled}
                clearable
                searchable
                styles={inputStyles}
              />
            </>
          )}
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
            backgroundColor: '#FFCC59',
            color: '#000000',
            fontWeight: 400,
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