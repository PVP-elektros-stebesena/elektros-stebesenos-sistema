import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Card,
  Group,
  Loader,
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
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePolling } from '../hooks/usePolling';
import { apiFetch } from '../services/apiClient';
import { useI18n } from '../i18n/i18n';

interface DeviceOption {
  id: number;
  name: string;
}

interface PowerLatest {
  deviceId: number;
  timestamp: string;
  activePowerTotalKw: number | null;
  reactivePowerTotalKvar: number | null;
  apparentPowerTotalKva: number | null;
  powerFactor: number | null;
  phaseImbalancePct: number | null;
  activePowerL1Kw: number | null;
  activePowerL2Kw: number | null;
  activePowerL3Kw: number | null;
  reactivePowerL1Kvar: number | null;
  reactivePowerL2Kvar: number | null;
  reactivePowerL3Kvar: number | null;
  policy: {
    label: string;
    profile: string;
    source: 'profile_preset' | 'device_override';
    targetPowerFactor: number;
    minPowerFactor: number;
    maxPhaseImbalancePct: number;
  };
  breaches: { metric: string; message: string }[];
}

interface PowerSummary {
  has_data: boolean;
  latest_timestamp: string | null;
  stats: {
    totalReadings: number;
    totalPowerWindows: number;
    policyBreachedWindows: number;
    totalPowerAnomalies: number;
    activePowerAnomalies: number;
  };
}

interface PowerHistoryPoint {
  timestamp: string;
  activePowerTotalKw: number | null;
  reactivePowerTotalKvar: number | null;
  apparentPowerTotalKva: number | null;
  powerFactor: number | null;
}

interface PowerHistoryResponse {
  count: number;
  data: PowerHistoryPoint[];
}

interface PowerAnomaly {
  id: number;
  deviceId: number;
  metricName: string | null;
  type: string;
  phase: string;
  severity: number;
  thresholdValue: number | null;
  observedMax: number | null;
  observedAvg: number | null;
  unit: string | null;
  startsAt: string;
  endsAt: string | null;
}

interface PowerAnomalyResponse {
  count: number;
  data: PowerAnomaly[];
}

interface ReportListResponse {
  count: number;
  data: {
    id: number;
  }[];
}

interface ReportDetail {
  reportUse: 'home' | 'technical' | 'solar';
  healthScore: string;
  powerHealthScore: string;
  combinedHealthScore: string;
  insights: {
    totalEnergyConsumedKwh: number;
    totalEnergyReturnedKwh: number;
    averageEfficiencyPct: number | null;
    averageHourlyElectricityKwh: number | null;
    anomalyTypeDistribution: { type: string; count: number }[];
    totalPowerAnomalies: number;
    powerAnomalyTypeDistribution: { type: string; count: number }[];
    narrative: string;
  };
}

interface PowerTrendPoint {
  time: string;
  active: number | null;
  reactive: number | null;
  apparent: number | null;
  pf: number | null;
}

function anomalyColor(index: number): string {
  const colors = ['#DB3C3C', '#FFCC59', '#8ACDEA', '#A78BFA', '#4ADE80', '#F472B6'];
  return colors[index % colors.length] ?? '#8ACDEA';
}

function severityBadgeColor(severity: number): string {
  if (severity >= 3) return 'danger';
  if (severity >= 2) return 'primary';
  return 'secondary';
}

function tr(language: 'en' | 'lt', en: string, lt: string): string {
  return language === 'lt' ? lt : en;
}

function anomalyTypeLabel(type: string, language: 'en' | 'lt'): string {
  const labels: Record<string, string> = {
    LONG_INTERRUPTION: tr(language, 'Long interruption', 'Ilgas nutrūkimas'),
    SHORT_INTERRUPTION: tr(language, 'Short interruption', 'Trumpas nutrūkimas'),
    OVER_VOLTAGE: tr(language, 'Over-voltage', 'Viršįtampis'),
    UNDER_VOLTAGE: tr(language, 'Under-voltage', 'Žema įtampa'),
    VOLTAGE_DEVIATION: tr(language, 'Voltage deviation', 'Įtampos nuokrypis'),
  };
  return labels[type] ?? type;
}

function reportUseLabel(reportUse: 'home' | 'technical' | 'solar', language: 'en' | 'lt'): string {
  if (reportUse === 'home') return tr(language, 'Home', 'Namų');
  if (reportUse === 'technical') return tr(language, 'Technical', 'Techninė');
  return tr(language, 'Solar', 'Saulės');
}

