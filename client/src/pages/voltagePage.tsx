import { useEffect, useRef, useState, memo } from 'react';
import {
  Badge, Card, Group, Progress, RingProgress,
  SimpleGrid, Stack, Table, Text, Title,
} from '@mantine/core';
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { usePolling } from '../hooks/usePolling';
import { apiFetch } from '../services/apiClient';

const MAX_POINTS = 60;

/* ── API response types ─────────────────────────────────────────── */

interface PhaseResult {
  phase: string;
  voltage: number;
  nominal: number;
  min: number;
  max: number;
  deviation: number;
  inBounds: boolean;
  isZero: boolean;
}

interface VoltageLatest {
  deviceId: number;
  timestamp: string;
  phases: PhaseResult[];
  bounds: { nominal: number; tolerance: number; min: number; max: number };
}

interface VoltageSummary {
  has_data: boolean;
  latest_timestamp: string | null;
  stats: {
    totalReadings: number;
    totalWindows: number;
    totalAnomalies: number;
    activeAnomalies: number;
  };
  weekly_compliance: {
    pct_l1: number;
    pct_l2: number;
    pct_l3: number;
    overall_compliant: boolean;
  };
  bounds: { nominal: number; min: number; max: number };
}

interface Anomaly {
  id: number;
  deviceId: number;
  type: string;
  phase: string;
  severity: number;
  minVoltage: number | null;
  maxVoltage: number | null;
  duration: number | null;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
}

interface AnomalyResponse {
  count: number;
  data: Anomaly[];
}

interface ComplianceWeekly {
  weekStart: string;
  weekEnd: string;
  totalWindows: number;
  compliancePctL1: number;
  compliancePctL2: number;
  compliancePctL3: number;
  overallCompliant: boolean;
  eso_threshold_pct: number;
  window_duration_minutes: number;
}

interface VoltageHistoryPoint {
  timestamp: string;
  voltage_l1: number;
  voltage_l2: number;
  voltage_l3: number;
}

interface VoltageHistoryResponse {
  interval: string;
  count: number;
  data: VoltageHistoryPoint[];
}

interface VoltagePoint {
  time: string;
  L1: number;
  L2: number;
  L3: number;
}

const EMPTY_HISTORY: VoltagePoint[] = Array.from({ length: MAX_POINTS }, () => ({
  time: '',
  L1: 0,
  L2: 0,
  L3: 0,
}));

/* ── Stat card matching Figma layout (big value + unit + label) ── */

const BigStat = memo(function BigStat({
  value,
  unit,
  label,
}: {
  value: string;
  unit: string;
  label: string;
}) {
  return (
    <Card p="lg" radius="md">
      <Text size="xs" c="dimmed" ta="center" mb={4}>
        {label}
      </Text>
      <Group justify="center" gap={4} wrap="nowrap">
        <Text fw={700} fz={40} lh={1}>
          {value}
        </Text>
        <Text fz="md" c="dimmed">
          {unit}
        </Text>
      </Group>
    </Card>
  );
});

/* ── Phase voltage card (coloured by in-bounds) ──────────────── */

const PhaseCard = memo(function PhaseCard({ p }: { p: PhaseResult }) {
  const color = p.isZero ? 'danger' : p.inBounds ? 'secondary' : 'primary';
  const statusLabel = p.isZero
    ? 'NO SUPPLY'
    : p.inBounds
      ? 'In bounds'
      : 'Out of bounds';

  return (
    <Card p="md" radius="md">
      <Group justify="space-between" mb="xs">
        <Text fw={700} fz="lg">{p.phase}</Text>
        <Badge color={color} variant="light" size="lg">{statusLabel}</Badge>
      </Group>
      <Text fz={36} fw={700} ta="center" my="xs">
        {p.voltage.toFixed(1)} <Text span fz="md" c="dimmed">V</Text>
      </Text>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">Deviation</Text>
        <Text size="sm" fw={600} c={p.inBounds ? undefined : 'primary'}>
          {p.deviation >= 0 ? '+' : ''}{p.deviation.toFixed(1)} V
        </Text>
      </Group>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">Bounds</Text>
        <Text size="sm">{p.min}–{p.max} V</Text>
      </Group>
    </Card>
  );
});

/* ── Main page ───────────────────────────────────────────────── */

