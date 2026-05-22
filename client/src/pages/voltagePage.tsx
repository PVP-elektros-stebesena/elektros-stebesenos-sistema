import { useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  Alert,
  Badge,
  Card,
  Group,
  Progress,
  RingProgress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePolling } from '../hooks/usePolling';
import { apiFetch } from '../services/apiClient';
import { useI18n } from '../i18n/i18n';
import { resolveDeviceSelection, useDeviceOptions } from '../hooks/useDeviceOptions';

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
  bounds: { nominal: number; tolerance: number; tolerancePct?: number; min: number; max: number };
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

/* ── Stat card ──────────────────────────────────────────────────── */

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

/* ── Phase voltage card ─────────────────────────────────────────── */

const PhaseCard = memo(function PhaseCard({
  p,
  noSupplyLabel,
  inBoundsLabel,
  outOfBoundsLabel,
  deviationLabel,
  boundsLabel,
}: {
  p: PhaseResult;
  noSupplyLabel: string;
  inBoundsLabel: string;
  outOfBoundsLabel: string;
  deviationLabel: string;
  boundsLabel: string;
}) {
  const color = p.isZero ? 'danger' : p.inBounds ? 'secondary' : 'primary';
  const statusLabel = p.isZero
    ? noSupplyLabel
    : p.inBounds
      ? inBoundsLabel
      : outOfBoundsLabel;

  return (
    <Card p="md" radius="md">
      <Group justify="space-between" mb="xs">
        <Text fw={700} fz="lg">
          {p.phase}
        </Text>
        <Badge color={color} variant="light" size="lg">
          {statusLabel}
        </Badge>
      </Group>

      <Text fz={36} fw={700} ta="center" my="xs">
        {p.voltage.toFixed(1)}{' '}
        <Text span fz="md" c="dimmed">
          V
        </Text>
      </Text>

      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          {deviationLabel}
        </Text>
        <Text size="sm" fw={600} c={p.inBounds ? undefined : 'primary'}>
          {p.deviation >= 0 ? '+' : ''}
          {p.deviation.toFixed(1)} V
        </Text>
      </Group>

      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          {boundsLabel}
        </Text>
        <Text size="sm">
          {p.min}–{p.max} V
        </Text>
      </Group>
    </Card>
  );
});

/* ── Main page ──────────────────────────────────────────────────── */