function healthBadgeColor(score: string): string {
  if (score === 'GREEN') return 'green';
  if (score === 'YELLOW') return 'yellow';
  if (score === 'RED') return 'red';
  return 'gray';
}

function BigStat({ value, label }: { value: string; label: string }) {
  return (
    <Card p="lg" radius="md">
      <Text size="xs" c="dimmed" ta="center" mb={4}>
        {label}
      </Text>
      <Group justify="center" gap={4} wrap="nowrap">
        <Text fw={700} fz={40} lh={1}>
          {value}
        </Text>
      </Group>
    </Card>
  );
}

function formatFixed(value: number | null | undefined, decimals: number): string {
  return value == null ? '—' : value.toFixed(decimals);
}

function formatPfBand(latest: PowerLatest | undefined): string {
  if (!latest) return '—';

  const targetPowerFactor = latest.policy?.targetPowerFactor;
  const minPowerFactor = latest.policy?.minPowerFactor;

  if (targetPowerFactor == null || minPowerFactor == null) {
    return '—';
  }

  if (Math.abs(targetPowerFactor - minPowerFactor) < 0.0001) {
    return `>= ${targetPowerFactor.toFixed(2)}`;
  }

  return `Target ${targetPowerFactor.toFixed(2)} / Min ${minPowerFactor.toFixed(2)}`;
}

