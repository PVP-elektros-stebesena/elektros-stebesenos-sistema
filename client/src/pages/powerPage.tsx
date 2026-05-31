import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Card,
  Group,
  Loader,
  Modal,
  Progress,
  RingProgress,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePolling } from '../hooks/usePolling';
import { useI18n } from '../i18n/i18n';
import { CapacityUtilizationGauge } from '../components/capacity-utilization-gauge';
import type { EstimatedCost, GhostLoadOverview, ReactivePenaltyEstimate } from '../types/energy';
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
    maxGridCapacityKw: number;
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

interface SolarSummary {
  count: number;
  data: {
    date: string;
    importedKwh: number | null;
    exportedKwh: number | null;
    selfConsumptionRatioPct: number | null;
    sampleCount: number;
  }[];
  totals: {
    importedKwh: number | null;
    exportedKwh: number | null;
    selfConsumptionRatioPct: number | null;
  };
  currentExport: {
    exporting: boolean;
    exportPowerKw: number | null;
    thresholdKw: number;
    opportunity: boolean;
    latestTimestamp: string | null;
  };
}

interface PowerHistoryPoint {
  timestamp: string;
  activePowerTotalKw: number | null;
  reactivePowerTotalKvar: number | null;
  apparentPowerTotalKva: number | null;
  powerFactor: number | null;
  activePowerL1Kw: number | null;
  activePowerL2Kw: number | null;
  activePowerL3Kw: number | null;
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

interface UsageAnomaly {
  id: number;
  deviceId: number | null;
  startsAt: string;
  endsAt: string;
  observedKwh: number;
  baselineKwh: number;
  deltaPct: number;
  explanation: string;
  scope: 'PER_DEVICE';
  device: {
    id: number;
    name: string;
  } | null;
}

interface UsageAnomalyResponse {
  count: number;
  data: UsageAnomaly[];
}

interface UsageAnomalySettings {
  enabled: boolean;
  baselineWeeks: number;
  thresholdPct: number;
  sustainedIntervals: number;
  scope: 'PER_DEVICE';
}

interface ReportListResponse {
  count: number;
  data: {
    id: number;
  }[];
}

interface ReportDetail {
  reportUse: 'home' | 'technical' | 'solar';
  startsAt: string;
  endsAt: string;
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
  reactivePenalty: ReactivePenaltyEstimate;
}

interface PowerTrendPoint {
  time: string;
  active: number | null;
  reactive: number | null;
  apparent: number | null;
  pf: number | null;
}

interface GridCompliancePoint {
  timestamp: string;
  windowEnd: string;
  sampleCount: number;
  reactivePowerTotalKvar: number | null;
  reactiveEnergyReturnedKvarh: number;
  powerFactor: number | null;
  tanPhi: number | null;
  lowPowerFactor: boolean;
}

interface GridComplianceResponse {
  deviceId: number;
  from: string;
  to: string;
  targetPowerFactor: number;
  allowedTanPhiRatio: number;
  penaltyEstimate: ReactivePenaltyEstimate;
  summary: {
    totalWindows: number;
    lowPowerFactorWindowCount: number;
    lowPowerFactorWindowPct: number | null;
    averagePowerFactor: number | null;
    minPowerFactor: number | null;
    reactiveEnergyReturnedKvarh: number;
  };
  data: GridCompliancePoint[];
}

interface GridComplianceChartPoint {
  time: string;
  reactivePowerTotalKvar: number | null;
  reactiveEnergyReturnedKvarh: number;
  powerFactor: number | null;
  lowPowerFactorValue: number | null;
}

interface PowerPhaseTrendPoint {
  time: string;
  l1: number | null;
  l2: number | null;
  l3: number | null;
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
  const powerLabels: Record<string, string> = {
    LOW_POWER_FACTOR: tr(language, 'Low power factor', 'Žemas galios koeficientas'),
    POWER_SPIKE: tr(language, 'Power spike', 'Galios šuolis'),
    OVER_CAPACITY_WARNING: tr(language, 'Over capacity warning', 'Galios ribos įspėjimas'),
    REACTIVE_POWER_SPIKE: tr(language, 'Reactive power spike', 'Reaktyviosios galios šuolis'),
    PHASE_IMBALANCE: tr(language, 'Phase imbalance', 'Fazių disbalansas'),
    POWER_RAMP_RATE: tr(language, 'Power ramp rate', 'Galios kitimo šuolis'),
  };
  if (powerLabels[type]) return powerLabels[type];

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

function LockedPanel({ title, description }: { title: string; description: string }) {
  return (
    <Card p="lg" radius="md" withBorder>
      <Stack gap="xs">
        <Text fw={700}>{title}</Text>
        <Text size="sm" c="dimmed">{description}</Text>
      </Stack>
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

function formatKwh(value: number): string {
  return `${value.toFixed(3)} kWh`;
}

function formatDeltaPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
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

function reactivePenaltyStatusLabel(
  status: ReactivePenaltyEstimate['status'],
  language: 'en' | 'lt',
): string {
  if (status === 'complete') return tr(language, 'Complete estimate', 'Pilnas įvertis');
  if (status === 'partial') return tr(language, 'Partial estimate', 'Dalinis įvertis');
  if (status === 'not_applicable') return tr(language, 'Not applicable', 'Netaikoma');
  return tr(language, 'Estimate unavailable', 'Įvertis nepasiekiamas');
}

function reactivePenaltyStatusColor(status: ReactivePenaltyEstimate['status']): string {
  if (status === 'complete') return 'green';
  if (status === 'partial') return 'yellow';
  if (status === 'not_applicable') return 'gray';
  return 'red';
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

function formatShortDateTime(value: string, language: 'en' | 'lt'): string {
  return new Date(value).toLocaleString(language === 'lt' ? 'lt-LT' : 'en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatReportPeriod(startsAt: string, endsAt: string, language: 'en' | 'lt'): string {
  return `${formatShortDateTime(startsAt, language)} - ${formatShortDateTime(endsAt, language)}`;
}

function categoryTickInterval(dataLength: number, maxTicks = 20): number | 'preserveStartEnd' {
  if (dataLength <= maxTicks) return 'preserveStartEnd';
  return Math.max(0, Math.ceil(dataLength / maxTicks));
}

export function PowerPage() {
  const { t, language } = useI18n();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedUsageAnomaly, setSelectedUsageAnomaly] = useState<UsageAnomaly | null>(null);
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

  const handleDeviceChange = (value: string | null) => {
    setSelectedDeviceId(value);
    setSelectedUsageAnomaly(null);
  };

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

  const {
    data: activeAnomaliesResponse,
    isLoading: activeAnomaliesLoading,
    error: activeAnomaliesError,
  } = usePolling<PowerAnomalyResponse>(
    ['power', 'active-anomalies', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? `/api/power/anomalies/active${deviceQuery}` : '',
    { intervalSeconds: 10, enabled: activeSelectedDeviceId != null },
  );

  const {
    data: usageAnomalies,
    isLoading: usageAnomaliesLoading,
    error: usageAnomaliesError,
  } = usePolling<UsageAnomalyResponse>(
    ['usage-insights', 'anomalies', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? `/api/usage-insights/anomalies?limit=5&deviceId=${activeSelectedDeviceId}` : '',
    { intervalSeconds: 60, enabled: activeSelectedDeviceId != null },
  );

  const { data: usageAnomalySettings } = usePolling<UsageAnomalySettings>(
    ['usage-insights', 'settings'],
    '/api/usage-insights/settings',
    { intervalSeconds: 60 },
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

  const { data: solarSummary, isLoading: solarLoading, error: solarError } = usePolling<SolarSummary>(
    ['power', 'solar-summary', activeSelectedDeviceId ?? 'none'],
    activeSelectedDeviceId ? `/api/power/solar-summary?days=7&deviceId=${activeSelectedDeviceId}` : '',
    { intervalSeconds: 60, enabled: activeSelectedDeviceId != null },
  );

  const gridComplianceQuery = useMemo(() => {
    if (!activeSelectedDeviceId) return '';

    const params = new URLSearchParams({ deviceId: String(activeSelectedDeviceId) });
    if (reportDetail?.startsAt) params.set('from', reportDetail.startsAt);
    if (reportDetail?.endsAt) params.set('to', reportDetail.endsAt);

    return `/api/power/grid-compliance?${params.toString()}`;
  }, [activeSelectedDeviceId, reportDetail?.startsAt, reportDetail?.endsAt]);

  const {
    data: gridCompliance,
    isLoading: gridComplianceLoading,
    error: gridComplianceError,
  } = usePolling<GridComplianceResponse>(
    [
      'power',
      'grid-compliance',
      activeSelectedDeviceId ?? 'none',
      reportDetail?.startsAt ?? 'none',
      reportDetail?.endsAt ?? 'none',
    ],
    gridComplianceQuery,
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

  const phaseTrendData: PowerPhaseTrendPoint[] = useMemo(() => {
    return (history?.data ?? []).map((point) => ({
      time: new Date(point.timestamp).toLocaleTimeString(),
      l1: point.activePowerL1Kw,
      l2: point.activePowerL2Kw,
      l3: point.activePowerL3Kw,
    }));
  }, [history]);

  const gridComplianceChartData: GridComplianceChartPoint[] = useMemo(() => {
    return (gridCompliance?.data ?? []).map((point) => ({
      time: new Date(point.timestamp).toLocaleString(language === 'lt' ? 'lt-LT' : 'en-GB', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
      reactivePowerTotalKvar: point.reactivePowerTotalKvar,
      reactiveEnergyReturnedKvarh: point.reactiveEnergyReturnedKvarh,
      powerFactor: point.powerFactor,
      lowPowerFactorValue: point.lowPowerFactor ? point.powerFactor : null,
    }));
  }, [gridCompliance, language]);

  const lowPowerFactorWindows = useMemo(
    () => (gridCompliance?.data ?? []).filter((point) => point.lowPowerFactor).slice(-10).reverse(),
    [gridCompliance],
  );

  const gridComplianceXAxisInterval = categoryTickInterval(gridComplianceChartData.length);
  const gridComplianceEstimateAvailable =
    gridCompliance?.penaltyEstimate.status === 'complete' ||
    gridCompliance?.penaltyEstimate.status === 'partial';

  const usageAnomalyDetectionDisabled = usageAnomalySettings?.enabled === false;

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

  const activeAnomalies = activeAnomaliesResponse?.data ?? [];

  const topPowerAnomaly = reportDetail?.insights.powerAnomalyTypeDistribution?.[0] ?? null;

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

      const topAnomaly = reportDetail.insights.powerAnomalyTypeDistribution.length > 0
        ? reportDetail.insights.powerAnomalyTypeDistribution.reduce((acc, cur) => (cur.count > acc.count ? cur : acc))
        : null;

      if (topAnomaly) {
        parts.push(
          tr(
            language,
            `The most frequently observed power anomaly was ${anomalyTypeLabel(topAnomaly.type, language)} (${topAnomaly.count} occurrences).`,
            `Dažniausiai aptikta galios anomalijų kategorija buvo ${anomalyTypeLabel(topAnomaly.type, language)} (${topAnomaly.count} atvejai).`,
          ),
        );
      } else {
        parts.push(
          tr(
            language,
            'No power anomalies were detected within the selected reporting interval.',
            'Pasirinktame ataskaitos intervale galios anomalijų neaptikta.',
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

  const powerProfile = latest?.policy.profile ?? null;
  const isCommercialProfile = powerProfile === 'COMMERCIAL_3P_30KW';
  const isSolarProfile = powerProfile === 'SOLAR_PROSUMER_3P_22KW';
  const showCommercialLock = powerProfile != null && !isCommercialProfile;
  const showSolarLock = powerProfile != null && !(isSolarProfile || isCommercialProfile);
  const summaryStats = summary?.stats;

  const overviewPanel = (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <BigStat
          label={t('power.totalReadings')}
          value={(summaryStats?.totalReadings ?? 0).toLocaleString()}
        />
        <BigStat
          label={t('power.activeAnomalies')}
          value={String(summaryStats?.activePowerAnomalies ?? 0)}
        />
        <BigStat
          label={t('power.policyBreachedWindows')}
          value={String(summaryStats?.policyBreachedWindows ?? 0)}
        />
        <BigStat
          label={t('power.totalAnomalies')}
          value={String(summaryStats?.totalPowerAnomalies ?? 0)}
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

      <Card p="md" radius="md">
        <Group justify="space-between" mb="sm" wrap="wrap">
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
          <ResponsiveContainer width="100%" height={320}>
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

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <CapacityUtilizationGauge
          title={t('power.capacityUtilization')}
          currentPowerKw={latest?.activePowerTotalKw ?? null}
          capacityKw={latest?.policy.maxGridCapacityKw ?? null}
        />

        <Card p="md" radius="md">
          <Group justify="space-between" mb="sm" wrap="wrap">
            <Text fw={700}>{t('power.activeAnomalies')}</Text>
            <Badge variant="light">
              {summaryStats?.activePowerAnomalies ?? 0}
            </Badge>
          </Group>

          {activeAnomaliesError ? (
            <Alert color="red" title={t('power.failedAnomaliesTitle')}>
              {t('power.failedAnomaliesDescription')}
            </Alert>
          ) : activeAnomaliesLoading ? (
            <Group justify="center" py="md"><Loader size="sm" /></Group>
          ) : activeAnomalies.length === 0 ? (
            <Text c="dimmed" ta="center">{t('power.noActiveAnomalies')}</Text>
          ) : (
            <Stack gap="xs">
              {activeAnomalies.slice(0, 4).map((item) => (
                <Group key={item.id} justify="space-between" wrap="nowrap">
                  <Text size="sm" fw={600}>{anomalyTypeLabel(item.type, language)}</Text>
                  <Text size="xs" c="dimmed">{new Date(item.startsAt).toLocaleTimeString()}</Text>
                </Group>
              ))}
            </Stack>
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
    </Stack>
  );

  const usageCostPanel = (
    <Stack gap="md">
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

      <Card p="md" radius="md">
        <Group justify="space-between" mb="md">
          <Text fw={700}>{t('power.usageInsightsTitle')}</Text>
          <Group gap="xs">
            {usageAnomalyDetectionDisabled ? (
              <Badge variant="light" color="gray">
                {t('common.disabled')}
              </Badge>
            ) : null}
          </Group>
        </Group>

        {usageAnomaliesError ? (
          <Alert color="red" title={t('power.usageInsightsLoadErrorTitle')}>
            {t('power.failedAnomalyDataDescription')}
          </Alert>
        ) : usageAnomaliesLoading ? (
          <Group justify="center" py="md"><Loader size="sm" /></Group>
        ) : usageAnomalyDetectionDisabled && (!usageAnomalies || usageAnomalies.count === 0) ? (
          <Text c="dimmed" ta="center">
            {t('power.usageInsightsDisabledMessage')}
          </Text>
        ) : !usageAnomalies || usageAnomalies.count === 0 ? (
          <Text c="dimmed" ta="center">
            {t('power.usageInsightsEmptyMessage')}
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={720}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('power.usageInsightsDeltaLabel')}</Table.Th>
                  <Table.Th>{t('power.usageInsightsStartedLabel')}</Table.Th>
                  <Table.Th>{t('power.usageInsightsObservedLabel')}</Table.Th>
                  <Table.Th>{t('power.usageInsightsBaselineLabel')}</Table.Th>
                  <Table.Th>{t('power.usageInsightsExplanationLabel')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {usageAnomalies.data.slice(0, 5).map((item) => (
                  <Table.Tr
                    key={item.id}
                    onClick={() => setSelectedUsageAnomaly(item)}
                    style={{ cursor: 'pointer' }}
                  >
                    <Table.Td>
                      <Badge color={item.deltaPct >= 0 ? 'red' : 'blue'} variant="light">
                        {formatDeltaPct(item.deltaPct)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{new Date(item.startsAt).toLocaleString()}</Table.Td>
                    <Table.Td>{formatKwh(item.observedKwh)}</Table.Td>
                    <Table.Td>{formatKwh(item.baselineKwh)}</Table.Td>
                    <Table.Td>
                      <Text size="sm" lineClamp={2}>{item.explanation}</Text>
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
              <Text size="xs" c="dimmed">{t('power.estimatedCost')}</Text>
              <Text fw={700} fz="xl">{formatCurrency(reportDetail.estimatedCost.totalEur, language)}</Text>
              <Badge color={estimatedCostStatusColor(reportDetail.estimatedCost.status)} variant="light" mt={8}>
                {estimatedCostStatusLabel(reportDetail.estimatedCost.status, language)}
              </Badge>
            </Card>
          </SimpleGrid>
        </Card>
      )}
    </Stack>
  );

  const powerQualityPanel = (
    <Stack gap="md">
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

      <Card p="md" radius="md">
        <Text fw={700} mb="sm">{t('power.phaseLoadDistribution')}</Text>

        {historyError ? (
          <Alert color="red" title={t('power.failedTrendTitle')}>{t('power.failedTrendDescription')}</Alert>
        ) : historyLoading && phaseTrendData.length === 0 ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : phaseTrendData.length === 0 ? (
          <Text c="dimmed" ta="center">{t('power.noHistory')}</Text>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={phaseTrendData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Area
                type="monotone"
                dataKey="l1"
                stackId="1"
                stroke="#FFCC59"
                fill="#FFCC59"
                fillOpacity={0.35}
                name={t('power.legendL1Kw')}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="l2"
                stackId="1"
                stroke="#8ACDEA"
                fill="#8ACDEA"
                fillOpacity={0.35}
                name={t('power.legendL2Kw')}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="l3"
                stackId="1"
                stroke="#A78BFA"
                fill="#A78BFA"
                fillOpacity={0.35}
                name={t('power.legendL3Kw')}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card p="md" radius="md">
          <Text fw={700} mb="md">{t('power.latestReportPowerStatus')}</Text>

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
                  {t('power.latestReportPowerBadge', { score: reportDetail.powerHealthScore })}
                </Badge>
                <Text size="sm" c="dimmed">{reportUseLabel(reportDetail.reportUse, language)} {t('power.report')}</Text>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Card p="sm" withBorder>
                  <Text size="xs" c="dimmed">{t('power.powerScore')}</Text>
                  <Text fw={700}>{reportDetail.powerHealthScore}</Text>
                </Card>
                <Card p="sm" withBorder>
                  <Text size="xs" c="dimmed">{t('power.powerAnomalies')}</Text>
                  <Text fw={700}>{reportDetail.insights?.totalPowerAnomalies ?? 0}</Text>
                </Card>
                <Card p="sm" withBorder>
                  <Text size="xs" c="dimmed">{t('power.topPowerAnomaly')}</Text>
                  <Text fw={700} lineClamp={2} style={{ wordBreak: 'break-word' }}>
                    {topPowerAnomaly
                      ? `${anomalyTypeLabel(topPowerAnomaly.type, language)} (${topPowerAnomaly.count})`
                      : t('power.none')}
                  </Text>
                </Card>
                <Card p="sm" withBorder>
                  <Text size="xs" c="dimmed">{t('power.reportPeriod')}</Text>
                  <Text fw={700} size="sm" lineClamp={2}>
                    {formatReportPeriod(reportDetail.startsAt, reportDetail.endsAt, language)}
                  </Text>
                </Card>
              </SimpleGrid>
              <Text size="sm">
                {t('power.latestTechnicalReportSummary', {
                  score: reportDetail.powerHealthScore,
                  count: reportDetail.insights?.totalPowerAnomalies ?? 0,
                })}
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
                  <Table.Th>{t('power.threshold')}</Table.Th>
                  <Table.Th>{t('power.anomalyObservedMax')}</Table.Th>
                  <Table.Th>{t('power.anomalyObservedAvg')}</Table.Th>
                  <Table.Th>{t('power.severity')}</Table.Th>
                  <Table.Th>{t('power.started')}</Table.Th>
                  <Table.Th>{t('power.status')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {anomalies.data.slice(0, 5).map((item) => (
                  <Table.Tr key={item.id}>
                    <Table.Td>{anomalyTypeLabel(item.type, language)}</Table.Td>
                    <Table.Td>{item.metricName ?? '—'}</Table.Td>
                    <Table.Td>{item.phase}</Table.Td>
                    <Table.Td>
                      {item.thresholdValue != null
                        ? `${formatFixed(item.thresholdValue, 2)}${item.unit ? ` ${item.unit}` : ''}`
                        : '—'}
                    </Table.Td>
                    <Table.Td>
                      {item.observedMax != null
                        ? `${formatFixed(item.observedMax, 2)}${item.unit ? ` ${item.unit}` : ''}`
                        : '—'}
                    </Table.Td>
                    <Table.Td>
                      {item.observedAvg != null
                        ? `${formatFixed(item.observedAvg, 2)}${item.unit ? ` ${item.unit}` : ''}`
                        : '—'}
                    </Table.Td>
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


    </Stack>
  );

  const gridCompliancePanel = showCommercialLock ? (
    <LockedPanel
      title={t('power.lockedCommercialTitle')}
      description={t('power.lockedCommercialDescription')}
    />
  ) : (
    <Stack gap="md">
      {gridComplianceError ? (
        <Alert color="red" title={t('power.gridComplianceFailedLoadTitle')}>
          {t('power.failedTrendDescription')}
        </Alert>
      ) : gridComplianceLoading && !gridCompliance ? (
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      ) : !gridCompliance ? (
        <Text c="dimmed" ta="center">{t('power.noHistory')}</Text>
      ) : (
        <>
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <div>
              <Text fw={700}>
                {t('power.esoReactivePenaltyEstimate')}
              </Text>
              <Text size="sm" c="dimmed">
                {gridCompliance.penaltyEstimate.message}
              </Text>
            </div>
            <Badge
              color={reactivePenaltyStatusColor(gridCompliance.penaltyEstimate.status)}
              variant="light"
              size="lg"
            >
              {reactivePenaltyStatusLabel(gridCompliance.penaltyEstimate.status, language)}
            </Badge>
          </Group>

          {!gridComplianceEstimateAvailable ? (
            <Alert color="gray" title={t('power.gridComplianceEstimateUnavailableTitle')}>
              {t('power.gridComplianceEstimateUnavailableDescription')}
            </Alert>
          ) : (
            <>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                <Card p="md" radius="md">
                  <Text size="xs" c="dimmed">{t('power.estimatedPenalty')}</Text>
                  <Text fw={700} fz={32}>
                    {gridCompliance.penaltyEstimate.totalEur != null
                      ? formatCurrency(gridCompliance.penaltyEstimate.totalEur, language)
                      : '—'}
                  </Text>
                </Card>
                <Card p="md" radius="md">
                  <Text size="xs" c="dimmed">{t('power.activeImportedEnergy')}</Text>
                  <Text fw={700} fz="xl">
                    {formatFixed(gridCompliance.penaltyEstimate.activeImportedKwh, 3)} kWh
                  </Text>
                </Card>
                <Card p="md" radius="md">
                  <Text size="xs" c="dimmed">{t('power.reactiveConsumed')}</Text>
                  <Text fw={700} fz="xl">
                    {formatFixed(gridCompliance.penaltyEstimate.reactiveConsumedKvarh, 3)} kVArh
                  </Text>
                </Card>
                <Card p="md" radius="md">
                  <Text size="xs" c="dimmed">{t('power.reactiveReturned')}</Text>
                  <Text fw={700} fz="xl">
                    {formatFixed(gridCompliance.penaltyEstimate.reactiveReturnedKvarh, 3)} kVArh
                  </Text>
                </Card>
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                <Card p="md" radius="md">
                  <Text size="xs" c="dimmed">{t('power.allowedReactiveConsumed')}</Text>
                  <Text fw={700}>
                    {formatFixed(gridCompliance.penaltyEstimate.allowedReactiveConsumedKvarh, 3)} kVArh
                  </Text>
                </Card>
                <Card p="md" radius="md">
                  <Text size="xs" c="dimmed">{t('power.chargeableConsumed')}</Text>
                  <Text fw={700}>
                    {formatFixed(gridCompliance.penaltyEstimate.chargeableReactiveConsumedKvarh, 3)} kVArh
                  </Text>
                </Card>
                <Card p="md" radius="md">
                  <Text size="xs" c="dimmed">{t('power.chargeableReturned')}</Text>
                  <Text fw={700}>
                    {formatFixed(gridCompliance.penaltyEstimate.chargeableReactiveReturnedKvarh, 3)} kVArh
                  </Text>
                </Card>
                <Card p="md" radius="md">
                  <Text size="xs" c="dimmed">{t('power.lowPowerFactorWindows')}</Text>
                  <Text fw={700}>
                    {gridCompliance.summary.lowPowerFactorWindowCount}
                    {gridCompliance.summary.lowPowerFactorWindowPct != null
                      ? ` (${gridCompliance.summary.lowPowerFactorWindowPct.toFixed(1)}%)`
                      : ''}
                  </Text>
                </Card>
              </SimpleGrid>

              {gridCompliance.penaltyEstimate.totalEur != null && gridCompliance.penaltyEstimate.totalEur > 0 && (
                <Alert color="yellow" title={t('power.reactiveCompensationRecommended')}>
                  {t('power.reactiveCompensationRecommendedDescription')}
                </Alert>
              )}

              <Stack gap="md">
                <Card p="md" radius="md">
                  <Text fw={700} mb="sm">{t('power.reactivePower')}</Text>
                  {gridComplianceChartData.length === 0 ? (
                    <Text c="dimmed" ta="center">{t('power.noHistory')}</Text>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={gridComplianceChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="time" interval={gridComplianceXAxisInterval} tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Line
                          dataKey="reactivePowerTotalKvar"
                          stroke="#8ACDEA"
                          strokeWidth={2}
                          dot={false}
                          name={t('power.reactiveKvar')}
                          isAnimationActive={false}
                        />
                        <Line
                          dataKey="reactiveEnergyReturnedKvarh"
                          stroke="#A78BFA"
                          strokeWidth={2}
                          dot={false}
                          name={t('power.returnedKvarh')}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </Card>

                <Card p="md" radius="md">
                  <Text fw={700} mb="sm">{t('power.powerFactor')}</Text>
                  {gridComplianceChartData.length === 0 ? (
                    <Text c="dimmed" ta="center">{t('power.noHistory')}</Text>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={gridComplianceChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="time" interval={gridComplianceXAxisInterval} tick={{ fontSize: 11 }} />
                        <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <ReferenceLine
                          y={gridCompliance.targetPowerFactor}
                          stroke="#FFCC59"
                          strokeDasharray="4 4"
                          label="0.95"
                        />
                        <Line
                          dataKey="powerFactor"
                          stroke="#8ACDEA"
                          strokeWidth={2}
                          dot={false}
                          name={tr(language, 'Power factor', 'Galios koeficientas')}
                          isAnimationActive={false}
                        />
                        <Line
                          dataKey="lowPowerFactorValue"
                          stroke="#DB3C3C"
                          strokeWidth={3}
                          dot={{ r: 3 }}
                          name={t('power.below095')}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </Stack>

              <Card p="md" radius="md">
                <Group justify="space-between" mb="md" align="flex-start" wrap="wrap">
                  <div>
                    <Text fw={700}>{t('power.recentLowPowerFactorPeriods')}</Text>
                    <Text size="sm" c="dimmed">
                      {t('power.threshold')}: {gridCompliance.targetPowerFactor.toFixed(2)}
                    </Text>
                  </div>
                  <Group gap="xs">
                    <Badge variant="light">
                      {t('power.avgPfShort')}: {formatFixed(gridCompliance.summary.averagePowerFactor, 3)}
                    </Badge>
                    <Badge variant="light" color="yellow">
                      {t('power.minPfShort')}: {formatFixed(gridCompliance.summary.minPowerFactor, 3)}
                    </Badge>
                  </Group>
                </Group>

                {lowPowerFactorWindows.length === 0 ? (
                  <Text c="dimmed" ta="center">{t('power.noLowPowerFactorWindowsInRange')}</Text>
                ) : (
                  <Table.ScrollContainer minWidth={680}>
                    <Table striped highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{t('power.started')}</Table.Th>
                          <Table.Th>{t('power.powerFactor')}</Table.Th>
                          <Table.Th>{t('power.tanPhi')}</Table.Th>
                          <Table.Th>{t('power.reactiveKvar')}</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {lowPowerFactorWindows.map((item) => (
                          <Table.Tr key={item.timestamp}>
                            <Table.Td>{new Date(item.timestamp).toLocaleString()}</Table.Td>
                            <Table.Td>
                              <Badge color="red" variant="light">
                                {formatFixed(item.powerFactor, 3)}
                              </Badge>
                            </Table.Td>
                            <Table.Td>{formatFixed(item.tanPhi, 3)}</Table.Td>
                            <Table.Td>{formatFixed(item.reactivePowerTotalKvar, 3)} kVAr</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </Stack>
  );

  const solarPanel = showSolarLock ? (
    <LockedPanel
      title={t('power.lockedSolarTitle')}
      description={t('power.lockedSolarDescription')}
    />
  ) : (
    <Stack gap="md">
      <Card p="md" radius="md">
        <Group justify="space-between" mb="md" align="flex-start" wrap="wrap">
          <div>
            <Text fw={700}>{t('power.solarOptimizations')}</Text>
            <Text size="sm" c="dimmed">{t('power.currentExportStatus')}</Text>
          </div>
          {solarSummary && (
            <Badge color={solarSummary.currentExport.exporting ? 'green' : 'gray'} variant="light">
              {solarSummary.currentExport.exporting ? t('power.exportingNow') : t('power.notExporting')}
            </Badge>
          )}
        </Group>

        {solarError ? (
          <Alert color="red" title={t('power.failedSolarSummaryTitle')}>
            {t('power.failedLiveDescription')}
          </Alert>
        ) : solarLoading && !solarSummary ? (
          <Group justify="center" py="md"><Loader size="sm" /></Group>
        ) : !solarSummary || solarSummary.count === 0 ? (
          <Text c="dimmed">{t('power.noSolarSummary')}</Text>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            <Card p="sm" withBorder>
              <Text size="xs" c="dimmed">{t('power.selfConsumptionRatio')}</Text>
              <Text fw={700} fz="xl">
                {solarSummary.totals.selfConsumptionRatioPct != null
                  ? `${solarSummary.totals.selfConsumptionRatioPct.toFixed(1)}%`
                  : 'â€”'}
              </Text>
            </Card>
            <Card p="sm" withBorder>
              <Text size="xs" c="dimmed">{t('power.importedToday')}</Text>
              <Text fw={700} fz="xl">{formatFixed(solarSummary.totals.importedKwh, 2)} kWh</Text>
            </Card>
            <Card p="sm" withBorder>
              <Text size="xs" c="dimmed">{t('power.exportedToday')}</Text>
              <Text fw={700} fz="xl">{formatFixed(solarSummary.totals.exportedKwh, 2)} kWh</Text>
            </Card>
            <Card p="sm" withBorder>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="xs" c="dimmed">{t('power.exportOpportunity')}</Text>
                <Badge color={solarSummary.currentExport.opportunity ? 'green' : 'gray'} variant="light">
                  {formatFixed(solarSummary.currentExport.exportPowerKw, 2)} kW
                </Badge>
              </Group>
              <Text fw={700} fz="sm" mt={8}>
                {solarSummary.currentExport.opportunity
                  ? t('power.exportOpportunityActive')
                  : t('power.exportOpportunityInactive', { threshold: solarSummary.currentExport.thresholdKw })}
              </Text>
            </Card>
          </SimpleGrid>
        )}
      </Card>
    </Stack>
  );

  return (
    <Stack p="lg" gap="md" style={{ width: '100%' }}>
      <Modal
        opened={selectedUsageAnomaly != null}
        onClose={() => setSelectedUsageAnomaly(null)}
        title={t('power.usageInsightsDetailTitle')}
        centered
      >
        {selectedUsageAnomaly && (
          <Stack gap="sm">
            <Group justify="space-between">
              <Text size="sm" c="dimmed">{t('power.usageInsightsDeviceLabel')}</Text>
              <Text fw={600}>{selectedUsageAnomaly.device?.name ?? `#${selectedUsageAnomaly.deviceId ?? '-'}`}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">{t('power.usageInsightsStartedLabel')}</Text>
              <Text>{new Date(selectedUsageAnomaly.startsAt).toLocaleString()}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">{t('power.usageInsightsEndedLabel')}</Text>
              <Text>{new Date(selectedUsageAnomaly.endsAt).toLocaleString()}</Text>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Card p="sm" withBorder>
                <Text size="xs" c="dimmed">{t('power.usageInsightsObservedLabel')}</Text>
                <Text fw={700}>{formatKwh(selectedUsageAnomaly.observedKwh)}</Text>
              </Card>
              <Card p="sm" withBorder>
                <Text size="xs" c="dimmed">{t('power.usageInsightsBaselineLabel')}</Text>
                <Text fw={700}>{formatKwh(selectedUsageAnomaly.baselineKwh)}</Text>
              </Card>
              <Card p="sm" withBorder>
                <Text size="xs" c="dimmed">{t('power.usageInsightsDeltaLabel')}</Text>
                <Text fw={700} c={selectedUsageAnomaly.deltaPct >= 0 ? 'red' : 'blue'}>
                  {formatDeltaPct(selectedUsageAnomaly.deltaPct)}
                </Text>
              </Card>
            </SimpleGrid>
            <Text size="sm">{selectedUsageAnomaly.explanation}</Text>
          </Stack>
        )}
      </Modal>

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
            onChange={handleDeviceChange}
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
            <Tabs defaultValue="overview" keepMounted={false}>
              <Tabs.List>
                <Tabs.Tab value="overview">
                  {t('power.tabOverview')}
                </Tabs.Tab>
                <Tabs.Tab value="usage-cost">
                  {t('power.tabUsageCost')}
                </Tabs.Tab>
                <Tabs.Tab value="power-quality">
                  {t('power.tabPowerQuality')}
                </Tabs.Tab>
                <Tabs.Tab value="grid-compliance">
                  {t('power.tabGridCompliance')}
                </Tabs.Tab>
                <Tabs.Tab value="solar">
                  {t('power.tabSolar')}
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="overview" pt="md">
                {overviewPanel}
              </Tabs.Panel>

              <Tabs.Panel value="usage-cost" pt="md">
                {usageCostPanel}
              </Tabs.Panel>

              <Tabs.Panel value="power-quality" pt="md">
                {powerQualityPanel}
              </Tabs.Panel>

              <Tabs.Panel value="grid-compliance" pt="md">
                {gridCompliancePanel}
              </Tabs.Panel>

              <Tabs.Panel value="solar" pt="md">
                {solarPanel}
              </Tabs.Panel>
            </Tabs>
          )}
        </>
      )}
    </Stack>
  );
}
