import { useEffect, useState, useCallback } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { apiFetch, apiPost, apiPatch, apiDelete, apiDownload } from '../services/apiClient'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Device { id: number; name: string }

interface Renter {
  id: number
  name: string
  email: string | null
}

interface RenterAllocation {
  id: number
  deviceId: number
  renterId: number
  startsAt: string
  endsAt: string | null
  renter: { id: number; name: string; email: string | null }
}

interface BillingReportSummary {
  id: number
  deviceId: number
  renterId: number | null
  startsAt: string
  endsAt: string
  generatedAt: string
  totalKwh: number
  unallocatedKwh: number
}

interface KwhByTariff { t1: number; t2: number; t3: number; t4: number }

interface RenterEntry {
  renterId: number
  renterName: string
  renterEmail: string | null
  periodStartsAt: string
  periodEndsAt: string
  kwhUsed: number
  kwhByTariff: KwhByTariff
  amountEur: number
  energyChargeEur: number
  fixedFeesEur: number
  costStatus: string
}

interface BillingReportData {
  deviceId: number
  deviceName: string
  renterId: number | null
  renterName: string | null
  startsAt: string
  endsAt: string
  generatedAt: string
  totalKwh: number
  unallocatedKwh: number
  renters: RenterEntry[]
  unallocatedPeriods: Array<{ periodStartsAt: string; periodEndsAt: string; kwhUsed: number }>
}

