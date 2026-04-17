import { Button, Card, Stack, TextInput, NumberInput, Switch, Text, Select, MultiSelect, Group, SimpleGrid, Badge } from '@mantine/core'
import { useState, useEffect } from 'react'
import type { AppSettings, BillingPlan, PowerProfilePreset, PricingMode } from '../types/energy'
import { apiDelete, apiFetch, apiPost, apiPatch, apiPut } from '../services/apiClient'
import { useI18n } from '../i18n/i18n'

interface Device {
  id: number
  name: string
  deviceIp: string | null
  mqttBroker: string | null
  mqttPort: number | null
  mqttTopic: string | null
  powerProfile: PowerProfilePreset
  pollInterval: number
  isActive: boolean
  notificationChannel: 'email' | 'sms' | 'push' | 'none' | null
  notificationTarget: string | null
  billingPlan?: BillingPlan | null
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

interface BillingPlanResponse {
  activePlan: BillingPlan | null
  history: BillingPlan[]
}

interface SaveBillingPlanResponse {
  billingPlan: BillingPlan
  activePlan: BillingPlan | null
}

const DEFAULT: AppSettings = {
  device_ip: '192.168.1.142',
  mqtt_broker: '192.168.1.10',
  mqtt_port: 1883,
  mqtt_topic: 'smartgateways/p1',
  power_profile: 'HOUSE_3P_11KW',
  poll_interval: 10,
  timezone: 'Europe/Amsterdam',
  dsmr_version: 'DSMR 5.0',
  meter_serial: 'E0021000000000000',
  notifications_enabled: true,
  notification_channel: 'email',
  notification_target: '',
  pricing_mode: 'FIXED',
  rate_t1: null,
  rate_t2: null,
  rate_t3: null,
  rate_t4: null,
  monthly_fixed_fee_eur: null,
  spot_adder_eur_per_kwh: 0,
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

const DEFAULT_SELECTED_EVENTS: NotificationEventType[] = [
  'ANOMALY_DETECTED',
  'DEVICE_UNREACHABLE',
  'DEVICE_RECOVERED',
  'REPORT_GENERATED',
]

const POWER_PROFILE_OPTIONS: { value: PowerProfilePreset; label: string }[] = [
  { value: 'APARTMENT_1P_5KW', label: '1-Phase Apartment (5 kW / 25 A)' },
  { value: 'APARTMENT_1P_7KW', label: '1-Phase Apartment Plus (7 kW / 32 A)' },
  { value: 'HOUSE_3P_11KW', label: '11 kW 3-Phase House (16 A)' },
  { value: 'HOUSE_3P_18KW', label: '18 kW 3-Phase House (25 A)' },
  { value: 'SOLAR_PROSUMER_3P_22KW', label: 'Solar Prosumer (22 kW / 32 A)' },
]

const EMPTY_DEVICE_SETTINGS: AppSettings = {
  ...DEFAULT,
  device_ip: '',
  mqtt_broker: '',
  mqtt_port: 1883,
  mqtt_topic: '',
  power_profile: 'HOUSE_3P_11KW',
  poll_interval: 10,
  notifications_enabled: true,
  notification_channel: 'email',
  notification_target: '',
  pricing_mode: 'FIXED',
  rate_t1: null,
  rate_t2: null,
  rate_t3: null,
  rate_t4: null,
  monthly_fixed_fee_eur: null,
  spot_adder_eur_per_kwh: 0,
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value === '' || value == null) {
    return null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function billingPlanToSettings(plan: BillingPlan | null): Pick<
AppSettings,
'pricing_mode' | 'rate_t1' | 'rate_t2' | 'rate_t3' | 'rate_t4' | 'monthly_fixed_fee_eur' | 'spot_adder_eur_per_kwh'
> {
  if (!plan) {
    return {
      pricing_mode: 'FIXED',
      rate_t1: null,
      rate_t2: null,
      rate_t3: null,
      rate_t4: null,
      monthly_fixed_fee_eur: null,
      spot_adder_eur_per_kwh: 0,
    }
  }

  return {
    pricing_mode: plan.pricingMode,
    rate_t1: plan.fixedRates?.t1 ?? null,
    rate_t2: plan.fixedRates?.t2 ?? null,
    rate_t3: plan.fixedRates?.t3 ?? null,
    rate_t4: plan.fixedRates?.t4 ?? null,
    monthly_fixed_fee_eur: plan.monthlyFixedFeeEur,
    spot_adder_eur_per_kwh: plan.dynamic?.spotAdderEurPerKwh ?? 0,
  }
}

function billingPlanSignatureFromSettings(settings: AppSettings): string {
  return JSON.stringify({
    pricingMode: settings.pricing_mode,
    fixedRates: settings.pricing_mode === 'FIXED'
      ? {
          t1: settings.rate_t1,
          t2: settings.rate_t2,
          t3: settings.rate_t3,
          t4: settings.rate_t4,
        }
      : null,
    dynamic: settings.pricing_mode === 'DYNAMIC'
      ? {
          provider: 'ELERING',
          zone: 'LT',
          spotAdderEurPerKwh: settings.spot_adder_eur_per_kwh ?? 0,
        }
      : null,
    monthlyFixedFeeEur: settings.monthly_fixed_fee_eur,
  })
}

function billingPlanSignature(plan: BillingPlan | null): string | null {
  if (!plan) {
    return null
  }

  return JSON.stringify({
    pricingMode: plan.pricingMode,
    fixedRates: plan.fixedRates,
    dynamic: plan.dynamic,
    monthlyFixedFeeEur: plan.monthlyFixedFeeEur,
  })
}

function hasBillingPlanInput(settings: AppSettings): boolean {
  if (settings.pricing_mode === 'FIXED') {
    return [
      settings.rate_t1,
      settings.rate_t2,
      settings.rate_t3,
      settings.rate_t4,
      settings.monthly_fixed_fee_eur,
    ].some((value) => value != null)
  }

  return true
}

export function SettingsForm() {
  const { t, language, setLanguage } = useI18n()
  const defaultDeviceName = t('settings.defaultDeviceName')
  const [s, setS] = useState<AppSettings>(EMPTY_DEVICE_SETTINGS)
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceName, setDeviceName] = useState(defaultDeviceName)
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [selectedEvents, setSelectedEvents] = useState<NotificationEventType[]>(DEFAULT_SELECTED_EVENTS)
  const [activeBillingPlan, setActiveBillingPlan] = useState<BillingPlan | null>(null)

  const selectedDevice = deviceId ? devices.find((device) => device.id === deviceId) ?? null : null

  const applyBillingPlanToForm = (plan: BillingPlan | null) => {
    setActiveBillingPlan(plan)
    setS((prev) => ({
      ...prev,
      ...billingPlanToSettings(plan),
    }))
  }

  const applyDeviceToForm = (device: Device) => {
    setDeviceId(device.id)
    setDeviceName(device.name)
    setS((prev) => ({
      ...prev,
      device_ip: device.deviceIp || '',
      mqtt_broker: device.mqttBroker || '',
      mqtt_port: device.mqttPort || 1883,
      mqtt_topic: device.mqttTopic || '',
      power_profile: device.powerProfile,
      poll_interval: device.pollInterval,
      notification_channel: device.notificationChannel || 'email',
      notification_target: device.notificationTarget || '',
      ...billingPlanToSettings(device.billingPlan ?? null),
    }))
    setActiveBillingPlan(device.billingPlan ?? null)
  }

  const resetFormForNewDevice = () => {
    setDeviceId(null)
    setDeviceName(defaultDeviceName)
    setS(EMPTY_DEVICE_SETTINGS)
    setSelectedEvents(DEFAULT_SELECTED_EVENTS)
    setActiveBillingPlan(null)
  }

  const loadNotificationSettings = async (id: number) => {
    try {
      const notificationSettings = await apiFetch<NotificationSettingsResponse>(
        `/api/settings/${id}/notifications`,
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
  }

  const loadBillingPlan = async (id: number) => {
    try {
      const billingPlanResponse = await apiFetch<BillingPlanResponse>(
        `/api/settings/${id}/billing-plan`,
      )
      applyBillingPlanToForm(billingPlanResponse.activePlan)
    } catch (billingPlanErr) {
      console.error('Failed to load billing plan:', billingPlanErr)
      applyBillingPlanToForm(null)
    }
  }

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const loadedDevices = await apiFetch<Device[]>('/api/settings')
        setDevices(loadedDevices)

        if (loadedDevices.length === 0) {
          resetFormForNewDevice()
          return
        }

        const device = loadedDevices[0]
        applyDeviceToForm(device)
        await Promise.all([
          loadNotificationSettings(device.id),
          loadBillingPlan(device.id),
        ])
      } catch (err) {
        console.error('Failed to load settings:', err)
      }
    }

    void loadSettings()
  }, [])

