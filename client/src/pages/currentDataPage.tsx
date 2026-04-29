import { useEffect, useState } from 'react'
import { Alert, Button, Card, Group, Loader, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import type { LiveData } from '../types/energy'
import { apiDownload, apiFetch } from '../services/apiClient'
import { useI18n } from '../i18n/i18n'

interface Device {
  id: number
  name: string
}

function KeyValueTable<T extends object>({ data }: { data: T }) {
  const rows = Object.entries(data).map(([key, value]) => (
    <Table.Tr key={key}>
      <Table.Td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
        <Text size="sm" fw={600}>{key}</Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" style={{ wordBreak: 'break-all' }}>
          {value instanceof Date ? value.toISOString() : String(value ?? '')}
        </Text>
      </Table.Td>
    </Table.Tr>
  ))

  return (
    <Table.ScrollContainer minWidth={700}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

export function CurrentDataPage() {
  const { t } = useI18n()
  const [data, setData] = useState<LiveData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [devices, setDevices] = useState<Device[]>([])
  const [devicesLoading, setDevicesLoading] = useState(true)

  const [exportDeviceId, setExportDeviceId] = useState<string | null>(null)
  const [exportFromDate, setExportFromDate] = useState<string>('')
  const [exportToDate, setExportToDate] = useState<string>('')
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const loadData = async () => {
      try {
        const result = await apiFetch<LiveData>('/api/live/raw')

        if (active) {
          setData(result)
          setError(null)
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : t('common.unknownError'))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadData()
    const interval = setInterval(loadData, 5000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [t])

  useEffect(() => {
    let active = true

    const loadDevices = async () => {
      try {
        const result = await apiFetch<Device[]>('/api/settings')

        if (!active) return

        setDevices(result)

        if (result.length > 0) {
          setExportDeviceId((prev) => prev ?? String(result[0].id))
        }
      } catch (err) {
        if (active) {
          setExportError(err instanceof Error ? err.message : t('current.errorLoadDevices'))
        }
      } finally {
        if (active) {
          setDevicesLoading(false)
        }
      }
    }

    loadDevices()

    return () => {
      active = false
    }
  }, [t])

  useEffect(() => {
    const today = new Date()
    const to = today.toISOString().slice(0, 10)

    const fromDate = new Date(today)
    fromDate.setDate(fromDate.getDate() - 7)
    const from = fromDate.toISOString().slice(0, 10)

    setExportFromDate((prev) => prev || from)
    setExportToDate((prev) => prev || to)
  }, [])

  const handleExport = async (format: 'csv' | 'xlsx') => {
    setExportError(null)

    if (!exportDeviceId) {
      setExportError(t('current.errorSelectDevice'))
      return
    }

    if (!exportFromDate || !exportToDate) {
      setExportError(t('current.errorSelectDates'))
      return
    }

    const start = new Date(`${exportFromDate}T00:00:00`)
    const end = new Date(`${exportToDate}T00:00:00`)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setExportError(t('current.errorValidDates'))
      return
    }

    if (end < start) {
      setExportError(t('current.errorEndBeforeStart'))
      return
    }

    const now = new Date()
    const today = now.toISOString().slice(0, 10)

    const endDateTime =
      exportToDate === today
        ? now.toISOString()
        : `${exportToDate}T23:59:59.999Z`

    setExporting(format)

    try {
      const from = `${exportFromDate}T00:00:00.000Z`
      const to = endDateTime

      const params = new URLSearchParams({
        deviceId: exportDeviceId,
        from,
        to,
        format,
      })

      await apiDownload(
        `/api/exports/readings?${params.toString()}`,
        `readings-device-${exportDeviceId}-${exportFromDate}-to-${exportToDate}.${format}`,
      )
    } catch (err) {
      console.error('Export failed:', err)
      setExportError(t('current.errorExportFile', { format: format.toUpperCase() }))
    } finally {
      setExporting(null)
    }
  }

  return (
    <Stack p="lg" gap="md">
      <Card p="md">
        <Text fw={700} mb="sm">{t('current.exportReadings')}</Text>

        <Group gap="sm" align="flex-end" wrap="wrap">
          <Select
            label={t('current.device')}
            placeholder={devicesLoading ? t('current.loadingDevices') : t('current.selectDevice')}
            data={devices.map((device) => ({
              value: String(device.id),
              label: device.name,
            }))}
            value={exportDeviceId}
            onChange={setExportDeviceId}
            disabled={devicesLoading}
            style={{ minWidth: 220 }}
          />

          <TextInput
            label={t('current.from')}
            type="date"
            value={exportFromDate}
            onChange={(e) => setExportFromDate(e.currentTarget.value)}
          />

          <TextInput
            label={t('current.to')}
            type="date"
            value={exportToDate}
            onChange={(e) => setExportToDate(e.currentTarget.value)}
          />

          <Button
            variant="light"
            onClick={() => handleExport('csv')}
            loading={exporting === 'csv'}
            disabled={!exportDeviceId || devicesLoading}
          >
            {t('current.exportCsv')}
          </Button>

          <Button
            variant="light"
            onClick={() => handleExport('xlsx')}
            loading={exporting === 'xlsx'}
            disabled={!exportDeviceId || devicesLoading}
          >
            {t('current.exportExcel')}
          </Button>
        </Group>

        {exportError && (
          <Alert color="red" title={t('current.exportFailed')} mt="md">
            {exportError}
          </Alert>
        )}
      </Card>

      <Card p="md">
        <Text fw={700} mb="sm">{t('current.rawFields')}</Text>

        {loading && <Loader size="sm" />}
        {error && <Alert color="red" title={t('current.failedLoadData')}>{error}</Alert>}
        {data && <KeyValueTable data={data} />}
      </Card>
    </Stack>
  )
}