interface FullReport extends BillingReportSummary { data: BillingReportData }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtDt(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ─── Shared input style ───────────────────────────────────────────────────────

const inputStyles = {
  input: { backgroundColor: '#404040', border: '1px solid #4A4A4A', color: '#EBEBEB' },
  label: { color: '#EBEBEB' },
}

// ─── Renter report modal ──────────────────────────────────────────────────────

interface RenterReportModalProps {
  renter: Renter
  devices: Device[]
  onClose: () => void
}

function RenterReportModal({ renter, devices, onClose }: RenterReportModalProps) {
  const [deviceId, setDeviceId] = useState<string | null>(devices.length === 1 ? String(devices[0]!.id) : null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [currentReport, setCurrentReport] = useState<FullReport | null>(null)
  const [historicalReports, setHistoricalReports] = useState<BillingReportSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    if (!deviceId) { setHistoricalReports([]); return }
    let active = true
    setHistoryLoading(true)
    apiFetch<BillingReportSummary[]>(`/api/billing-reports?deviceId=${deviceId}&renterId=${renter.id}`)
      .then((r) => { if (active) setHistoricalReports(r) })
      .catch(() => {})
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [deviceId, renter.id])

  async function handleGenerate() {
    setGenerateError(null)
    if (!deviceId) { setGenerateError('Select a device.'); return }
    if (!fromDate || !toDate) { setGenerateError('Select a period.'); return }
    const from = new Date(fromDate)
    const to = new Date(toDate + 'T23:59:59.999Z')
    if (to <= from) { setGenerateError('End date must be after start date.'); return }
    setGenerating(true)
    try {
      const report = await apiPost<FullReport, unknown>('/api/billing-reports', {
        deviceId: parseInt(deviceId, 10),
        renterId: renter.id,
        startsAt: from.toISOString(),
        endsAt: to.toISOString(),
      })
      setCurrentReport(report)
      setHistoricalReports((prev) => [report, ...prev])
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : 'Failed to generate report.')
    } finally { setGenerating(false) }
  }

  async function handleView(id: number) {
    try { setCurrentReport(await apiFetch<FullReport>(`/api/billing-reports/${id}`)) } catch { /* ignore */ }
  }

  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  async function handleExport(format: 'csv' | 'xlsx') {
    if (!currentReport) return
    setExportError(null)
    setExporting(format)
    try {
      await apiDownload(`/api/billing-reports/${currentReport.id}/export?format=${format}`)
    } catch {
      setExportError('Export failed.')
    } finally { setExporting(null) }
  }

  const deviceOptions = devices.map((d) => ({ value: String(d.id), label: d.name }))
  const entry = currentReport?.data.renters[0]

  return (
    <Modal
      opened
      onClose={onClose}
      title={<Text fw={600} c="white">Renter Report — {renter.name}</Text>}
      size="lg"
      styles={{ content: { backgroundColor: '#2C2C2C' }, header: { backgroundColor: '#2C2C2C' } }}
    >
      <Stack gap="sm">
        <Group align="flex-end" gap="sm">
          <Select label="Device" placeholder="Select device" data={deviceOptions} value={deviceId} onChange={setDeviceId} styles={inputStyles} style={{ flex: 1 }} />
          <TextInput label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.currentTarget.value)} styles={inputStyles} min="2000-01-01" style={{ flex: 1 }} />
          <TextInput label="To" type="date" value={toDate} onChange={(e) => setToDate(e.currentTarget.value)} styles={inputStyles} min="2000-01-01" style={{ flex: 1 }} />
          <Button onClick={handleGenerate} loading={generating} disabled={!deviceId || !fromDate || !toDate} style={{ backgroundColor: '#FFCC59', color: '#000' }}>
            Generate
          </Button>
        </Group>

        {generateError && <Alert color="red" variant="light" p="xs"><Text size="sm">{generateError}</Text></Alert>}

        {currentReport && entry && (
          <>
            <Divider my="xs" label="Report" labelPosition="left" />
            <Group justify="space-between" align="flex-start">
              <Group gap="xl" wrap="wrap">
                <Box><Text size="xs" c="dimmed">Period</Text><Text size="sm" c="white">{fmt(entry.periodStartsAt)} – {fmt(entry.periodEndsAt)}</Text></Box>
                <Box><Text size="xs" c="dimmed">kWh used</Text><Text size="sm" fw={600} c="white">{entry.kwhUsed.toFixed(3)}</Text></Box>
                <Box><Text size="xs" c="dimmed">Energy charge</Text><Text size="sm" c="white">€{entry.energyChargeEur.toFixed(4)}</Text></Box>
                <Box><Text size="xs" c="dimmed">Fixed fees</Text><Text size="sm" c="white">€{entry.fixedFeesEur.toFixed(4)}</Text></Box>
                <Box><Text size="xs" c="dimmed">Total</Text><Text size="sm" fw={700} c="white">€{entry.amountEur.toFixed(4)}</Text></Box>
                <Box><Text size="xs" c="dimmed">Cost data</Text><CostStatusBadge status={entry.costStatus} /></Box>
              </Group>
              <Group gap="xs">
                <Button size="xs" variant="light" loading={exporting === 'csv'} onClick={() => handleExport('csv')}>Export CSV</Button>
                <Button size="xs" variant="light" color="teal" loading={exporting === 'xlsx'} onClick={() => handleExport('xlsx')}>Export Excel</Button>
              </Group>
            </Group>
            {exportError && <Alert color="red" variant="light" p="xs"><Text size="sm">{exportError}</Text></Alert>}
            {currentReport.data.totalKwh === 0 && (
              <Alert color="gray" variant="light" p="xs">
                <Text size="sm" c="dimmed">No meter readings found for this period, or renter has no allocation here.</Text>
              </Alert>
            )}
          </>
        )}

        {currentReport && !entry && (
          <Alert color="gray" variant="light" p="xs">
            <Text size="sm" c="dimmed">No allocation found for {renter.name} in this period. Assign this renter to the device for the selected dates first.</Text>
          </Alert>
        )}

        {deviceId && (
          <>
            <Divider my="xs" label="Historical renter reports" labelPosition="left" />
            {historyLoading && <Group gap="xs"><Loader size="xs" /><Text size="sm" c="dimmed">Loading…</Text></Group>}
            {!historyLoading && historicalReports.length === 0 && <Text size="sm" c="dimmed">No reports yet.</Text>}
            {!historyLoading && historicalReports.length > 0 && (
              <Table.ScrollContainer minWidth={400}>
                <Table striped highlightOnHover withTableBorder style={{ fontSize: '13px' }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Period</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>kWh</Table.Th>
                      <Table.Th>Generated</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {historicalReports.map((r) => (
                      <Table.Tr key={r.id} style={currentReport?.id === r.id ? { backgroundColor: 'rgba(255,204,89,0.08)' } : undefined}>
                        <Table.Td><Text size="sm">{fmt(r.startsAt)} – {fmt(r.endsAt)}</Text></Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}><Text size="sm">{r.totalKwh.toFixed(3)}</Text></Table.Td>
                        <Table.Td><Text size="xs" c="dimmed">{fmtDt(r.generatedAt)}</Text></Table.Td>
                        <Table.Td><Button size="xs" variant="subtle" onClick={() => handleView(r.id)}>View</Button></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </>
        )}
      </Stack>
    </Modal>
  )
}

// ─── Renter section ───────────────────────────────────────────────────────────

interface RenterSectionProps {
  renters: Renter[]
  loading: boolean
  onRefresh: () => void
  devices: Device[]
}

function RenterSection({ renters, loading, onRefresh, devices }: RenterSectionProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')

  const [reportRenter, setReportRenter] = useState<Renter | null>(null)

  async function handleAdd() {
    if (!name.trim()) { setError('Name is required.'); return }
    setError(null)
    setSaving(true)
    try {
      await apiPost('/api/settings/renters', { name: name.trim(), email: email.trim() || null })
      setName(''); setEmail('')
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create renter.')
    } finally { setSaving(false) }
  }

  async function handleEdit(id: number) {
    if (!editName.trim()) return
    setSaving(true)
    try {
      await apiPatch(`/api/settings/renters/${id}`, { name: editName.trim(), email: editEmail.trim() || null })
      setEditId(null)
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update renter.')
    } finally { setSaving(false) }
  }

  async function handleDelete(id: number, renterName: string) {
    if (!window.confirm(`Remove renter "${renterName}"?`)) return
    try {
      await apiDelete(`/api/settings/renters/${id}`)
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot delete renter — remove their allocations first.')
    }
  }

  function startEdit(r: Renter) {
    setEditId(r.id)
    setEditName(r.name)
    setEditEmail(r.email ?? '')
  }

  return (
    <>
    {reportRenter && <RenterReportModal renter={reportRenter} devices={devices} onClose={() => setReportRenter(null)} />}
    <Card style={{ backgroundColor: '#2C2C2C', border: '1px solid #3A3A3A' }} padding="md" radius="md">
      <Title order={5} c="white" mb="sm">Renters</Title>

      {loading && <Group gap="xs" mb="sm"><Loader size="xs" /><Text size="sm" c="dimmed">Loading…</Text></Group>}
      {error && <Alert color="red" variant="light" p="xs" mb="sm" onClose={() => setError(null)} withCloseButton><Text size="sm">{error}</Text></Alert>}

      {renters.length > 0 && (
        <Table.ScrollContainer minWidth={400} mb="md">
          <Table striped highlightOnHover withTableBorder style={{ fontSize: '13px' }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th style={{ width: 90 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {renters.map((r) =>
                editId === r.id ? (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <TextInput size="xs" value={editName} onChange={(e) => setEditName(e.currentTarget.value)} styles={inputStyles} />
                    </Table.Td>
                    <Table.Td>
                      <TextInput size="xs" value={editEmail} onChange={(e) => setEditEmail(e.currentTarget.value)} styles={inputStyles} />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <Button size="xs" loading={saving} onClick={() => handleEdit(r.id)}>Save</Button>
                        <Button size="xs" variant="subtle" onClick={() => setEditId(null)}>Cancel</Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  <Table.Tr key={r.id}>
                    <Table.Td><Text size="sm" fw={500}>{r.name}</Text></Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">{r.email ?? '—'}</Text></Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <Tooltip label="Generate report"><Button size="xs" variant="light" color="yellow" onClick={() => setReportRenter(r)}>Report</Button></Tooltip>
                        <Tooltip label="Edit"><ActionIcon size="sm" variant="subtle" onClick={() => startEdit(r)}>✏️</ActionIcon></Tooltip>
                        <Tooltip label="Delete"><ActionIcon size="sm" variant="subtle" color="red" onClick={() => handleDelete(r.id, r.name)}>🗑</ActionIcon></Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                )
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {!loading && renters.length === 0 && <Text size="sm" c="dimmed" mb="sm">No renters yet.</Text>}

      <Divider my="sm" label="Add renter" labelPosition="left" />
      <Group align="flex-end" gap="sm">
        <TextInput label="Name" placeholder="e.g. John Doe" value={name} onChange={(e) => setName(e.currentTarget.value)} styles={inputStyles} style={{ flex: 1 }} />
        <TextInput label="Email (optional)" placeholder="john@example.com" value={email} onChange={(e) => setEmail(e.currentTarget.value)} styles={inputStyles} style={{ flex: 1 }} />
        <Button loading={saving} onClick={handleAdd} style={{ backgroundColor: '#FFCC59', color: '#000' }}>Add</Button>
      </Group>
    </Card>
    </>
  )
}

// ─── Allocations section ──────────────────────────────────────────────────────

interface AllocationSectionProps {
  devices: Device[]
  renters: Renter[]
}

function AllocationSection({ devices, renters }: AllocationSectionProps) {
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [allocations, setAllocations] = useState<RenterAllocation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [newRenterId, setNewRenterId] = useState<string | null>(null)
  const [newStartsAt, setNewStartsAt] = useState('')
  const [newEndsAt, setNewEndsAt] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [editId, setEditId] = useState<number | null>(null)
  const [editStartsAt, setEditStartsAt] = useState('')
  const [editEndsAt, setEditEndsAt] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const loadAllocations = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch<RenterAllocation[]>(`/api/settings/${id}/renter-allocations`)
      setAllocations(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load allocations.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (deviceId) loadAllocations(deviceId)
    else setAllocations([])
  }, [deviceId, loadAllocations])

  async function handleAdd() {
    if (!deviceId || !newRenterId || !newStartsAt) {
      setAddError('Device, renter, and start date are required.')
      return
    }
    setAddError(null)
    setAdding(true)
    try {
      await apiPost(`/api/settings/${deviceId}/renter-allocations`, {
        renterId: parseInt(newRenterId, 10),
        startsAt: new Date(newStartsAt).toISOString(),
        endsAt: newEndsAt ? new Date(newEndsAt + 'T23:59:59.999Z').toISOString() : null,
      })
      setNewRenterId(null); setNewStartsAt(''); setNewEndsAt('')
      loadAllocations(deviceId)
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to create allocation.')
    } finally { setAdding(false) }
  }

  async function handleDelete(allocId: number) {
    if (!deviceId || !window.confirm('Remove this allocation?')) return
    try {
      await apiDelete(`/api/settings/${deviceId}/renter-allocations/${allocId}`)
      loadAllocations(deviceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete allocation.')
    }
  }

  function startEdit(a: RenterAllocation) {
    setEditId(a.id)
    setEditStartsAt(a.startsAt.slice(0, 10))
    setEditEndsAt(a.endsAt ? a.endsAt.slice(0, 10) : '')
  }

  async function handleEditSave(allocId: number) {
    if (!deviceId || !editStartsAt) return
    setEditSaving(true)
    try {
      await apiPatch(`/api/settings/${deviceId}/renter-allocations/${allocId}`, {
        startsAt: new Date(editStartsAt).toISOString(),
        endsAt: editEndsAt ? new Date(editEndsAt + 'T23:59:59.999Z').toISOString() : null,
      })
      setEditId(null)
      loadAllocations(deviceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update allocation.')
    } finally { setEditSaving(false) }
  }

  const deviceOptions = devices.map((d) => ({ value: String(d.id), label: d.name }))
  const renterOptions = renters.map((r) => ({ value: String(r.id), label: r.name + (r.email ? ` (${r.email})` : '') }))

  return (
    <Card style={{ backgroundColor: '#2C2C2C', border: '1px solid #3A3A3A' }} padding="md" radius="md">
      <Title order={5} c="white" mb="sm">Device Allocations</Title>
      <Text size="xs" c="dimmed" mb="sm">Assign renters to a device for specific date ranges. Only one renter can be active per device at a time.</Text>

      <Select
        label="Device"
        placeholder="Select device"
        data={deviceOptions}
        value={deviceId}
        onChange={setDeviceId}
        styles={inputStyles}
        mb="md"
      />

      {loading && <Group gap="xs"><Loader size="xs" /><Text size="sm" c="dimmed">Loading…</Text></Group>}
      {error && <Alert color="red" variant="light" p="xs" mb="sm"><Text size="sm">{error}</Text></Alert>}

      {deviceId && !loading && (
        <>
          {allocations.length === 0 && <Text size="sm" c="dimmed" mb="md">No allocations for this device yet.</Text>}

          {allocations.length > 0 && (
            <Table.ScrollContainer minWidth={500} mb="md">
              <Table striped highlightOnHover withTableBorder style={{ fontSize: '13px' }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Renter</Table.Th>
                    <Table.Th>Starts</Table.Th>
                    <Table.Th>Ends</Table.Th>
                    <Table.Th style={{ width: 100 }} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {allocations.map((a) =>
                    editId === a.id ? (
                      <Table.Tr key={a.id}>
                        <Table.Td><Text size="sm">{a.renter.name}</Text></Table.Td>
                        <Table.Td>
                          <TextInput size="xs" type="date" value={editStartsAt} onChange={(e) => setEditStartsAt(e.currentTarget.value)} styles={inputStyles} min="2000-01-01" />
                        </Table.Td>
                        <Table.Td>
                          <TextInput size="xs" type="date" value={editEndsAt} onChange={(e) => setEditEndsAt(e.currentTarget.value)} styles={inputStyles} min="2000-01-01" />
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4}>
                            <Button size="xs" loading={editSaving} onClick={() => handleEditSave(a.id)}>Save</Button>
                            <Button size="xs" variant="subtle" onClick={() => setEditId(null)}>Cancel</Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      <Table.Tr key={a.id}>
                        <Table.Td>
                          <Text size="sm" fw={500}>{a.renter.name}</Text>
                          {a.renter.email && <Text size="xs" c="dimmed">{a.renter.email}</Text>}
                        </Table.Td>
                        <Table.Td><Text size="sm">{fmt(a.startsAt)}</Text></Table.Td>
                        <Table.Td>
                          {a.endsAt
                            ? <Text size="sm">{fmt(a.endsAt)}</Text>
                            : <Badge size="xs" color="green" variant="light">Ongoing</Badge>}
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4}>
                            <Tooltip label="Edit"><ActionIcon size="sm" variant="subtle" onClick={() => startEdit(a)}>✏️</ActionIcon></Tooltip>
                            <Tooltip label="Delete"><ActionIcon size="sm" variant="subtle" color="red" onClick={() => handleDelete(a.id)}>🗑</ActionIcon></Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    )
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}

          <Divider my="sm" label="Add allocation" labelPosition="left" />
          {addError && <Alert color="red" variant="light" p="xs" mb="sm"><Text size="sm">{addError}</Text></Alert>}
          <Group align="flex-end" gap="sm" wrap="wrap">
            <Select
              label="Renter"
              placeholder={renters.length === 0 ? 'Add a renter first' : 'Select renter'}
              data={renterOptions}
              value={newRenterId}
              onChange={setNewRenterId}
              styles={inputStyles}
              disabled={renters.length === 0}
              style={{ flex: 1, minWidth: 180 }}
            />
            <TextInput
              label="Start date"
              type="date"
              value={newStartsAt}
              onChange={(e) => setNewStartsAt(e.currentTarget.value)}
              styles={inputStyles}
              min="2000-01-01"
              style={{ flex: 1, minWidth: 140 }}
            />
            <TextInput
              label="End date (optional)"
              type="date"
              value={newEndsAt}
              onChange={(e) => setNewEndsAt(e.currentTarget.value)}
              styles={inputStyles}
              min="2000-01-01"
              style={{ flex: 1, minWidth: 140 }}
            />
            <Button
              loading={adding}
              onClick={handleAdd}
              disabled={renters.length === 0}
              style={{ backgroundColor: '#FFCC59', color: '#000' }}
            >
              Assign
            </Button>
          </Group>
        </>
      )}
    </Card>
  )
}

// ─── Billing report section ───────────────────────────────────────────────────

function CostStatusBadge({ status }: { status: string }) {
  const color = status === 'complete' ? 'green' : status === 'partial' ? 'yellow' : 'gray'
  return <Badge color={color} size="sm" variant="light">{status}</Badge>
}

interface ReportSectionProps { devices: Device[] }

function ReportSection({ devices }: ReportSectionProps) {
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [currentReport, setCurrentReport] = useState<FullReport | null>(null)

  const [historicalReports, setHistoricalReports] = useState<BillingReportSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    if (!deviceId) { setHistoricalReports([]); setCurrentReport(null); return }
    let active = true
    setHistoryLoading(true)
    apiFetch<BillingReportSummary[]>(`/api/billing-reports?deviceId=${deviceId}`)
      .then((r) => { if (active) setHistoricalReports(r) })
      .catch(() => {})
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [deviceId])

  async function handleGenerate() {
    setGenerateError(null)
    if (!deviceId) { setGenerateError('Select a device.'); return }
    if (!fromDate || !toDate) { setGenerateError('Select a period.'); return }
    const from = new Date(fromDate)
    const to = new Date(toDate + 'T23:59:59.999Z')
    if (to <= from) { setGenerateError('End date must be after start date.'); return }

    setGenerating(true)
    try {
      const report = await apiPost<FullReport, unknown>('/api/billing-reports', {
        deviceId: parseInt(deviceId, 10),
        startsAt: from.toISOString(),
        endsAt: to.toISOString(),
      })
      setCurrentReport(report)
      setHistoricalReports((prev) => [report, ...prev])
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : 'Failed to generate report.')
    } finally { setGenerating(false) }
  }

  async function handleViewHistorical(id: number) {
    try {
      setCurrentReport(await apiFetch<FullReport>(`/api/billing-reports/${id}`))
    } catch { /* leave current unchanged */ }
  }

  async function handleExport(format: 'csv' | 'xlsx') {
    if (!currentReport) return
    setExportError(null)
    setExporting(format)
    try {
      await apiDownload(`/api/billing-reports/${currentReport.id}/export?format=${format}`)
    } catch {
      setExportError('Export failed.')
    } finally { setExporting(null) }
  }

  const deviceOptions = devices.map((d) => ({ value: String(d.id), label: d.name }))

  return (
    <Card style={{ backgroundColor: '#2C2C2C', border: '1px solid #3A3A3A' }} padding="md" radius="md">
      <Title order={5} c="white" mb="sm">Billing Reports</Title>

      <Stack gap="sm">
        <Select label="Device" placeholder="Select device" data={deviceOptions} value={deviceId} onChange={setDeviceId} styles={inputStyles} />
        <Group grow>
          <TextInput label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.currentTarget.value)} styles={inputStyles} min="2000-01-01" />
          <TextInput label="To" type="date" value={toDate} onChange={(e) => setToDate(e.currentTarget.value)} styles={inputStyles} min="2000-01-01" />
        </Group>
        {generateError && <Alert color="red" variant="light" p="xs"><Text size="sm">{generateError}</Text></Alert>}
        <Button
          onClick={handleGenerate}
          loading={generating}
          disabled={!deviceId || !fromDate || !toDate}
          style={{ backgroundColor: '#FFCC59', color: '#000', alignSelf: 'flex-start' }}
        >
          {generating ? 'Generating…' : 'Generate report'}
        </Button>
      </Stack>

      {currentReport && (
        <>
          <Divider my="md" />
          {exportError && <Alert color="red" variant="light" p="xs" mb="sm"><Text size="sm">{exportError}</Text></Alert>}

          <Group justify="space-between" align="flex-end" mb="sm">
            <Box>
              <Text fw={600} c="white">{currentReport.data.deviceName}</Text>
              <Text size="sm" c="dimmed">{fmt(currentReport.data.startsAt)} – {fmt(currentReport.data.endsAt)}</Text>
              <Text size="xs" c="dimmed">Generated: {fmtDt(currentReport.data.generatedAt)}</Text>
            </Box>
            <Group gap="xs">
              <Button size="xs" variant="light" loading={exporting === 'csv'} onClick={() => handleExport('csv')}>Export CSV</Button>
              <Button size="xs" variant="light" color="teal" loading={exporting === 'xlsx'} onClick={() => handleExport('xlsx')}>Export Excel</Button>
            </Group>
          </Group>

          <Group gap="xl" mb="md">
            <Box><Text size="xs" c="dimmed">Total kWh</Text><Text fw={600} c="white">{currentReport.data.totalKwh.toFixed(3)}</Text></Box>
            <Box>
              <Text size="xs" c="dimmed">Unallocated kWh</Text>
              <Text fw={600} c={currentReport.data.unallocatedKwh > 0 ? 'yellow' : 'white'}>{currentReport.data.unallocatedKwh.toFixed(3)}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">Total amount</Text>
              <Text fw={700} c="white">€{currentReport.data.renters.reduce((a, r) => a + r.amountEur, 0).toFixed(2)}</Text>
            </Box>
          </Group>

          {currentReport.data.totalKwh === 0 && (
            <Alert color="gray" variant="light" p="xs" mb="sm">
              <Text size="sm" c="dimmed">No meter readings found for this period — make sure the device has data and the billing period overlaps with recorded readings.</Text>
            </Alert>
          )}

          {currentReport.data.renters.length === 0 && currentReport.data.unallocatedPeriods.length === 0
            ? <Text size="sm" c="dimmed">No renter allocations for this period. Assign renters to the device first.</Text>
            : (
              <Table.ScrollContainer minWidth={700}>
                <Table striped highlightOnHover withTableBorder style={{ fontSize: '13px' }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Renter</Table.Th>
                      <Table.Th>Period</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>kWh</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Energy charge</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Fixed fees</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Amount</Table.Th>
                      <Table.Th>Cost data</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {currentReport.data.renters.map((r) => (
                      <Table.Tr key={r.renterId}>
                        <Table.Td>
                          <Text size="sm" fw={500}>{r.renterName}</Text>
                          {r.renterEmail && <Text size="xs" c="dimmed">{r.renterEmail}</Text>}
                        </Table.Td>
                        <Table.Td><Text size="xs" c="dimmed">{fmt(r.periodStartsAt)} – {fmt(r.periodEndsAt)}</Text></Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}><Text size="sm">{r.kwhUsed.toFixed(3)}</Text></Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}><Text size="sm">€{r.energyChargeEur.toFixed(4)}</Text></Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}><Text size="sm">€{r.fixedFeesEur.toFixed(4)}</Text></Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}><Text size="sm" fw={600}>€{r.amountEur.toFixed(4)}</Text></Table.Td>
                        <Table.Td><CostStatusBadge status={r.costStatus} /></Table.Td>
                      </Table.Tr>
                    ))}
                    {currentReport.data.unallocatedPeriods.map((u, i) => (
                      <Table.Tr key={`u-${i}`} style={{ opacity: 0.6 }}>
                        <Table.Td><Text size="sm" c="dimmed" fs="italic">Unallocated</Text></Table.Td>
                        <Table.Td><Text size="xs" c="dimmed">{fmt(u.periodStartsAt)} – {fmt(u.periodEndsAt)}</Text></Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}><Text size="sm" c="dimmed">{u.kwhUsed.toFixed(3)}</Text></Table.Td>
                        <Table.Td colSpan={4} />
                      </Table.Tr>
                    ))}
                    <Table.Tr style={{ borderTop: '2px solid #555' }}>
                      <Table.Td><Text size="sm" fw={700}>Total</Text></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{fmt(currentReport.data.startsAt)} – {fmt(currentReport.data.endsAt)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="sm" fw={600}>{currentReport.data.totalKwh.toFixed(3)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="sm" fw={600}>€{currentReport.data.renters.reduce((a, r) => a + r.energyChargeEur, 0).toFixed(4)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="sm" fw={600}>€{currentReport.data.renters.reduce((a, r) => a + r.fixedFeesEur, 0).toFixed(4)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="sm" fw={700}>€{currentReport.data.renters.reduce((a, r) => a + r.amountEur, 0).toFixed(4)}</Text></Table.Td>
                      <Table.Td />
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )
          }
        </>
      )}

      {deviceId && (
        <>
          <Divider my="md" label="Historical reports" labelPosition="left" />
          {historyLoading && <Group gap="xs"><Loader size="xs" /><Text size="sm" c="dimmed">Loading…</Text></Group>}
          {!historyLoading && historicalReports.length === 0 && <Text size="sm" c="dimmed">No reports yet.</Text>}
          {!historyLoading && historicalReports.length > 0 && (
            <Table.ScrollContainer minWidth={450}>
              <Table striped highlightOnHover withTableBorder style={{ fontSize: '13px' }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Period</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Total kWh</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Unalloc. kWh</Table.Th>
                    <Table.Th>Generated</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {historicalReports.map((r) => (
                    <Table.Tr key={r.id} style={currentReport?.id === r.id ? { backgroundColor: 'rgba(255,204,89,0.08)' } : undefined}>
                      <Table.Td><Text size="sm">{fmt(r.startsAt)} – {fmt(r.endsAt)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="sm">{r.totalKwh.toFixed(3)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="sm" c={r.unallocatedKwh > 0 ? 'yellow' : undefined}>{r.unallocatedKwh.toFixed(3)}</Text></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{fmtDt(r.generatedAt)}</Text></Table.Td>
                      <Table.Td><Button size="xs" variant="subtle" onClick={() => handleViewHistorical(r.id)}>View</Button></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </>
      )}
    </Card>
  )
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export function BillingDashboard() {
  const [devices, setDevices] = useState<Device[]>([])
  const [devicesLoading, setDevicesLoading] = useState(true)
  const [renters, setRenters] = useState<Renter[]>([])
  const [rentersLoading, setRentersLoading] = useState(true)

  const loadRenters = useCallback(async () => {
    try {
      setRenters(await apiFetch<Renter[]>('/api/settings/renters'))
    } catch { /* ignore */ } finally { setRentersLoading(false) }
  }, [])

  useEffect(() => {
    let active = true
    apiFetch<Device[]>('/api/settings')
      .then((r) => { if (active) setDevices(r) })
      .catch(() => {})
      .finally(() => { if (active) setDevicesLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => { loadRenters() }, [loadRenters])

  return (
    <Stack gap="lg" maw={960} w="100%">
      <Title order={3} c="white">Multi-Tenant Billing</Title>

      {devicesLoading || rentersLoading
        ? <Group gap="xs"><Loader size="sm" /><Text size="sm" c="dimmed">Loading…</Text></Group>
        : devices.length === 0
          ? <Alert color="yellow" variant="light"><Text size="sm">No devices found. Add a device in Settings first.</Text></Alert>
          : (
            <>
              <RenterSection renters={renters} loading={rentersLoading} onRefresh={loadRenters} devices={devices} />
              <AllocationSection devices={devices} renters={renters} />
              <ReportSection devices={devices} />
            </>
          )
      }
    </Stack>
  )
}