  const handleSelectDevice = async (value: string | null) => {
    if (!value) {
      return
    }

    const nextDeviceId = Number(value)
    const nextDevice = devices.find((device) => device.id === nextDeviceId)

    if (!nextDevice) {
      return
    }

    setMessage(null)
    applyDeviceToForm(nextDevice)
    await Promise.all([
      loadNotificationSettings(nextDevice.id),
      loadBillingPlan(nextDevice.id),
    ])
  }

  const handleCreateNewDevice = () => {
    setMessage(null)
    resetFormForNewDevice()
  }

  const handleToggleConnection = async () => {
    if (!selectedDevice) {
      setMessage({ type: 'error', text: t('settings.errorSelectDeviceFirst') })
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      const updatedDevice = await apiPatch<Device, { isActive: boolean }>(
        `/api/settings/${selectedDevice.id}`,
        { isActive: !selectedDevice.isActive },
      )

      setDevices((prev) =>
        prev.map((device) => (device.id === updatedDevice.id ? updatedDevice : device)),
      )

      setMessage({
        type: 'success',
        text: updatedDevice.isActive
          ? t('settings.successDeviceConnected', { name: updatedDevice.name })
          : t('settings.successDeviceDisconnected', { name: updatedDevice.name }),
      })
    } catch (err) {
      console.error('Failed to toggle device connection:', err)
      setMessage({ type: 'error', text: t('settings.errorUpdateConnection') })
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveDevice = async () => {
    if (!selectedDevice) {
      setMessage({ type: 'error', text: t('settings.errorSelectDeviceFirst') })
      return
    }

    const shouldDelete = window.confirm(t('settings.confirmRemoveDevice', { name: selectedDevice.name }))
    if (!shouldDelete) {
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      await apiDelete(`/api/settings/${selectedDevice.id}`)

      const remainingDevices = devices.filter((device) => device.id !== selectedDevice.id)
      setDevices(remainingDevices)

      if (remainingDevices.length > 0) {
        const nextDevice = remainingDevices[0]
        applyDeviceToForm(nextDevice)
        await Promise.all([
          loadNotificationSettings(nextDevice.id),
          loadBillingPlan(nextDevice.id),
        ])
      } else {
        resetFormForNewDevice()
      }

      setMessage({ type: 'success', text: t('settings.successDeviceRemoved') })
    } catch (err) {
      console.error('Failed to remove device:', err)
      setMessage({ type: 'error', text: t('settings.errorRemoveDevice') })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setMessage(null)

    if (!deviceName.trim()) {
      setMessage({ type: 'error', text: t('settings.errorDeviceNameRequired') })
      return
    }

    const hasDeviceIp = s.device_ip && s.device_ip.trim()
    const hasMqttBroker = s.mqtt_broker && s.mqtt_broker.trim()
    const hasMqttTopic = s.mqtt_topic && s.mqtt_topic.trim()
    const hasMqttPort = s.mqtt_port !== null && s.mqtt_port !== undefined

    if (!hasDeviceIp && !hasMqttBroker && !hasMqttTopic) {
      setMessage({
        type: 'error',
        text: t('settings.errorProvideEndpointOrMqtt'),
      })
      return
    }

    if (!hasDeviceIp) {
      if (!hasMqttBroker) {
        setMessage({ type: 'error', text: t('settings.errorMqttBrokerRequired') })
        return
      }
      if (!hasMqttTopic) {
        setMessage({ type: 'error', text: t('settings.errorMqttTopicRequired') })
        return
      }
      if (!hasMqttPort) {
        setMessage({ type: 'error', text: t('settings.errorMqttPortRequired') })
        return
      }
      if (s.mqtt_port < 1 || s.mqtt_port > 65535) {
        setMessage({ type: 'error', text: t('settings.errorMqttPortRange') })
        return
      }
    }

    if (!s.poll_interval || s.poll_interval < 1) {
      setMessage({ type: 'error', text: t('settings.errorPollIntervalMin') })
      return
    }

    if (s.poll_interval > 3600) {
      setMessage({ type: 'error', text: t('settings.errorPollIntervalMax') })
      return
    }

    if (s.notifications_enabled) {
      if (!s.notification_channel || s.notification_channel === 'none') {
        setMessage({ type: 'error', text: t('settings.errorNotificationChannel') })
        return
      }

      if (
        (s.notification_channel === 'email' || s.notification_channel === 'sms') &&
        !s.notification_target.trim()
      ) {
        setMessage({ type: 'error', text: t('settings.errorNotificationTarget') })
        return
      }

      if (selectedEvents.length === 0) {
        setMessage({ type: 'error', text: t('settings.errorSelectEvent') })
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
        powerProfile: s.power_profile,
        pollInterval: s.poll_interval,
        isActive: selectedDevice?.isActive ?? true,
        notificationChannel: s.notifications_enabled ? s.notification_channel : 'none',
        notificationTarget:
          s.notifications_enabled &&
          (s.notification_channel === 'email' || s.notification_channel === 'sms')
            ? s.notification_target.trim() || null
            : null,
      }

      let savedDeviceId = deviceId
      let savedDevice: Device | null = selectedDevice

      if (deviceId) {
        const updatedDevice = await apiPatch<Device, Partial<typeof deviceData>>(
          `/api/settings/${deviceId}`,
          deviceData,
        )
        savedDevice = updatedDevice
        setDevices((prev) =>
          prev.map((device) => (device.id === updatedDevice.id ? updatedDevice : device)),
        )
      } else {
        const newDevice = await apiPost<Device, typeof deviceData>('/api/settings', deviceData)
        savedDevice = newDevice
        setDevices((prev) => [newDevice, ...prev])
        setDeviceId(newDevice.id)
        savedDeviceId = newDevice.id
      }

      if (savedDeviceId === null) {
        throw new Error(t('settings.errorMissingDeviceIdAfterSave'))
      }

      await apiPatch<
        NotificationSettingsResponse,
        { notificationsEnabled: boolean; selectedEvents: NotificationEventType[] }
      >(`/api/settings/${savedDeviceId}/notifications`, {
        notificationsEnabled: s.notifications_enabled,
        selectedEvents,
      })

      const shouldSaveBillingPlan = hasBillingPlanInput(s)
        ? billingPlanSignatureFromSettings(s) !== billingPlanSignature(activeBillingPlan)
        : activeBillingPlan != null

      if (shouldSaveBillingPlan) {
        const savedPlan = await apiPut<SaveBillingPlanResponse, {
          pricingMode: PricingMode
          effectiveFrom: string
          fixedRates?: { t1: number | null; t2: number | null; t3: number | null; t4: number | null }
          dynamic?: { provider: 'ELERING'; zone: 'LT'; spotAdderEurPerKwh: number }
          monthlyFixedFeeEur: number | null
        }>(`/api/settings/${savedDeviceId}/billing-plan`, {
          pricingMode: s.pricing_mode,
          effectiveFrom: activeBillingPlan ? new Date().toISOString() : new Date().toISOString(),
          ...(s.pricing_mode === 'FIXED'
            ? {
                fixedRates: {
                  t1: s.rate_t1,
                  t2: s.rate_t2,
                  t3: s.rate_t3,
                  t4: s.rate_t4,
                },
              }
            : {
                dynamic: {
                  provider: 'ELERING',
                  zone: 'LT',
                  spotAdderEurPerKwh: s.spot_adder_eur_per_kwh ?? 0,
                },
              }),
          monthlyFixedFeeEur: s.monthly_fixed_fee_eur,
        })

        savedDevice = savedDevice
          ? { ...savedDevice, billingPlan: savedPlan.activePlan }
          : savedDevice

        applyBillingPlanToForm(savedPlan.activePlan)
      }

      if (savedDevice) {
        setDevices((prev) => {
          const exists = prev.some((device) => device.id === savedDevice!.id)
          return exists
            ? prev.map((device) => (device.id === savedDevice!.id ? savedDevice! : device))
            : [savedDevice!, ...prev]
        })
      }

      setMessage({
        type: 'success',
        text: deviceId ? t('settings.successUpdated') : t('settings.successSaved'),
      })
    } catch (err) {
      console.error('Failed to save settings:', err)
      setMessage({ type: 'error', text: t('settings.errorSave') })
    } finally {
      setLoading(false)
    }
  }

  const eventOptions: { value: NotificationEventType; label: string }[] = [
    { value: 'ANOMALY_DETECTED', label: t('settings.eventAnomalyDetected') },
    { value: 'DEVICE_UNREACHABLE', label: t('settings.eventDeviceUnreachable') },
    { value: 'DEVICE_RECOVERED', label: t('settings.eventDeviceRecovered') },
    { value: 'REPORT_GENERATED', label: t('settings.eventReportGenerated') },
  ]

  const pricingModeOptions: { value: PricingMode; label: string }[] = [
    {
      value: 'FIXED',
      label: language === 'lt' ? 'Fiksuotas planas' : 'Fixed plan',
    },
    {
      value: 'DYNAMIC',
      label: language === 'lt' ? 'Dinaminis planas' : 'Dynamic plan',
    },
  ]

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
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <div>
              <Text fw={400} mb={4} c="#EBEBEB">
                {language === 'lt' ? 'Elektros planas' : 'Electricity Plan'}
              </Text>
              <Text size="sm" c="#999999">
                {language === 'lt'
                  ? 'Naudojame šiuos tarifus sąnaudų įvertinimui ataskaitose.'
                  : 'These tariffs are used to estimate costs in reports.'}
              </Text>
            </div>
            {activeBillingPlan && (
              <Badge variant="light" color={s.pricing_mode === 'DYNAMIC' ? 'blue' : 'yellow'}>
                {language === 'lt'
                  ? `Aktyvuota nuo ${new Date(activeBillingPlan.effectiveFrom).toLocaleDateString('lt-LT')}`
                  : `Active since ${new Date(activeBillingPlan.effectiveFrom).toLocaleDateString('en-GB')}`}
              </Badge>
            )}
          </Group>

          <Select
            label={language === 'lt' ? 'Kainodaros tipas' : 'Pricing mode'}
            value={s.pricing_mode}
            onChange={(value) =>
              setS((prev) => ({
                ...prev,
                pricing_mode: (value as PricingMode) ?? 'FIXED',
              }))
            }
            data={pricingModeOptions}
            styles={inputStyles}
          />

          {s.pricing_mode === 'FIXED' ? (
            <>
              <Text size="sm" c="#999999">
                {language === 'lt'
                  ? 'Įveskite tiekėjo taikomus T1-T4 tarifus EUR/kWh. Galite užpildyti tik naudojamus tarifus.'
                  : 'Enter your supplier T1-T4 energy rates in EUR/kWh. You can fill only the tariffs you actually use.'}
              </Text>

              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <NumberInput
                  label="T1 (EUR/kWh)"
                  value={s.rate_t1 ?? undefined}
                  onChange={(value) => setS((prev) => ({ ...prev, rate_t1: toNullableNumber(value) }))}
                  decimalScale={4}
                  min={0}
                  styles={inputStyles}
                />
                <NumberInput
                  label="T2 (EUR/kWh)"
                  value={s.rate_t2 ?? undefined}
                  onChange={(value) => setS((prev) => ({ ...prev, rate_t2: toNullableNumber(value) }))}
                  decimalScale={4}
                  min={0}
                  styles={inputStyles}
                />
                <NumberInput
                  label="T3 (EUR/kWh)"
                  value={s.rate_t3 ?? undefined}
                  onChange={(value) => setS((prev) => ({ ...prev, rate_t3: toNullableNumber(value) }))}
                  decimalScale={4}
                  min={0}
                  styles={inputStyles}
                />
                <NumberInput
                  label="T4 (EUR/kWh)"
                  value={s.rate_t4 ?? undefined}
                  onChange={(value) => setS((prev) => ({ ...prev, rate_t4: toNullableNumber(value) }))}
                  decimalScale={4}
                  min={0}
                  styles={inputStyles}
                />
              </SimpleGrid>
            </>
          ) : (
            <>
              <Text size="sm" c="#999999">
                {language === 'lt'
                  ? 'Dinaminis planas remiasi Elering LT Nord Pool kainomis. Čia galite pridėti tiekėjo antkainį.'
                  : 'Dynamic pricing uses Elering LT Nord Pool spot prices. Add your supplier markup here.'}
              </Text>

              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label={language === 'lt' ? 'Duomenų šaltinis' : 'Price source'}
                  value="Elering / LT"
                  readOnly
                  styles={inputStyles}
                />
                <NumberInput
                  label={language === 'lt' ? 'Tiekėjo antkainis (EUR/kWh)' : 'Supplier markup (EUR/kWh)'}
                  value={s.spot_adder_eur_per_kwh ?? undefined}
                  onChange={(value) => setS((prev) => ({ ...prev, spot_adder_eur_per_kwh: toNullableNumber(value) ?? 0 }))}
                  decimalScale={4}
                  min={0}
                  styles={inputStyles}
                />
              </SimpleGrid>
            </>
          )}

          <NumberInput
            label={language === 'lt' ? 'Mėnesinis pastovus mokestis (EUR)' : 'Monthly fixed fee (EUR)'}
            value={s.monthly_fixed_fee_eur ?? undefined}
            onChange={(value) => setS((prev) => ({ ...prev, monthly_fixed_fee_eur: toNullableNumber(value) }))}
            decimalScale={2}
            min={0}
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
          {t('settings.interface')}
        </Text>

        <Stack gap="sm">
          <Select
            label={t('settings.language')}
            value={language}
            onChange={(value) => {
              if (value === 'en' || value === 'lt') {
                setLanguage(value)
              }
            }}
            data={[
              { value: 'en', label: t('settings.languageEnglish') },
              { value: 'lt', label: t('settings.languageLithuanian') },
            ]}
            styles={inputStyles}
          />

          <Text size="sm" c="#999999">
            {t('settings.languageDescription')}
          </Text>
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
          {t('settings.connection')}
        </Text>

        <Stack gap="sm">
          <Button
            radius="xl"
            onClick={handleCreateNewDevice}
            disabled={loading}
            styles={{
              root: {
                backgroundColor: '#FFCC59',
                color: '#000000',
                border: '1px solid #FFCC59',
                fontWeight: 400,
                height: '44px',
                transition: 'all 160ms ease',
                '&:hover': {
                  backgroundColor: '#ffd87a',
                  borderColor: '#ffd87a',
                },
              },
            }}
          >
            {t('settings.addDevice')}
          </Button>

          <Select
            label={t('settings.selectedDevice')}
            placeholder={devices.length ? t('settings.chooseDevice') : t('settings.noDevicesYet')}
            value={deviceId !== null ? String(deviceId) : null}
            onChange={(value) => {
              void handleSelectDevice(value)
            }}
            data={devices.map((device) => ({ value: String(device.id), label: `${device.name} (#${device.id})` }))}
            styles={inputStyles}
          />

          <Group grow>
            <Button
              radius="xl"
              onClick={handleToggleConnection}
              disabled={loading || !selectedDevice}
              styles={{
                root: {
                  backgroundColor: '#404040',
                  color: '#EBEBEB',
                  border: '1px solid #4A4A4A',
                  fontWeight: 400,
                  height: '44px',
                  transition: 'all 160ms ease',
                  '&:hover': {
                    backgroundColor: '#4a4a4a',
                    borderColor: '#5a5a5a',
                  },
                },
              }}
            >
              {selectedDevice?.isActive ? t('settings.disconnect') : t('settings.connect')}
            </Button>

            <Button
              radius="xl"
              onClick={() => {
                void handleRemoveDevice()
              }}
              disabled={loading || !selectedDevice}
              styles={{
                root: {
                  backgroundColor: '#4a2b2b',
                  color: '#db9a9a',
                  border: '1px solid #7c4747',
                  fontWeight: 400,
                  height: '44px',
                  transition: 'all 160ms ease',
                  '&:hover': {
                    backgroundColor: '#5a3434',
                    borderColor: '#935454',
                  },
                },
              }}
            >
              {t('settings.remove')}
            </Button>
          </Group>

          <Text size="sm" c="#999999">
            {t('settings.status')}: {selectedDevice
              ? (selectedDevice.isActive ? t('settings.statusConnected') : t('settings.statusDisconnected'))
              : t('settings.statusNewDevice')}
          </Text>

          <TextInput
            label={t('settings.deviceName')}
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder={t('settings.deviceNamePlaceholder')}
            styles={inputStyles}
          />

          <TextInput
            label={t('settings.deviceEndpoint')}
            placeholder={t('settings.deviceEndpointPlaceholder')}
            value={s.device_ip}
            onChange={(e) => setS({ ...s, device_ip: e.target.value })}
            styles={inputStyles}
          />

          <TextInput
            label={t('settings.mqttBroker')}
            value={s.mqtt_broker}
            onChange={(e) => setS({ ...s, mqtt_broker: e.target.value })}
            styles={inputStyles}
          />

          <NumberInput
            label={t('settings.mqttPort')}
            value={s.mqtt_port}
            onChange={(v) => setS({ ...s, mqtt_port: Number(v) })}
            styles={inputStyles}
          />

          <TextInput
            label={t('settings.mqttTopic')}
            value={s.mqtt_topic}
            onChange={(e) => setS({ ...s, mqtt_topic: e.target.value })}
            styles={inputStyles}
          />

          <NumberInput
            label={t('settings.pollInterval')}
            value={s.poll_interval}
            onChange={(v) => setS({ ...s, poll_interval: Number(v) })}
            min={1}
            styles={inputStyles}
          />

          <Select
            label="Installation Type / Main Breaker Profile"
            value={s.power_profile}
            onChange={(value) =>
              setS({
                ...s,
                power_profile: (value as PowerProfilePreset) ?? 'HOUSE_3P_11KW',
              })
            }
            data={POWER_PROFILE_OPTIONS}
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
          {t('settings.alerts')}
        </Text>

        <Stack gap="sm">
          <Switch
            label={t('settings.notifications')}
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
                label={t('settings.notificationChannel')}
                value={s.notification_channel as NotificationChannel}
                onChange={(value) =>
                  setS({
                    ...s,
                    notification_channel: (value as NotificationChannel) ?? 'none',
                  })
                }
                data={[
                  { value: 'email', label: t('settings.channelEmail') },
                  { value: 'sms', label: t('settings.channelSms') },
                  { value: 'push', label: t('settings.channelPush') },
                  { value: 'none', label: t('settings.channelNone') },
                ]}
                styles={inputStyles}
              />

              {s.notification_channel === 'email' && (
                <TextInput
                  label={t('settings.emailAddress')}
                  placeholder={t('settings.emailPlaceholder')}
                  value={s.notification_target}
                  onChange={(e) => setS({ ...s, notification_target: e.target.value })}
                  styles={inputStyles}
                />
              )}

              {s.notification_channel === 'sms' && (
                <TextInput
                  label={t('settings.phoneNumber')}
                  placeholder={t('settings.phonePlaceholder')}
                  value={s.notification_target}
                  onChange={(e) => setS({ ...s, notification_target: e.target.value })}
                  styles={inputStyles}
                />
              )}

              {s.notification_channel === 'push' && (
                <Text size="sm" c="dimmed">
                  {t('settings.pushInfo')}
                </Text>
              )}

              <MultiSelect
                label={t('settings.notificationEvents')}
                placeholder={t('settings.notificationEventsPlaceholder')}
                data={eventOptions}
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
        {t('settings.save')}
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