export function VoltagePage() {
  const { t } = useI18n();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const {
    devices,
    isLoading: devicesLoading,
    error: devicesError,
  } = useDeviceOptions();
  const activeSelectedDeviceId = resolveDeviceSelection(selectedDeviceId, devices);

  const [voltageHistory, setVoltageHistory] = useState<VoltagePoint[]>(() => [...EMPTY_HISTORY]);
  const prevTs = useRef<string | null>(null);
  const historyLoadedFor = useRef<string | null>(null);

  const deviceQuery = useMemo(
    () => (activeSelectedDeviceId ? `?deviceId=${activeSelectedDeviceId}` : ''),
    [activeSelectedDeviceId],
  );

  const historyQuery = useMemo(
    () =>
      activeSelectedDeviceId
        ? `/api/voltage/history?interval=latest&points=${MAX_POINTS}&deviceId=${activeSelectedDeviceId}`
        : '',
    [activeSelectedDeviceId],
  );

  const anomaliesQuery = useMemo(
    () => (activeSelectedDeviceId ? `/api/voltage/anomalies?limit=10&deviceId=${activeSelectedDeviceId}` : ''),
    [activeSelectedDeviceId],
  );

  const { data: latest } = usePolling<VoltageLatest>(
    ['voltage', 'latest', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? `/api/voltage/latest${deviceQuery}` : '',
    { intervalSeconds: 5 },
  );

  const { data: summary } = usePolling<VoltageSummary>(
    ['voltage', 'summary', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? `/api/voltage/summary${deviceQuery}` : '',
    { intervalSeconds: 10 },
  );

  const { data: compliance } = usePolling<ComplianceWeekly>(
    ['voltage', 'compliance', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? `/api/voltage/compliance/weekly${deviceQuery}` : '',
    { intervalSeconds: 30 },
  );

  const { data: activeAnomalies } = usePolling<AnomalyResponse>(
    ['voltage', 'anomalies', 'active', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? `/api/voltage/anomalies/active${deviceQuery}` : '',
    { intervalSeconds: 5 },
  );

  const { data: recentAnomalies } = usePolling<AnomalyResponse>(
    ['voltage', 'anomalies', 'recent', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? anomaliesQuery : '',
    { intervalSeconds: 10 },
  );

  useEffect(() => {
    if (!activeSelectedDeviceId) return;

    historyLoadedFor.current = null;
    prevTs.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVoltageHistory([...EMPTY_HISTORY]);
  }, [activeSelectedDeviceId]);

  useEffect(() => {
    if (!activeSelectedDeviceId || !historyQuery) return;
    if (historyLoadedFor.current === activeSelectedDeviceId) return;

    historyLoadedFor.current = activeSelectedDeviceId;

    apiFetch<VoltageHistoryResponse>(historyQuery)
      .then((res) => {
        if (!res.data.length) return;

        const points: VoltagePoint[] = res.data.map((d) => ({
          time: new Date(d.timestamp).toLocaleTimeString(),
          L1: d.voltage_l1,
          L2: d.voltage_l2,
          L3: d.voltage_l3,
        }));

        const tail = points.slice(-MAX_POINTS);
        const padded = [
          ...EMPTY_HISTORY.slice(0, MAX_POINTS - tail.length),
          ...tail,
        ];

        setVoltageHistory(padded);

        if (res.data.length > 0) {
          prevTs.current = res.data[res.data.length - 1].timestamp;
        }
      })
      .catch(() => {
        setVoltageHistory([...EMPTY_HISTORY]);
      });
  }, [activeSelectedDeviceId, historyQuery]);

  useEffect(() => {
    if (!latest) return;
    if (prevTs.current === latest.timestamp) return;

    prevTs.current = latest.timestamp;

    const phaseMap = Object.fromEntries(latest.phases.map((ph) => [ph.phase, ph.voltage]));

    const point: VoltagePoint = {
      time: new Date(latest.timestamp).toLocaleTimeString(),
      L1: phaseMap.L1 ?? 0,
      L2: phaseMap.L2 ?? 0,
      L3: phaseMap.L3 ?? 0,
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVoltageHistory((prev) => [...prev.slice(1), point]);
  }, [latest]);

  const avgCompliance = compliance
    ? +(
        (compliance.compliancePctL1 +
          compliance.compliancePctL2 +
          compliance.compliancePctL3) /
        3
      ).toFixed(1)
    : 0;

  return (
    <Stack p="lg" gap="md" style={{ width: '100%' }}>
      <Title order={2}>{t('voltage.title')}</Title>

      <Card p="md" radius="md">
        <Stack gap="sm">
          <div>
            <Text fw={700} mb={4}>
              {t('voltage.deviceSelection')}
            </Text>
            <Text size="sm" c="dimmed">
              {t('voltage.chooseDeviceDescription')}
            </Text>
          </div>

          <Select
            placeholder={devicesLoading ? t('current.loadingDevices') : t('voltage.selectDevice')}
            data={devices.map((d) => ({
              value: String(d.id),
              label: d.name,
            }))}
            value={activeSelectedDeviceId}
            onChange={setSelectedDeviceId}
            style={{ maxWidth: 320 }}
            disabled={devicesLoading || devices.length === 0}
          />
        </Stack>

        {devicesError && (
          <Alert mt="md" color="red" title={t('voltage.failedLoadDevicesTitle')}>
            {t('voltage.failedLoadDevices')}
          </Alert>
        )}

        {!devicesError && !devicesLoading && devices.length === 0 && (
          <Alert mt="md" color="yellow" title={t('voltage.noDevicesTitle')}>
            {t('voltage.noDevicesDescription')}
          </Alert>
        )}
      </Card>

      {activeSelectedDeviceId && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <BigStat
              label={t('voltage.totalReadings')}
              value={summary ? summary.stats.totalReadings.toLocaleString() : '—'}
              unit=""
            />
            <BigStat
              label={t('voltage.activeAnomalies')}
              value={activeAnomalies ? String(activeAnomalies.count) : '—'}
              unit=""
            />
            <BigStat
              label={t('voltage.weeklyCompliance')}
              value={compliance ? `${avgCompliance}` : '—'}
              unit="%"
            />
            <BigStat
              label={t('voltage.totalAnomalies')}
              value={summary ? String(summary.stats.totalAnomalies) : '—'}
              unit=""
            />
          </SimpleGrid>

          {latest && (
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              {latest.phases.map((p) => (
                <PhaseCard
                  key={p.phase}
                  p={p}
                  noSupplyLabel={t('voltage.phaseNoSupply')}
                  inBoundsLabel={t('voltage.phaseInBounds')}
                  outOfBoundsLabel={t('voltage.phaseOutOfBounds')}
                  deviationLabel={t('voltage.deviation')}
                  boundsLabel={t('voltage.bounds')}
                />
              ))}
            </SimpleGrid>
          )}

          <Card p="md" radius="md">
            <Group justify="space-between" mb="sm">
              <Text fw={700}>{t('voltage.liveVoltage')}</Text>
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
                <YAxis domain={[200, 260]} unit=" V" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />

                {latest && (
                  <>
                    <ReferenceLine
                      y={latest.bounds.max}
                      stroke="#DB3C3C"
                      strokeDasharray="6 3"
                      label={{
                        value: `${latest.bounds.max}V`,
                        position: 'right',
                        fontSize: 10,
                        fill: '#DB3C3C',
                      }}
                    />
                    <ReferenceLine
                      y={latest.bounds.min}
                      stroke="#DB3C3C"
                      strokeDasharray="6 3"
                      label={{
                        value: `${latest.bounds.min}V`,
                        position: 'right',
                        fontSize: 10,
                        fill: '#DB3C3C',
                      }}
                    />
                    <ReferenceLine
                      y={latest.bounds.nominal}
                      stroke="#656565"
                      strokeDasharray="3 3"
                    />
                  </>
                )}

                <Line
                  dataKey="L1"
                  stroke="#FFCC59"
                  dot={false}
                  strokeWidth={2}
                  name="L1"
                  isAnimationActive={false}
                />
                <Line
                  dataKey="L2"
                  stroke="#8ACDEA"
                  dot={false}
                  strokeWidth={2}
                  name="L2"
                  isAnimationActive={false}
                />
                <Line
                  dataKey="L3"
                  stroke="#DB3C3C"
                  dot={false}
                  strokeWidth={2}
                  name="L3"
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Card p="md" radius="md">
              <Group justify="space-between" mb="md">
                <Text fw={700}>{t('voltage.complianceTitle')}</Text>
                {compliance && (
                  <Badge
                    color={compliance.overallCompliant ? 'secondary' : 'danger'}
                    variant="light"
                    size="lg"
                  >
                    {compliance.overallCompliant ? t('voltage.pass') : t('voltage.fail')}
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
                      sections={[
                        {
                          value: avgCompliance,
                          color: avgCompliance >= 95 ? '#8ACDEA' : '#DB3C3C',
                        },
                      ]}
                      label={
                        <Text ta="center" fw={700} fz="lg">
                          {avgCompliance}%
                        </Text>
                      }
                    />
                  </Group>

                  <Stack gap="xs">
                    {(['L1', 'L2', 'L3'] as const).map((phase) => {
                      const pct =
                        phase === 'L1'
                          ? compliance.compliancePctL1
                          : phase === 'L2'
                            ? compliance.compliancePctL2
                            : compliance.compliancePctL3;

                      return (
                        <div key={phase}>
                          <Group justify="space-between" mb={4}>
                            <Text size="sm">{phase}</Text>
                            <Text size="sm" fw={600}>
                              {pct}%
                            </Text>
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
                    {t('voltage.threshold', {
                      threshold: compliance.eso_threshold_pct,
                      minutes: compliance.window_duration_minutes,
                    })}
                  </Text>
                </Stack>
              ) : (
                <Text c="dimmed" ta="center">
                  {t('voltage.loading')}
                </Text>
              )}
            </Card>

            <Card p="md" radius="md">
              <Group justify="space-between" mb="md">
                <Text fw={700}>{t('voltage.activeAnomalies')}</Text>
                <Badge
                  color={activeAnomalies && activeAnomalies.count > 0 ? 'danger' : 'secondary'}
                  variant="light"
                  size="lg"
                >
                  {activeAnomalies ? activeAnomalies.count : '—'}
                </Badge>
              </Group>

              {activeAnomalies && activeAnomalies.count > 0 ? (
                <Table.ScrollContainer minWidth={400}>
                  <Table striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t('voltage.phase')}</Table.Th>
                        <Table.Th>{t('voltage.type')}</Table.Th>
                        <Table.Th>{t('voltage.voltage')}</Table.Th>
                        <Table.Th>{t('voltage.started')}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {activeAnomalies.data.map((a) => (
                        <Table.Tr key={a.id}>
                          <Table.Td>
                            <Badge color="danger" variant="light" size="sm">
                              {a.phase}
                            </Badge>
                          </Table.Td>
                          <Table.Td>{a.type}</Table.Td>
                          <Table.Td>
                            {a.minVoltage != null ? `${a.minVoltage.toFixed(1)} V` : '—'}
                          </Table.Td>
                          <Table.Td>{new Date(a.startsAt).toLocaleTimeString()}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              ) : (
                <Stack align="center" justify="center" style={{ flex: 1, minHeight: 120 }}>
                  <Text c="dimmed" fz="lg">
                    {t('voltage.noActiveAnomalies')}
                  </Text>
                  <Text c="dimmed" size="xs">
                    {t('voltage.allPhasesWithinBounds')}
                  </Text>
                </Stack>
              )}
            </Card>
          </SimpleGrid>

          <Card p="md" radius="md">
            <Text fw={700} mb="md">
              {t('voltage.recentHistory')}
            </Text>

            {recentAnomalies && recentAnomalies.count > 0 ? (
              <Table.ScrollContainer minWidth={600}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t('voltage.phase')}</Table.Th>
                      <Table.Th>{t('voltage.type')}</Table.Th>
                      <Table.Th>{t('voltage.minV')}</Table.Th>
                      <Table.Th>{t('voltage.maxV')}</Table.Th>
                      <Table.Th>{t('voltage.started')}</Table.Th>
                      <Table.Th>{t('voltage.duration')}</Table.Th>
                      <Table.Th>{t('voltage.status')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {recentAnomalies.data.map((a) => (
                      <Table.Tr key={a.id}>
                        <Table.Td>{a.phase}</Table.Td>
                        <Table.Td>{a.type}</Table.Td>
                        <Table.Td>
                          {a.minVoltage != null ? `${a.minVoltage.toFixed(1)} V` : '—'}
                        </Table.Td>
                        <Table.Td>
                          {a.maxVoltage != null ? `${a.maxVoltage.toFixed(1)} V` : '—'}
                        </Table.Td>
                        <Table.Td>{new Date(a.startsAt).toLocaleString()}</Table.Td>
                        <Table.Td>{a.duration != null ? `${a.duration}s` : t('voltage.ongoing')}</Table.Td>
                        <Table.Td>
                          <Badge
                            color={a.endsAt ? 'secondary' : 'danger'}
                            variant="light"
                            size="sm"
                          >
                            {a.endsAt ? t('voltage.resolved') : t('voltage.active')}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            ) : (
              <Text c="dimmed" ta="center">
                {t('voltage.noAnomaliesYet')}
              </Text>
            )}
          </Card>
        </>
      )}
    </Stack>
  );
}
