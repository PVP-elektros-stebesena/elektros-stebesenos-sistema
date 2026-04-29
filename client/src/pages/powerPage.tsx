import { useMemo, useState } from 'react';
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
import { useI18n } from '../i18n/i18n';
import type { EstimatedCost, GhostLoadOverview } from '../types/energy';
import { resolveDeviceSelection, useDeviceOptions } from '../hooks/useDeviceOptions';

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
  breaches: {
    metricName?: string;
    metric?: string;
    message?: string;
    thresholdValue?: number;
    observedValue?: number;
    unit?: string;
  }[];
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
  estimatedCost: EstimatedCost;
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

function powerPolicyMetricLabel(metric: string, language: 'en' | 'lt'): string {
  const labels: Record<string, string> = {
    ACTIVE_POWER_TOTAL: tr(language, 'Active power total', 'Bendra aktyvioji galia'),
    REACTIVE_POWER_TOTAL: tr(language, 'Reactive power total', 'Bendra reaktyvioji galia'),
    POWER_FACTOR: tr(language, 'Power factor', 'Galios koeficientas'),
    PHASE_IMBALANCE: tr(language, 'Phase imbalance', 'Fazių disbalansas'),
    ACTIVE_POWER_RAMP: tr(language, 'Active power ramp', 'Aktyviosios galios šuolis'),
  };

  return labels[metric] ?? metric;
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

function formatCurrency(value: number, language: 'en' | 'lt'): string {
  return new Intl.NumberFormat(language === 'lt' ? 'lt-LT' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function estimatedCostStatusLabel(status: EstimatedCost['status'], language: 'en' | 'lt'): string {
  if (status === 'complete') return tr(language, 'Complete estimate', 'Pilnas įvertis');
  if (status === 'partial') return tr(language, 'Partial estimate', 'Dalinis įvertis');
  return tr(language, 'Estimate unavailable', 'Įvertis nepasiekiamas');
}

function estimatedCostStatusColor(status: EstimatedCost['status']): string {
  if (status === 'complete') return 'green';
  if (status === 'partial') return 'yellow';
  return 'gray';
}

function standbyStatusColor(status: GhostLoadOverview['status']): string {
  if (status === 'complete') return 'green';
  if (status === 'partial') return 'yellow';
  return 'gray';
}

function standbyStatusLabel(status: GhostLoadOverview['status'], language: 'en' | 'lt'): string {
  if (status === 'complete') return tr(language, 'Complete', 'Pilna');
  if (status === 'partial') return tr(language, 'Partial', 'Dalinė');
  return tr(language, 'Unavailable', 'Nepasiekiama');
}

function standbyMessageKey(messageCode: GhostLoadOverview['messageCode']): string {
  if (messageCode === 'NO_ACTIVE_BILLING_PLAN') return 'power.ghostLoadNoActiveBillingPlanUi';
  if (messageCode === 'FIXED_TARIFF_UNAVAILABLE') return 'power.ghostLoadFixedTariffUnavailableUi';
  if (messageCode === 'DYNAMIC_CONFIG_INCOMPLETE') return 'power.ghostLoadDynamicConfigIncompleteUi';
  if (messageCode === 'SPOT_PRICE_UNAVAILABLE') return 'power.ghostLoadSpotPriceUnavailableUi';
  return 'power.ghostLoadNoBaseline';
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
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const {
    devices,
    isLoading: devicesLoading,
    error: devicesError,
  } = useDeviceOptions();
  const activeSelectedDeviceId = resolveDeviceSelection(selectedDeviceId, devices);

  const deviceQuery = useMemo(
    () => (activeSelectedDeviceId ? `?deviceId=${activeSelectedDeviceId}` : ''),
    [activeSelectedDeviceId],
  );

  const { data: latest, isLoading: latestLoading, error: latestError } = usePolling<PowerLatest>(
    ['power', 'latest', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? `/api/power/latest${deviceQuery}` : '',
    { intervalSeconds: 5, enabled: activeSelectedDeviceId != null },
  );

  const { data: summary, isLoading: summaryLoading, error: summaryError } = usePolling<PowerSummary>(
    ['power', 'summary', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? `/api/power/summary${deviceQuery}` : '',
    { intervalSeconds: 10, enabled: activeSelectedDeviceId != null },
  );

  const { data: history, isLoading: historyLoading, error: historyError } = usePolling<PowerHistoryResponse>(
    ['power', 'history', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? `/api/power/history?interval=raw&points=60&deviceId=${activeSelectedDeviceId}` : '',
    { intervalSeconds: 10, enabled: activeSelectedDeviceId != null },
  );

  const { data: anomalies, isLoading: anomaliesLoading, error: anomaliesError } = usePolling<PowerAnomalyResponse>(
    ['power', 'anomalies', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? `/api/power/anomalies?limit=10&deviceId=${activeSelectedDeviceId}` : '',
    { intervalSeconds: 10, enabled: activeSelectedDeviceId != null },
  );

  const { data: reportsList, isLoading: reportsLoading, error: reportsError } = usePolling<ReportListResponse>(
    ['reports', 'latest', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? `/api/reports?limit=1&deviceId=${activeSelectedDeviceId}&reportUse=technical` : '',
    { intervalSeconds: 30, enabled: activeSelectedDeviceId != null },
  );

  const latestReportId = reportsList?.data[0]?.id ?? null;

  const { data: reportDetail, isLoading: reportDetailLoading, error: reportDetailError } = usePolling<ReportDetail>(
    ['reports', 'detail', String(latestReportId ?? 'none')],
    latestReportId != null ? `/api/reports/${latestReportId}` : '',
    { intervalSeconds: 300, enabled: latestReportId != null },
  );

  const { data: standbyOverview, isLoading: standbyLoading, error: standbyError } = usePolling<GhostLoadOverview>(
    ['power', 'standby', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? `/api/power/standby?deviceId=${activeSelectedDeviceId}` : '',
    { intervalSeconds: 60, enabled: activeSelectedDeviceId != null },
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

  const standbyUpdatedLabel = standbyOverview?.baselineDate
    ? t('power.ghostLoadUpdated', {
      date: new Date(`${standbyOverview.baselineDate}T00:00:00`).toLocaleDateString(
        language === 'lt' ? 'lt-LT' : 'en-GB',
      ),
    })
    : null;

  const standbyMessage = standbyOverview
    ? t(standbyMessageKey(standbyOverview.messageCode) as never)
    : t('power.ghostLoadNoBaseline');

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
            value={activeSelectedDeviceId}
            onChange={setSelectedDeviceId}
            style={{ maxWidth: 320 }}
            disabled={devicesLoading || devices.length === 0}
          />
        </Stack>

        {devicesError && (
          <Alert mt="md" color="red" title={t('power.failedLoadDevicesTitle')}>
            {t('power.failedLoadDevices')}
          </Alert>
        )}

        {!devicesError && !devicesLoading && devices.length === 0 && (
          <Alert mt="md" color="yellow" title={t('power.noDevicesTitle')}>
            {t('power.noDevicesDescription')}
          </Alert>
        )}
      </Card>

      {activeSelectedDeviceId && (
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
                            {latest.breaches.slice(0, 2).map((breach, index) => {
                              const metric = breach.metricName ?? breach.metric ?? 'UNKNOWN_BREACH';
                              return (
                                <Badge key={`${metric}-${breach.thresholdValue ?? 'na'}-${index}`} color="danger" variant="light">
                                  {powerPolicyMetricLabel(metric, language)}
                                </Badge>
                              );
                            })}
                          </Stack>
                        ) : (
                          <Text size="sm" c="dimmed">{t('power.noActiveBreaches')}</Text>
                        )}
                      </div>
                    </Stack>
                  </SimpleGrid>
                </Card>
              </SimpleGrid>

              <Card p="md" radius="md">
                <Group justify="space-between" mb="md">
                  <div>
                    <Text fw={700}>{t('power.ghostLoadOverview')}</Text>
                    {standbyUpdatedLabel && (
                      <Text size="sm" c="dimmed">{standbyUpdatedLabel}</Text>
                    )}
                  </div>
                  {standbyOverview && (
                    <Badge color={standbyStatusColor(standbyOverview.status)} variant="light">
                      {standbyStatusLabel(standbyOverview.status, language)}
                    </Badge>
                  )}
                </Group>

                {standbyError ? (
                  <Alert color="red" title={t('power.ghostLoadOverview')}>
                    {t('power.failedLiveDescription')}
                  </Alert>
                ) : standbyLoading && !standbyOverview ? (
                  <Group justify="center" py="md"><Loader size="sm" /></Group>
                ) : !standbyOverview || standbyOverview.baselinePowerWatts == null ? (
                  <Text c="dimmed">
                    {standbyMessage}
                  </Text>
                ) : (
                  <Stack gap="sm">
                    <Text>{t('power.ghostLoadConstantDraw', { watts: standbyOverview.baselinePowerWatts })}</Text>
                    <Text>{t('power.ghostLoadDailyUsage', { kwh: standbyOverview.projectedDailyKwh?.toFixed(1) ?? '0.0' })}</Text>

                    <SimpleGrid cols={{ base: 1, sm: 3 }}>
                      <Card p="sm" withBorder>
                        <Text size="xs" c="dimmed">{t('power.ghostLoadMonthlyUsage')}</Text>
                        <Text fw={700} fz="xl">
                          {standbyOverview.projectedMonthlyKwh != null ? `${standbyOverview.projectedMonthlyKwh.toFixed(1)} kWh` : '—'}
                        </Text>
                      </Card>
                      <Card p="sm" withBorder>
                        <Text size="xs" c="dimmed">{t('power.ghostLoadCurrentRate')}</Text>
                        <Text fw={700} fz="xl">
                          {standbyOverview.currentRateEurPerKwh != null
                            ? `${standbyOverview.currentRateEurPerKwh.toFixed(3)} €/kWh`
                            : '—'}
                        </Text>
                      </Card>
                      <Card p="sm" withBorder>
                        <Text size="xs" c="dimmed">{t('power.ghostLoadMonthlyCostLabel')}</Text>
                        <Text fw={700} fz="xl">
                          {standbyOverview.projectedMonthlyCostEur != null
                            ? formatCurrency(standbyOverview.projectedMonthlyCostEur, language)
                            : '—'}
                        </Text>
                      </Card>
                    </SimpleGrid>

                    {standbyOverview.projectedMonthlyCostEur != null ? (
                      <Text>
                        {t('power.ghostLoadMonthlyCost', {
                          cost: formatCurrency(standbyOverview.projectedMonthlyCostEur, language),
                        })}
                      </Text>
                    ) : (
                      <Text c="dimmed">
                        {standbyMessage}
                      </Text>
                    )}
                  </Stack>
                )}
              </Card>

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

                      <Group justify="space-between" align="flex-start" wrap="wrap">
                        <div>
                          <Text size="sm" fw={600}>
                            {tr(language, 'Estimated electricity cost', 'Numatoma elektros kaina')}: {formatCurrency(reportDetail.estimatedCost.totalEur, language)}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {tr(language, 'Coverage gap', 'Trūkstama aprėptis')}: {reportDetail.estimatedCost.missingCoveragePct.toFixed(1)}%
                          </Text>
                        </div>
                        <Badge color={estimatedCostStatusColor(reportDetail.estimatedCost.status)} variant="light">
                          {estimatedCostStatusLabel(reportDetail.estimatedCost.status, language)}
                        </Badge>
                      </Group>

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

                  <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} mt="md">
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
                    <Card p="sm" withBorder>
                      <Text size="xs" c="dimmed">{tr(language, 'Estimated cost', 'Numatoma kaina')}</Text>
                      <Text fw={700} fz="xl">{formatCurrency(reportDetail.estimatedCost.totalEur, language)}</Text>
                      <Badge color={estimatedCostStatusColor(reportDetail.estimatedCost.status)} variant="light" mt={8}>
                        {estimatedCostStatusLabel(reportDetail.estimatedCost.status, language)}
                      </Badge>
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