export function PowerPage() {
  const { t, language } = useI18n();
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    apiFetch<DeviceOption[]>('/api/settings')
      .then((res) => {
        if (!active) return;
        setDevices(res);
        if (res.length > 0) {
          setSelectedDeviceId((prev) => prev ?? String(res[0].id));
        }
      })
      .catch(() => {
        if (active) setDevicesError(t('power.failedLoadDevices'));
      })
      .finally(() => {
        if (active) setDevicesLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const deviceQuery = useMemo(
    () => (selectedDeviceId ? `?deviceId=${selectedDeviceId}` : ''),
    [selectedDeviceId],
  );

  const { data: latest, isLoading: latestLoading, error: latestError } = usePolling<PowerLatest>(
    ['power', 'latest', selectedDeviceId ?? 'none'],
    selectedDeviceId ? `/api/power/latest${deviceQuery}` : '',
    { intervalSeconds: 5, enabled: selectedDeviceId != null },
  );

  const { data: summary, isLoading: summaryLoading, error: summaryError } = usePolling<PowerSummary>(
    ['power', 'summary', selectedDeviceId ?? 'none'],
    selectedDeviceId ? `/api/power/summary${deviceQuery}` : '',
    { intervalSeconds: 10, enabled: selectedDeviceId != null },
  );

  const { data: history, isLoading: historyLoading, error: historyError } = usePolling<PowerHistoryResponse>(
    ['power', 'history', selectedDeviceId ?? 'none'],
    selectedDeviceId ? `/api/power/history?interval=raw&points=60&deviceId=${selectedDeviceId}` : '',
    { intervalSeconds: 10, enabled: selectedDeviceId != null },
  );

  const { data: anomalies, isLoading: anomaliesLoading, error: anomaliesError } = usePolling<PowerAnomalyResponse>(
    ['power', 'anomalies', selectedDeviceId ?? 'none'],
    selectedDeviceId ? `/api/power/anomalies?limit=10&deviceId=${selectedDeviceId}` : '',
    { intervalSeconds: 10, enabled: selectedDeviceId != null },
  );

  const { data: reportsList, isLoading: reportsLoading, error: reportsError } = usePolling<ReportListResponse>(
    ['reports', 'latest', selectedDeviceId ?? 'none'],
    selectedDeviceId ? `/api/reports?limit=1&deviceId=${selectedDeviceId}&reportUse=technical` : '',
    { intervalSeconds: 30, enabled: selectedDeviceId != null },
  );

  const latestReportId = reportsList?.data[0]?.id ?? null;

  const { data: reportDetail, isLoading: reportDetailLoading, error: reportDetailError } = usePolling<ReportDetail>(
    ['reports', 'detail', String(latestReportId ?? 'none')],
    latestReportId != null ? `/api/reports/${latestReportId}` : '',
    { intervalSeconds: 300, enabled: latestReportId != null },
  );

  const trendData: PowerTrendPoint[] = useMemo(() => {
    return (history?.data ?? []).map((point) => ({
      time: new Date(point.timestamp).toLocaleTimeString(),
      active: point.activePowerTotalKw,
      reactive: point.reactivePowerTotalKvar,
      apparent: point.apparentPowerTotalKva,
      pf: point.powerFactor,
    }));
  }, [history]);

  const anomalyDistribution = useMemo(() => {
    if (reportDetail?.insights.powerAnomalyTypeDistribution?.length) {
      return reportDetail.insights.powerAnomalyTypeDistribution;
    }

    const byType = new Map<string, number>();
    for (const anomaly of anomalies?.data ?? []) {
      byType.set(anomaly.type, (byType.get(anomaly.type) ?? 0) + 1);
    }

    return [...byType.entries()].map(([type, count]) => ({ type, count }));
  }, [reportDetail, anomalies]);

  const localizedAnomalyDistribution = useMemo(
    () => anomalyDistribution.map((item) => ({ ...item, label: anomalyTypeLabel(item.type, language) })),
    [anomalyDistribution, language],
  );

  const localizedNarrative = reportDetail?.insights
    ? (() => {
      const parts: string[] = [
        tr(
          language,
          `During the selected period, total imported electricity was ${reportDetail.insights.totalEnergyConsumedKwh.toFixed(2)} kWh.`,
          `Per pasirinktą laikotarpį bendra importuota elektros energija buvo ${reportDetail.insights.totalEnergyConsumedKwh.toFixed(2)} kWh.`,
        ),
      ];

      if (reportDetail.insights.averageEfficiencyPct != null) {
        parts.push(
          tr(
            language,
            `The average self-consumption efficiency ratio (imported / (imported + returned)) was ${reportDetail.insights.averageEfficiencyPct.toFixed(1)}%.`,
            `Vidutinis savosios vartosenos efektyvumo santykis (importuota / (importuota + grąžinta)) buvo ${reportDetail.insights.averageEfficiencyPct.toFixed(1)}%.`,
          ),
        );
      } else {
        parts.push(
          tr(
            language,
            'The efficiency ratio could not be computed due to insufficient returned-energy signal in the selected range.',
            'Efektyvumo santykio apskaičiuoti nepavyko dėl nepakankamo grąžintos energijos signalo pasirinktame intervale.',
          ),
        );
      }

      const topAnomaly = reportDetail.insights.anomalyTypeDistribution.length > 0
        ? reportDetail.insights.anomalyTypeDistribution.reduce((acc, cur) => (cur.count > acc.count ? cur : acc))
        : null;

      if (topAnomaly) {
        parts.push(
          tr(
            language,
            `The most frequently observed anomaly category was ${anomalyTypeLabel(topAnomaly.type, language)} (${topAnomaly.count} occurrences).`,
            `Dažniausiai stebėta anomalijų kategorija buvo ${anomalyTypeLabel(topAnomaly.type, language)} (${topAnomaly.count} atvejai).`,
          ),
        );
      } else {
        parts.push(
          tr(
            language,
            'No transmission anomalies were detected within the selected reporting interval.',
            'Pasirinktame ataskaitos intervale perdavimo anomalijų neaptikta.',
          ),
        );
      }

      return parts.join(' ');
    })()
    : null;

  return (
    <Stack p="lg" gap="md" style={{ width: '100%' }}>
      <Title order={2}>{t('power.title')}</Title>

      <Card p="md" radius="md">
        <Stack gap="sm">
          <div>
            <Text fw={700} mb={4}>{t('power.deviceSelection')}</Text>
            <Text size="sm" c="dimmed">{t('power.chooseDeviceDescription')}</Text>
          </div>

          <Select
            placeholder={devicesLoading ? t('power.loadingDevices') : t('power.selectDevice')}
            data={devices.map((device) => ({
              value: String(device.id),
              label: device.name,
            }))}
            value={selectedDeviceId}
            onChange={setSelectedDeviceId}
            style={{ maxWidth: 320 }}
            disabled={devicesLoading || devices.length === 0}
          />
        </Stack>

        {devicesError && (
          <Alert mt="md" color="red" title={t('power.failedLoadDevicesTitle')}>
            {devicesError}
          </Alert>
        )}

        {!devicesError && !devicesLoading && devices.length === 0 && (
          <Alert mt="md" color="yellow" title={t('power.noDevicesTitle')}>
            {t('power.noDevicesDescription')}
          </Alert>
        )}
      </Card>

      {selectedDeviceId && (
        <>
          {(summaryLoading || latestLoading) && (
            <Group justify="center" py="md">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">{t('power.loadingData')}</Text>
            </Group>
          )}

          {(summaryError || latestError) && (
            <Alert color="red" title={t('power.failedLiveTitle')}>
              {t('power.failedLiveDescription')}
            </Alert>
          )}

          {summary && !summary.has_data && (
            <Alert color="yellow" title={t('power.noDataTitle')}>
              {t('power.noDataDescription')}
            </Alert>
          )}

          {summary && summary.has_data && (
            <>
              <SimpleGrid cols={{ base: 2, sm: 4 }}>
                <BigStat
                  label={t('power.totalReadings')}
                  value={summary.stats.totalReadings.toLocaleString()}
                />
                <BigStat
                  label={t('power.activeAnomalies')}
                  value={String(summary.stats.activePowerAnomalies)}
                />
                <BigStat
                  label={t('power.policyBreachedWindows')}
                  value={String(summary.stats.policyBreachedWindows)}
                />
                <BigStat
                  label={t('power.totalAnomalies')}
                  value={String(summary.stats.totalPowerAnomalies)}
                />
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, lg: 3 }}>
                <Card p="md" radius="md">
                  <Text size="sm" c="dimmed">{t('power.activePower')}</Text>
                  <Text fw={700} fz={32}>{latest ? `${formatFixed(latest.activePowerTotalKw, 3)} kW` : '—'}</Text>
                </Card>
                <Card p="md" radius="md">
                  <Text size="sm" c="dimmed">{t('power.reactivePower')}</Text>
                  <Text fw={700} fz={32}>{latest ? `${formatFixed(latest.reactivePowerTotalKvar, 3)} kvar` : '—'}</Text>
                </Card>
                <Card p="md" radius="md">
                  <Text size="sm" c="dimmed">{t('power.apparentPower')}</Text>
                  <Text fw={700} fz={32}>{latest ? `${formatFixed(latest.apparentPowerTotalKva, 3)} kVA` : '—'}</Text>
                </Card>
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, lg: 2 }}>
                <Card p="md" radius="md">
                  <Group justify="space-between" mb="sm">
                    <Text fw={700}>{t('power.liveTrends')}</Text>
                    {latest && <Text size="sm" c="dimmed">{new Date(latest.timestamp).toLocaleTimeString()}</Text>}
                  </Group>

                  {historyError ? (
                    <Alert color="red" title={t('power.failedTrendTitle')}>{t('power.failedTrendDescription')}</Alert>
                  ) : historyLoading && trendData.length === 0 ? (
                    <Group justify="center" py="md">
                      <Loader size="sm" />
                    </Group>
                  ) : trendData.length === 0 ? (
                    <Text c="dimmed" ta="center">{t('power.noHistory')}</Text>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="time" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Line dataKey="active" stroke="#FFCC59" dot={false} strokeWidth={2} name={t('power.legendActiveKw')} isAnimationActive={false} />
                        <Line dataKey="reactive" stroke="#8ACDEA" dot={false} strokeWidth={2} name={t('power.legendReactiveKvar')} isAnimationActive={false} />
                        <Line dataKey="apparent" stroke="#DB3C3C" dot={false} strokeWidth={2} name={t('power.legendApparentKva')} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </Card>

                <Card p="md" radius="md">
                  <Text fw={700} mb="sm">{t('power.pfImbalance')}</Text>

                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <Stack align="center" gap="xs">
                      <RingProgress
                        size={130}
                        thickness={12}
                        roundCaps
                        sections={[{
                          value: Math.max(0, Math.min(100, (latest?.powerFactor ?? 0) * 100)),
                          color: (latest?.powerFactor ?? 0) >= (latest?.policy.minPowerFactor ?? 0.9)
                            ? '#8ACDEA'
                            : '#DB3C3C',
                        }]}
                        label={<Text ta="center" fw={700}>{latest ? formatFixed(latest.powerFactor, 3) : '—'}</Text>}
                      />
                      <Text size="xs" c="dimmed">{t('power.powerFactor')}</Text>
                      <Text size="xs" c="dimmed">{formatPfBand(latest)}</Text>
                      <Badge
                        color={(latest?.powerFactor ?? 0) >= (latest?.policy.minPowerFactor ?? 0.9)
                          ? 'secondary'
                          : 'danger'}
                        variant="light"
                      >
                        {(latest?.powerFactor ?? 0) >= (latest?.policy.minPowerFactor ?? 0.9)
                          ? 'Within policy'
                          : 'Below minimum'}
                      </Badge>
                    </Stack>

                    <Stack justify="center" gap="md">
                      <div>
                        <Group justify="space-between" mb={4}>
                          <Text size="sm">{t('power.phaseImbalance')}</Text>
                          <Text size="sm" fw={600}>
                            {latest ? `${formatFixed(latest.phaseImbalancePct, 1)}%` : '—'}
                          </Text>
                        </Group>
                        <Progress
                          value={Math.max(0, Math.min(100, latest?.phaseImbalancePct ?? 0))}
                          color={(latest?.phaseImbalancePct ?? 0) <= 20 ? '#8ACDEA' : '#DB3C3C'}
                          radius="xl"
                        />
                      </div>

                      <div>
                        <Text size="xs" c="dimmed" mb={2}>{t('power.policyBreaches')}</Text>
                        {latest?.breaches?.length ? (
                          <Stack gap={4}>
                            {latest.breaches.slice(0, 2).map((breach) => (
                              <Badge key={`${breach.metric}-${breach.message}`} color="danger" variant="light">
                                {breach.metric}
                              </Badge>
                            ))}
                          </Stack>
                        ) : (
                          <Text size="sm" c="dimmed">{t('power.noActiveBreaches')}</Text>
                        )}
                      </div>
                    </Stack>
                  </SimpleGrid>
                </Card>
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, lg: 2 }}>
                <Card p="md" radius="md">
                  <Text fw={700} mb="md">Latest report: power status</Text>

                  {reportsError || reportDetailError ? (
                    <Alert color="red" title={t('power.failedReportSectionsTitle')}>
                      {t('power.failedReportSectionsDescription')}
                    </Alert>
                  ) : reportsLoading || reportDetailLoading ? (
                    <Group justify="center" py="md"><Loader size="sm" /></Group>
                  ) : !reportDetail ? (
                    <Text c="dimmed" ta="center">{t('power.noTechnicalReport')}</Text>
                  ) : (
                    <Stack gap="md">
                      <Group justify="space-between">
                        <Badge
                          color={healthBadgeColor(reportDetail.powerHealthScore)}
                          variant="light"
                          size="lg"
                        >
                          Power {reportDetail.powerHealthScore}
                        </Badge>
                        <Text size="sm" c="dimmed">{reportUseLabel(reportDetail.reportUse, language)} {t('power.report')}</Text>
                      </Group>

                      <SimpleGrid cols={{ base: 2, sm: 4 }}>
                        <Card p="sm" withBorder>
                          <Text size="xs" c="dimmed">Power score</Text>
                          <Text fw={700}>{reportDetail.powerHealthScore}</Text>
                        </Card>
                        <Card p="sm" withBorder>
                          <Text size="xs" c="dimmed">Power anomalies</Text>
                          <Text fw={700}>{reportDetail.insights?.totalPowerAnomalies ?? 0}</Text>
                        </Card>
                        <Card p="sm" withBorder>
                          <Text size="xs" c="dimmed">Top power anomaly</Text>
                          <Text fw={700}>
                            {reportDetail.insights.powerAnomalyTypeDistribution?.[0]?.type ?? 'None'}
                          </Text>
                        </Card>
                        <Card p="sm" withBorder>
                          <Text size="xs" c="dimmed">Report period</Text>
                          <Text fw={700}>{reportDetail.reportUse.toUpperCase()}</Text>
                        </Card>
                      </SimpleGrid>

                      <Text size="sm">
                        Latest technical report power score is {reportDetail.powerHealthScore} with{' '}
                        {reportDetail.insights?.totalPowerAnomalies ?? 0} power-related anomalies in the selected report interval.
                      </Text>
                      <Text size="sm" c="dimmed">
                        This card is power-only. Voltage compliance remains available on the reports and voltage pages.
                      </Text>
                    </Stack>
                  )}
                </Card>

                <Card p="md" radius="md">
                  <Text fw={700} mb="md">{t('power.anomalyDistribution')}</Text>

                  {anomaliesError ? (
                    <Alert color="red" title={t('power.failedAnomalyDataTitle')}>{t('power.failedAnomalyDataDescription')}</Alert>
                  ) : anomaliesLoading && anomalyDistribution.length === 0 ? (
                    <Group justify="center" py="md"><Loader size="sm" /></Group>
                  ) : anomalyDistribution.length === 0 ? (
                    <Text c="dimmed" ta="center">{t('power.noAnomaliesYet')}</Text>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={localizedAnomalyDistribution} dataKey="count" nameKey="label" outerRadius={95} label>
                          {localizedAnomalyDistribution.map((entry, idx) => (
                            <Cell key={`${entry.type}-${idx}`} fill={anomalyColor(idx)} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </SimpleGrid>

              <Card p="md" radius="md">
                <Text fw={700} mb="md">{t('power.recentAnomalies')}</Text>

                {anomaliesError ? (
                  <Alert color="red" title={t('power.failedAnomaliesTitle')}>{t('power.failedAnomaliesDescription')}</Alert>
                ) : anomaliesLoading ? (
                  <Group justify="center" py="md"><Loader size="sm" /></Group>
                ) : !anomalies || anomalies.count === 0 ? (
                  <Text c="dimmed" ta="center">{t('power.noRecentAnomalies')}</Text>
                ) : (
                  <Table.ScrollContainer minWidth={700}>
                    <Table striped highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{t('power.type')}</Table.Th>
                          <Table.Th>{t('power.metric')}</Table.Th>
                          <Table.Th>{t('power.phase')}</Table.Th>
                          <Table.Th>{t('power.severity')}</Table.Th>
                          <Table.Th>{t('power.started')}</Table.Th>
                          <Table.Th>{t('power.status')}</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {anomalies.data.map((item) => (
                          <Table.Tr key={item.id}>
                            <Table.Td>{anomalyTypeLabel(item.type, language)}</Table.Td>
                            <Table.Td>{item.metricName ?? '—'}</Table.Td>
                            <Table.Td>{item.phase}</Table.Td>
                            <Table.Td>
                              <Badge color={severityBadgeColor(item.severity)} variant="light">S{item.severity}</Badge>
                            </Table.Td>
                            <Table.Td>{new Date(item.startsAt).toLocaleString()}</Table.Td>
                            <Table.Td>
                              <Badge color={item.endsAt ? 'secondary' : 'danger'} variant="light">
                                {item.endsAt ? t('power.resolved') : t('power.active')}
                              </Badge>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
              </Card>

              {reportDetail && (
                <Card p="md" radius="md">
                  <Text fw={700} mb="xs">{t('power.reportEnergySummary')}</Text>
                  <Text size="sm" c="dimmed">{localizedNarrative ?? reportDetail.insights?.narrative ?? '—'}</Text>

                  <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mt="md">
                    <Card p="sm" withBorder>
                      <Text size="xs" c="dimmed">{t('power.totalConsumed')}</Text>
                      <Text fw={700} fz="xl">{formatFixed(reportDetail.insights?.totalEnergyConsumedKwh, 2)} kWh</Text>
                    </Card>
                    <Card p="sm" withBorder>
                      <Text size="xs" c="dimmed">{t('power.totalReturned')}</Text>
                      <Text fw={700} fz="xl">{formatFixed(reportDetail.insights?.totalEnergyReturnedKwh, 2)} kWh</Text>
                    </Card>
                    <Card p="sm" withBorder>
                      <Text size="xs" c="dimmed">{t('power.avgEfficiency')}</Text>
                      <Text fw={700} fz="xl">
                        {reportDetail.insights?.averageEfficiencyPct != null
                          ? `${reportDetail.insights.averageEfficiencyPct.toFixed(1)}%`
                          : '—'}
                      </Text>
                    </Card>
                    <Card p="sm" withBorder>
                      <Text size="xs" c="dimmed">{t('power.avgHourlyElectricity')}</Text>
                      <Text fw={700} fz="xl">
                        {reportDetail.insights?.averageHourlyElectricityKwh != null
                          ? `${formatFixed(reportDetail.insights.averageHourlyElectricityKwh, 3)} kWh`
                          : '—'}
                      </Text>
                    </Card>
                  </SimpleGrid>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </Stack>
  );
}