export function VoltagePage() {
  /* ─ Data fetching ─ */

  const { data: latest } = usePolling<VoltageLatest>(
    ['voltage', 'latest'],
    '/api/voltage/latest',
    { intervalSeconds: 5 },
  );

  const { data: summary } = usePolling<VoltageSummary>(
    ['voltage', 'summary'],
    '/api/voltage/summary',
    { intervalSeconds: 10 },
  );

  const { data: compliance } = usePolling<ComplianceWeekly>(
    ['voltage', 'compliance'],
    '/api/voltage/compliance/weekly',
    { intervalSeconds: 30 },
  );

  const { data: activeAnomalies } = usePolling<AnomalyResponse>(
    ['voltage', 'anomalies', 'active'],
    '/api/voltage/anomalies/active',
    { intervalSeconds: 5 },
  );

  const { data: recentAnomalies } = usePolling<AnomalyResponse>(
    ['voltage', 'anomalies', 'recent'],
    '/api/voltage/anomalies?limit=10',
    { intervalSeconds: 10 },
  );

  /* ─ Realtime chart history ─ */

  const [voltageHistory, setVoltageHistory] = useState<VoltagePoint[]>(
    () => [...EMPTY_HISTORY],
  );
  const prevTs = useRef<string | null>(null);
  const historyLoaded = useRef(false);

  // Seed the chart with the last MAX_POINTS readings from the DB (no downsampling)
  useEffect(() => {
    if (historyLoaded.current) return;
    historyLoaded.current = true;

    apiFetch<VoltageHistoryResponse>(
      `/api/voltage/history?interval=latest&points=${MAX_POINTS}`,
    )
      .then(res => {
        if (!res.data.length) return;

        const points: VoltagePoint[] = res.data.map(d => ({
          time: new Date(d.timestamp).toLocaleTimeString(),
          L1: d.voltage_l1,
          L2: d.voltage_l2,
          L3: d.voltage_l3,
        }));

        // Take only the last MAX_POINTS from whatever the server returned
        const tail = points.slice(-MAX_POINTS);

        // Pad the front with empty points if we got fewer than MAX_POINTS
        const padded = [
          ...EMPTY_HISTORY.slice(0, MAX_POINTS - tail.length),
          ...tail,
        ];

        setVoltageHistory(padded);
        // Set prevTs so polling doesn't duplicate the last point
        if (res.data.length > 0) {
          prevTs.current = res.data[res.data.length - 1].timestamp;
        }
      })
      .catch(() => { /* history unavailable, start from empty */ });
  }, []);

  useEffect(() => {
    if (!latest) return;
    if (prevTs.current === latest.timestamp) return;
    prevTs.current = latest.timestamp;

    const phaseMap = Object.fromEntries(latest.phases.map(ph => [ph.phase, ph.voltage]));

    const point: VoltagePoint = {
      time: new Date(latest.timestamp).toLocaleTimeString(),
      L1: phaseMap['L1'] ?? 0,
      L2: phaseMap['L2'] ?? 0,
      L3: phaseMap['L3'] ?? 0,
    };

    setVoltageHistory(prev => [...prev.slice(1), point]);
  }, [latest]);

  /* ─ Derived values ─ */

  const avgCompliance = compliance
    ? +((compliance.compliancePctL1 + compliance.compliancePctL2 + compliance.compliancePctL3) / 3).toFixed(1)
    : 0;

  return (
    <Stack p="lg" gap="md" style={{ width: '100%' }}>
      {/* ── Section title ────────────────────────────────────── */}
      <Title order={2}>Voltage analytics</Title>

      {/* ── Top stats row ────────────────────────────────────── */}
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <BigStat
          label="Total readings"
          value={summary ? summary.stats.totalReadings.toLocaleString() : '—'}
          unit=""
        />
        <BigStat
          label="Active anomalies"
          value={activeAnomalies ? String(activeAnomalies.count) : '—'}
          unit=""
        />
        <BigStat
          label="Weekly compliance"
          value={compliance ? `${avgCompliance}` : '—'}
          unit="%"
        />
        <BigStat
          label="Total anomalies"
          value={summary ? String(summary.stats.totalAnomalies) : '—'}
          unit=""
        />
      </SimpleGrid>

      {/* ── Per-phase live cards ─────────────────────────────── */}
      {latest && (
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {latest.phases.map(p => (
            <PhaseCard key={p.phase} p={p} />
          ))}
        </SimpleGrid>
      )}

      {/* ── Live voltage chart ───────────────────────────────── */}
      <Card p="md" radius="md">
        <Group justify="space-between" mb="sm">
          <Text fw={700}>Live voltage</Text>
          {latest && (
            <Text size="sm" c="dimmed">
              {new Date(latest.timestamp).toLocaleTimeString()}
            </Text>
          )}
        </Group>

        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={voltageHistory}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
            <YAxis domain={[210, 250]} unit=" V" tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {latest && (
              <>
                <ReferenceLine y={latest.bounds.max} stroke="#DB3C3C" strokeDasharray="6 3" label={{ value: `${latest.bounds.max}V`, position: 'right', fontSize: 10, fill: '#DB3C3C' }} />
                <ReferenceLine y={latest.bounds.min} stroke="#DB3C3C" strokeDasharray="6 3" label={{ value: `${latest.bounds.min}V`, position: 'right', fontSize: 10, fill: '#DB3C3C' }} />
                <ReferenceLine y={latest.bounds.nominal} stroke="#656565" strokeDasharray="3 3" />
              </>
            )}
            <Line dataKey="L1" stroke="#FFCC59" dot={false} strokeWidth={2} name="L1" isAnimationActive={false} />
            <Line dataKey="L2" stroke="#8ACDEA" dot={false} strokeWidth={2} name="L2" isAnimationActive={false} />
            <Line dataKey="L3" stroke="#DB3C3C" dot={false} strokeWidth={2} name="L3" isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* ── ESO Weekly Compliance + Active anomalies row ──── */}
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {/* Compliance card */}
        <Card p="md" radius="md">
          <Group justify="space-between" mb="md">
            <Text fw={700}>ESO weekly compliance</Text>
            {compliance && (
              <Badge
                color={compliance.overallCompliant ? 'secondary' : 'danger'}
                variant="light"
                size="lg"
              >
                {compliance.overallCompliant ? 'PASS' : 'FAIL'}
              </Badge>
            )}
          </Group>

          {compliance ? (
            <Stack gap="md">
              <Group justify="center">
                <RingProgress
                  size={120}
                  thickness={12}
                  roundCaps
                  sections={[{ value: avgCompliance, color: avgCompliance >= 95 ? '#8ACDEA' : '#DB3C3C' }]}
                  label={
                    <Text ta="center" fw={700} fz="lg">
                      {avgCompliance}%
                    </Text>
                  }
                />
              </Group>

              <Stack gap="xs">
                {(['L1', 'L2', 'L3'] as const).map(phase => {
                  const pct = phase === 'L1'
                    ? compliance.compliancePctL1
                    : phase === 'L2'
                      ? compliance.compliancePctL2
                      : compliance.compliancePctL3;
                  return (
                    <div key={phase}>
                      <Group justify="space-between" mb={4}>
                        <Text size="sm">{phase}</Text>
                        <Text size="sm" fw={600}>{pct}%</Text>
                      </Group>
                      <Progress
                        value={pct}
                        color={pct >= 95 ? '#8ACDEA' : '#DB3C3C'}
                        size="sm"
                        radius="xl"
                      />
                    </div>
                  );
                })}
              </Stack>

              <Text size="xs" c="dimmed" ta="center">
                Threshold: {compliance.eso_threshold_pct}% of {compliance.window_duration_minutes}-min windows
              </Text>
            </Stack>
          ) : (
            <Text c="dimmed" ta="center">Loading…</Text>
          )}
        </Card>

        {/* Active anomalies card */}
        <Card p="md" radius="md">
          <Group justify="space-between" mb="md">
            <Text fw={700}>Active anomalies</Text>
            <Badge
              color={activeAnomalies && activeAnomalies.count > 0 ? 'danger' : 'secondary'}
              variant="light"
              size="lg"
            >
              {activeAnomalies ? activeAnomalies.count : '—'}
            </Badge>
          </Group>

          {activeAnomalies && activeAnomalies.count > 0 ? (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Phase</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Voltage</Table.Th>
                  <Table.Th>Started</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {activeAnomalies.data.map(a => (
                  <Table.Tr key={a.id}>
                    <Table.Td><Badge color="danger" variant="light" size="sm">{a.phase}</Badge></Table.Td>
                    <Table.Td>{a.type}</Table.Td>
                    <Table.Td>{a.minVoltage != null ? `${a.minVoltage.toFixed(1)} V` : '—'}</Table.Td>
                    <Table.Td>{new Date(a.startsAt).toLocaleTimeString()}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Stack align="center" justify="center" style={{ flex: 1, minHeight: 120 }}>
              <Text c="dimmed" fz="lg">No active anomalies</Text>
              <Text c="dimmed" size="xs">All phases within ESO bounds</Text>
            </Stack>
          )}
        </Card>
      </SimpleGrid>

      {/* ── Recent anomaly history ───────────────────────────── */}
      <Card p="md" radius="md">
        <Text fw={700} mb="md">Recent anomaly history</Text>

        {recentAnomalies && recentAnomalies.count > 0 ? (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Phase</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Min V</Table.Th>
                <Table.Th>Max V</Table.Th>
                <Table.Th>Started</Table.Th>
                <Table.Th>Duration</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {recentAnomalies.data.map(a => (
                <Table.Tr key={a.id}>
                  <Table.Td>{a.phase}</Table.Td>
                  <Table.Td>{a.type}</Table.Td>
                  <Table.Td>{a.minVoltage != null ? `${a.minVoltage.toFixed(1)} V` : '—'}</Table.Td>
                  <Table.Td>{a.maxVoltage != null ? `${a.maxVoltage.toFixed(1)} V` : '—'}</Table.Td>
                  <Table.Td>{new Date(a.startsAt).toLocaleString()}</Table.Td>
                  <Table.Td>
                    {a.duration != null
                      ? `${a.duration}s`
                      : 'ongoing'}
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={a.endsAt ? 'secondary' : 'danger'}
                      variant="light"
                      size="sm"
                    >
                      {a.endsAt ? 'Resolved' : 'Active'}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text c="dimmed" ta="center">No anomalies recorded yet</Text>
        )}
      </Card>
    </Stack>
  );
}