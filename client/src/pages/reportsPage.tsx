import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge, Button, Card, Group, Progress,
  RingProgress, SimpleGrid, Stack, Table, Switch,
  Text, Title, Select, Box, TextInput, Loader, Tabs,
} from '@mantine/core';
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePolling } from '../hooks/usePolling';
import { apiFetch, apiPost } from '../services/apiClient';
import { useI18n, type Language } from '../i18n/i18n';

/* ── API response types ─────────────────────────────────────────── */

interface ReportListItem {
  id: number;
  deviceId: number;
  deviceName: string;
  reportUse: 'home' | 'technical' | 'solar';
  periodType: string;
  startsAt: string;
  endsAt: string;
  healthScore: string;
  powerHealthScore: string;
  combinedHealthScore: string;
  totalWindows: number;
  compliancePctL1: number;
  compliancePctL2: number;
  compliancePctL3: number;
  overallCompliant: boolean;
  totalAnomalies: number;
  criticalCount: number;
  warningCount: number;
  createdAt: string;
}

interface AnomalySummaryRow {
  id?: number;
  type: string;
  phase: string;
  durationSeconds: number | null;
  minVoltage: number | null;
  maxVoltage: number | null;
  startsAt: string;
  endsAt: string | null;
  severity: string;
  metricDomain?: 'VOLTAGE' | 'POWER';
  metricName?: string | null;
}

interface ReportDetail {
  id: number;
  deviceId: number;
  deviceName: string;
  reportUse: 'home' | 'technical' | 'solar';
  periodType: string;
  startsAt: string;
  endsAt: string;
  healthScore: string;
  powerHealthScore: string;
  combinedHealthScore: string;
  compliance: {
    totalWindows: number;
    compliantWindowsL1: number;
    compliantWindowsL2: number;
    compliantWindowsL3: number;
    compliancePctL1: number;
    compliancePctL2: number;
    compliancePctL3: number;
    overallCompliant: boolean;
  };
  anomalySummary: AnomalySummaryRow[];
  powerQuality: {
    averageCompliancePct: number;
    worstPhase: 'L1' | 'L2' | 'L3';
    worstPhaseCompliancePct: number;
    pass: boolean;
    dominantAnomalyType: string | null;
    assessmentText: string;
    recommendationText: string;
  };
  insights: {
    totalEnergyConsumedKwh: number;
    totalEnergyReturnedKwh: number;
    averageEfficiencyPct: number | null;
    averageHourlyElectricityKwh: number | null;
    daily: {
      date: string;
      energyConsumedKwh: number;
      energyReturnedKwh: number;
      efficiencyPct: number | null;
      avgHourlyElectricityKwh: number;
      sampleCount: number;
      firstTimestamp: string;
      lastTimestamp: string;
      isPartialDay: boolean;
    }[];
    hourly: {
      timestamp: string;
      energyConsumedKwh: number;
      energyReturnedKwh: number;
      efficiencyPct: number | null;
      avgHourlyElectricityKwh: number;
    }[];
    anomalyTypeDistribution: { type: string; count: number }[];
    narrative: string;
    anomalyAppendix: { type: string; description: string }[];
  };
  totalAnomalies: number;
  criticalCount: number;
  warningCount: number;
  createdAt: string;
}

interface DeviceOption {
  id: number;
  name: string;
}

interface ReportListResponse {
  count: number;
  data: ReportListItem[];
}

interface DeviceListResponse {
  id: number;
  name: string;
}

interface AnomalyContextPoint {
  timestamp: string;
  voltage: number | null;
  voltageL1: number | null;
  voltageL2: number | null;
  voltageL3: number | null;
  powerKw: number | null;
}

interface AnomalyContextResponse {
  anomaly: {
    id: number;
    deviceId: number;
    metricDomain: 'VOLTAGE' | 'POWER';
    phase: string;
    type: string;
    startsAt: string;
    endsAt: string;
    minVoltage: number | null;
    maxVoltage: number | null;
  };
  context: {
    startsAt: string;
    endsAt: string;
    rawPointCount: number;
    returnedPointCount: number;
    downsampled: boolean;
  };
  points: AnomalyContextPoint[];
}

/* ── Helpers ────────────────────────────────────────────────────── */

function healthColor(score: string): string {
  switch (score) {
    case 'GREEN': return 'green';
    case 'YELLOW': return 'yellow';
    case 'RED': return 'red';
    default: return 'gray';
  }
}

function localeForLanguage(language: Language): string {
  return language === 'lt' ? 'lt-LT' : 'en-GB';
}

function tr(language: Language, en: string, lt: string): string {
  return language === 'lt' ? lt : en;
}

function formatDate(iso: string, language: Language): string {
  return new Date(iso).toLocaleString(localeForLanguage(language), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(seconds: number | null, language: Language): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (language === 'lt') {
    return sec > 0 ? `${min} min ${sec} s` : `${min} min`;
  }
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toChartDateLabel(date: string, language: Language): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(localeForLanguage(language), {
    month: 'short',
    day: 'numeric',
  });
}

function toChartTimeOnlyLabel(timestamp: string, language: Language): string {
  return new Date(timestamp).toLocaleString(localeForLanguage(language), {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toChartShortDateTimeLabel(timestamp: string, language: Language): string {
  return new Date(timestamp).toLocaleString(localeForLanguage(language), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function periodLabel(periodType: string, language: Language): string {
  const labels: Record<string, string> = {
    daily: tr(language, 'Daily', 'Dieninis'),
    weekly: tr(language, 'Weekly', 'Savaitinis'),
    biweekly: tr(language, 'Biweekly', 'Dvisavaitinis'),
    monthly: tr(language, 'Monthly', 'Mėnesinis'),
    custom: tr(language, 'Custom', 'Pasirinktinis'),
  };
  return labels[periodType] ?? periodType;
}

function reportUseLabel(
  reportUse: ReportDetail['reportUse'] | ReportListItem['reportUse'],
  language: Language,
): string {
  if (reportUse === 'home') return tr(language, 'Home', 'Namų');
  if (reportUse === 'technical') return tr(language, 'Technical', 'Techninė');
  return tr(language, 'Solar', 'Saulės');
}

function anomalyColor(type: string, index: number): string {
  const byType: Record<string, string> = {
    LONG_INTERRUPTION: '#c92a2a',
    SHORT_INTERRUPTION: '#e67700',
    OVER_VOLTAGE: '#d9480f',
    UNDER_VOLTAGE: '#1c7ed6',
    VOLTAGE_DEVIATION: '#5f3dc4',
  };

  if (byType[type]) return byType[type];

  const fallback = ['#2b8a3e', '#0b7285', '#495057', '#6741d9', '#a61e4d'];
  return fallback[index % fallback.length];
}

function severityColor(severity: string): string {
  return severity === 'CRITICAL' ? 'red' : 'yellow';
}

function phaseName(phase: string, language: Language): string {
  if (phase === 'L1' || phase === 'L2' || phase === 'L3') return phase;
  return tr(language, 'ALL', 'VISOS');
}

function anomalyTypeDescription(type: string, language: Language): string {
  const descriptions: Record<string, string> = {
    LONG_INTERRUPTION: tr(language,
      'Extended power interruption, typically indicating a significant supply disturbance that requires technical follow-up.',
      'Ilgesnis elektros tiekimo nutrūkimas, paprastai rodantis reikšmingą tiekimo sutrikimą, kuriam reikalingas techninis įvertinimas.',
    ),
    SHORT_INTERRUPTION: tr(language,
      'Short power interruption, commonly associated with switching operations or short transient disturbances.',
      'Trumpas elektros tiekimo nutrūkimas, dažniausiai susijęs su perjungimais arba trumpalaikiais trikdžiais.',
    ),
    OVER_VOLTAGE: tr(language,
      'Voltage exceeded permitted limits; prolonged exposure may increase equipment stress and reduce component lifetime.',
      'Įtampa viršijo leistinas ribas; ilgesnis poveikis gali didinti įrangos apkrovą ir trumpinti komponentų tarnavimo laiką.',
    ),
    UNDER_VOLTAGE: tr(language,
      'Voltage dropped below permitted limits; this can result in unstable operation of connected electrical loads.',
      'Įtampa nukrito žemiau leistinų ribų; tai gali lemti nestabilų prijungtų apkrovų darbą.',
    ),
    VOLTAGE_DEVIATION: tr(language,
      'Voltage deviated from nominal operating range; trend monitoring is recommended to assess recurrence and duration.',
      'Įtampa nukrypo nuo nominalaus darbo diapazono; rekomenduojama stebėti tendencijas, kad būtų įvertintas pasikartojimas ir trukmė.',
    ),
  };

  return descriptions[type] ?? tr(
    language,
    'An anomaly type was detected, but a formal description is not available yet.',
    'Aptiktas anomalijos tipas, tačiau formalus aprašymas kol kas nepateiktas.',
  );
}

function anomalyTypeLabel(type: string, language: Language): string {
  const labels: Record<string, string> = {
    LONG_INTERRUPTION: tr(language, 'Long interruption', 'Ilgas nutrūkimas'),
    SHORT_INTERRUPTION: tr(language, 'Short interruption', 'Trumpas nutrūkimas'),
    OVER_VOLTAGE: tr(language, 'Over-voltage', 'Viršįtampis'),
    UNDER_VOLTAGE: tr(language, 'Under-voltage', 'Žema įtampa'),
    VOLTAGE_DEVIATION: tr(language, 'Voltage deviation', 'Įtampos nuokrypis'),
  };
  return labels[type] ?? type;
}

function anomalyDomainLabel(metricDomain: 'VOLTAGE' | 'POWER' | undefined): string {
  return metricDomain === 'POWER' ? 'Power' : 'Voltage';
}

/* ── Print-friendly report view ─────────────────────────────────── */

function ReportPrintView({ report }: { report: ReportDetail }) {
  const { language } = useI18n();
  const printRef = useRef<HTMLDivElement>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [openedAnomalyKey, setOpenedAnomalyKey] = useState<string | null>(null);
  const [loadingAnomalyId, setLoadingAnomalyId] = useState<number | null>(null);
  const [contextByAnomalyId, setContextByAnomalyId] =
    useState<Record<number, AnomalyContextResponse>>({});
  const [contextErrorByAnomalyId, setContextErrorByAnomalyId] = useState<Record<number, string>>({});

  const isHomeReport = report.reportUse === 'home';
  const isTechnicalReport = report.reportUse === 'technical';
  const isSolarReport = report.reportUse === 'solar';

  const avgPct = +(
    (report.compliance.compliancePctL1 +
      report.compliance.compliancePctL2 +
      report.compliance.compliancePctL3) /
    3
  ).toFixed(1);

  const phaseCompliance = [
    { phase: 'L1' as const, pct: report.compliance.compliancePctL1 },
    { phase: 'L2' as const, pct: report.compliance.compliancePctL2 },
    { phase: 'L3' as const, pct: report.compliance.compliancePctL3 },
  ];
  const worstPhase = phaseCompliance.reduce((acc, cur) => (cur.pct < acc.pct ? cur : acc));

  const baseQuality = report.powerQuality;
  const qualityPass = baseQuality?.pass ?? report.compliance.overallCompliant;
  const qualityWorstPhase = baseQuality?.worstPhase ?? worstPhase.phase;
  const qualityWorstPhasePct = baseQuality?.worstPhaseCompliancePct ?? worstPhase.pct;
  const qualityDominantType = baseQuality?.dominantAnomalyType ?? null;

  const quality = {
    averageCompliancePct: baseQuality?.averageCompliancePct ?? avgPct,
    worstPhase: qualityWorstPhase,
    worstPhaseCompliancePct: qualityWorstPhasePct,
    pass: qualityPass,
    dominantAnomalyType: qualityDominantType,
    assessmentText: qualityPass
      ? tr(
        language,
        `Power quality is compliant with the EN 50160 target (>=95% in-range 10-minute windows). Worst observed phase was ${qualityWorstPhase} at ${qualityWorstPhasePct.toFixed(2)}%.`,
        `Galios kokybė atitinka EN 50160 tikslą (>=95% į ribas patenkančių 10 min. langų). Blogiausia stebėta fazė buvo ${qualityWorstPhase} su ${qualityWorstPhasePct.toFixed(2)}%.`,
      )
      : tr(
        language,
        `Power quality does not comply with the EN 50160 target. Worst observed phase was ${qualityWorstPhase} at ${qualityWorstPhasePct.toFixed(2)}%, below the 95% threshold.`,
        `Galios kokybė neatitinka EN 50160 tikslo. Blogiausia stebėta fazė buvo ${qualityWorstPhase} su ${qualityWorstPhasePct.toFixed(2)}% — žemiau 95% ribos.`,
      ),
    recommendationText: qualityDominantType
      ? tr(
        language,
        `Primary anomaly driver in this interval: ${anomalyTypeLabel(qualityDominantType, language)}. Review phase-level events and recurrence timing.`,
        `Pagrindinis anomalijų šaltinis šiame intervale: ${anomalyTypeLabel(qualityDominantType, language)}. Peržiūrėkite fazių lygio įvykius ir pasikartojimo laiką.`,
      )
      : tr(
        language,
        'No dominant anomaly type detected in this interval.',
        'Šiame intervale dominuojančio anomalijos tipo nenustatyta.',
      ),
  };

  const baseInsights = report.insights;
  const maxConsumptionDay = baseInsights?.daily?.length
    ? baseInsights.daily.reduce((acc, cur) => (cur.energyConsumedKwh > acc.energyConsumedKwh ? cur : acc))
    : null;
  const topAnomaly = baseInsights?.anomalyTypeDistribution?.length
    ? baseInsights.anomalyTypeDistribution.reduce((acc, cur) => (cur.count > acc.count ? cur : acc))
    : null;

  const narrativeParts: string[] = [
    tr(
      language,
      `During the selected period, total imported electricity was ${(baseInsights?.totalEnergyConsumedKwh ?? 0).toFixed(2)} kWh.`,
      `Per pasirinktą laikotarpį bendra importuota elektros energija buvo ${(baseInsights?.totalEnergyConsumedKwh ?? 0).toFixed(2)} kWh.`,
    ),
  ];

  if (baseInsights?.averageEfficiencyPct != null) {
    narrativeParts.push(
      tr(
        language,
        `The average self-consumption efficiency ratio (imported / (imported + returned)) was ${baseInsights.averageEfficiencyPct.toFixed(1)}%.`,
        `Vidutinis savosios vartosenos efektyvumo santykis (importuota / (importuota + grąžinta)) buvo ${baseInsights.averageEfficiencyPct.toFixed(1)}%.`,
      ),
    );
  } else {
    narrativeParts.push(
      tr(
        language,
        'The efficiency ratio could not be computed due to insufficient returned-energy signal in the selected range.',
        'Efektyvumo santykio apskaičiuoti nepavyko dėl nepakankamo grąžintos energijos signalo pasirinktame intervale.',
      ),
    );
  }

  if (maxConsumptionDay) {
    narrativeParts.push(
      tr(
        language,
        `Peak daily import occurred on ${maxConsumptionDay.date} with ${maxConsumptionDay.energyConsumedKwh.toFixed(2)} kWh.`,
        `Didžiausias dienos importas užfiksuotas ${maxConsumptionDay.date} — ${maxConsumptionDay.energyConsumedKwh.toFixed(2)} kWh.`,
      ),
    );
  }

  if (topAnomaly) {
    narrativeParts.push(
      tr(
        language,
        `The most frequently observed anomaly category was ${anomalyTypeLabel(topAnomaly.type, language)} (${topAnomaly.count} occurrences).`,
        `Dažniausiai stebėta anomalijų kategorija buvo ${anomalyTypeLabel(topAnomaly.type, language)} (${topAnomaly.count} atvejai).`,
      ),
    );
  } else {
    narrativeParts.push(
      tr(
        language,
        'No transmission anomalies were detected within the selected reporting interval.',
        'Pasirinktame ataskaitos intervale perdavimo anomalijų neaptikta.',
      ),
    );
  }

  const insights = {
    totalEnergyConsumedKwh: baseInsights?.totalEnergyConsumedKwh ?? 0,
    totalEnergyReturnedKwh: baseInsights?.totalEnergyReturnedKwh ?? 0,
    averageEfficiencyPct: baseInsights?.averageEfficiencyPct ?? null,
    averageHourlyElectricityKwh: baseInsights?.averageHourlyElectricityKwh ?? null,
    daily: baseInsights?.daily ?? [],
    hourly: baseInsights?.hourly ?? [],
    anomalyTypeDistribution: baseInsights?.anomalyTypeDistribution ?? [],
    narrative: narrativeParts.join(' '),
    anomalyAppendix: (baseInsights?.anomalyAppendix ?? []).map((item) => ({
      ...item,
      description: anomalyTypeDescription(item.type, language),
    })),
  };

  useEffect(() => {
    setOpenedAnomalyKey(null);
    setLoadingAnomalyId(null);
    setContextByAnomalyId({});
    setContextErrorByAnomalyId({});
    setShowAdvanced(false);
  }, [report.id]);

  const loadAnomalyContext = useCallback(async (itemIndex: number) => {
    const anomaly = report.anomalySummary[itemIndex];
    if (!anomaly || anomaly.id == null) return;
    if (contextByAnomalyId[anomaly.id]) return;

    setLoadingAnomalyId(anomaly.id);
    setContextErrorByAnomalyId((prev) => {
      const next = { ...prev };
      delete next[anomaly.id!];
      return next;
    });

    try {
      const response = await apiFetch<AnomalyContextResponse>(`/api/anomalies/${anomaly.id}/context`);
      setContextByAnomalyId((prev) => ({
        ...prev,
        [anomaly.id!]: response,
      }));
    } catch {
      setContextErrorByAnomalyId((prev) => ({
        ...prev,
        [anomaly.id!]: tr(language, 'Could not load anomaly context. Please try again.', 'Nepavyko įkelti anomalijos konteksto. Bandykite dar kartą.'),
      }));
    } finally {
      setLoadingAnomalyId(null);
    }
  }, [contextByAnomalyId, language, report.anomalySummary]);

  const handleAnomalyAccordionChange = useCallback((value: string | null) => {
    setOpenedAnomalyKey(value);
    if (value == null) return;

    const parsedIndex = Number(value);
    if (Number.isNaN(parsedIndex)) return;
    void loadAnomalyContext(parsedIndex);
  }, [loadAnomalyContext]);

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${reportUseLabel(report.reportUse, language)} ${tr(language, 'Report', 'Ataskaita')} - ${report.deviceName}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', system-ui, sans-serif; padding: 40px; color: #222; line-height: 1.5; }
          h1 { font-size: 22px; margin-bottom: 4px; }
          h2 { font-size: 16px; margin: 20px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
          .subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }
          .health-badge { display: inline-block; padding: 4px 16px; border-radius: 12px; font-weight: 700; font-size: 14px; }
          .health-GREEN { background: #d4edda; color: #155724; }
          .health-YELLOW { background: #fff3cd; color: #856404; }
          .health-RED { background: #f8d7da; color: #721c24; }
          .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0; }
          .stat-box { text-align: center; padding: 12px; border: 1px solid #e0e0e0; border-radius: 8px; }
          .stat-value { font-size: 24px; font-weight: 700; }
          .stat-label { font-size: 11px; color: #666; }
          table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; }
          th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
          th { background: #f5f5f5; font-weight: 600; }
          .footer { margin-top: 30px; font-size: 11px; color: #999; border-top: 1px solid #ddd; padding-top: 8px; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <h1>${reportUseLabel(report.reportUse, language)} ${tr(language, 'Report', 'Ataskaita')}</h1>
        <p class="subtitle">
          ${tr(language, 'Device', 'Įrenginys')}: ${report.deviceName} &middot;
          ${tr(language, 'Period', 'Laikotarpis')}: ${formatDate(report.startsAt, language)} – ${formatDate(report.endsAt, language)} &middot;
          ${tr(language, 'Type', 'Tipas')}: ${periodLabel(report.periodType, language)}
        </p>

        <span class="health-badge health-${report.combinedHealthScore}">${tr(language, 'Overall Health', 'Bendra būklė')}: ${report.combinedHealthScore}</span>
        <p style="margin-top: 8px; font-size: 13px; color: #666;">
          Voltage: ${report.healthScore} &middot; Power: ${report.powerHealthScore}
        </p>

        ${!isSolarReport ? `
          <h2>${tr(language, 'Compliance Summary', 'Atitikties santrauka')}</h2>
          <div class="stats-grid">
            <div class="stat-box">
              <div class="stat-value">${avgPct}%</div>
              <div class="stat-label">${tr(language, 'Average Voltage Compliance', 'Vidutinis įtampos atitikimas')}</div>
            </div>
            <div class="stat-box">
              <div class="stat-value">${report.compliance.totalWindows}</div>
              <div class="stat-label">${tr(language, 'Total 10-min Windows', 'Iš viso 10 min. langų')}</div>
            </div>
            <div class="stat-box">
              <div class="stat-value">${report.totalAnomalies}</div>
              <div class="stat-label">${tr(language, 'Anomalies Detected', 'Aptiktos anomalijos')}</div>
            </div>
          </div>

          <table>
            <thead><tr><th>${tr(language, 'Phase', 'Fazė')}</th><th>${tr(language, 'Compliant Windows', 'Atitinkantys langai')}</th><th>${tr(language, 'Compliance %', 'Atitikimas %')}</th><th>${tr(language, 'Status', 'Būsena')}</th></tr></thead>
            <tbody>
              <tr>
                <td>L1</td>
                <td>${report.compliance.compliantWindowsL1} / ${report.compliance.totalWindows}</td>
                <td>${report.compliance.compliancePctL1}%</td>
                <td>${report.compliance.compliancePctL1 >= 95 ? `✓ ${tr(language, 'PASS', 'ATITINKA')}` : `✗ ${tr(language, 'FAIL', 'NEATITINKA')}`}</td>
              </tr>
              <tr>
                <td>L2</td>
                <td>${report.compliance.compliantWindowsL2} / ${report.compliance.totalWindows}</td>
                <td>${report.compliance.compliancePctL2}%</td>
                <td>${report.compliance.compliancePctL2 >= 95 ? `✓ ${tr(language, 'PASS', 'ATITINKA')}` : `✗ ${tr(language, 'FAIL', 'NEATITINKA')}`}</td>
              </tr>
              <tr>
                <td>L3</td>
                <td>${report.compliance.compliantWindowsL3} / ${report.compliance.totalWindows}</td>
                <td>${report.compliance.compliancePctL3}%</td>
                <td>${report.compliance.compliancePctL3 >= 95 ? `✓ ${tr(language, 'PASS', 'ATITINKA')}` : `✗ ${tr(language, 'FAIL', 'NEATITINKA')}`}</td>
              </tr>
            </tbody>
          </table>

          <h2>${tr(language, 'Power Quality Assessment', 'Galios kokybės įvertinimas')}</h2>
          <p>${quality.assessmentText}</p>
          <table>
            <thead><tr><th>${tr(language, 'Metric', 'Metrika')}</th><th>${tr(language, 'Value', 'Reikšmė')}</th></tr></thead>
            <tbody>
              <tr><td>EN 50160 ${tr(language, 'status', 'būsena')}</td><td>${quality.pass ? tr(language, 'Compliant', 'Atitinka') : tr(language, 'Non-compliant', 'Neatitinka')}</td></tr>
              <tr><td>${tr(language, 'Average compliance', 'Vidutinis atitikimas')}</td><td>${quality.averageCompliancePct.toFixed(2)}%</td></tr>
              <tr><td>${tr(language, 'Worst phase', 'Blogiausia fazė')}</td><td>${quality.worstPhase}</td></tr>
              <tr><td>${tr(language, 'Worst-phase compliance', 'Blogiausios fazės atitikimas')}</td><td>${quality.worstPhaseCompliancePct.toFixed(2)}%</td></tr>
              <tr><td>${tr(language, 'Dominant anomaly type', 'Dominuojantis anomalijos tipas')}</td><td>${quality.dominantAnomalyType ? anomalyTypeLabel(quality.dominantAnomalyType, language) : tr(language, 'None', 'Nėra')}</td></tr>
            </tbody>
          </table>
          <p>${quality.recommendationText}</p>
        ` : ''}

        <h2>${isSolarReport ? tr(language, 'Solar Energy Insights', 'Saulės energijos įžvalgos') : tr(language, 'Energy Insights', 'Energijos įžvalgos')}</h2>
        <p>${insights.narrative}</p>
        <table>
          <thead><tr><th>${tr(language, 'Date', 'Data')}</th><th>${tr(language, 'Energy consumed (kWh)', 'Suvartota energija (kWh)')}</th><th>${tr(language, 'Energy returned (kWh)', 'Grąžinta energija (kWh)')}</th><th>${tr(language, 'Efficiency (%)', 'Efektyvumas (%)')}</th><th>${tr(language, 'Avg hourly electricity (kWh)', 'Vid. valandinė elektra (kWh)')}</th></tr></thead>
          <tbody>
            ${insights.daily.map(d => `
              <tr>
                <td>${d.date}</td>
                <td>${d.energyConsumedKwh.toFixed(2)}</td>
                <td>${d.energyReturnedKwh.toFixed(2)}</td>
                <td>${d.efficiencyPct != null ? d.efficiencyPct.toFixed(1) : '—'}</td>
                <td>${d.avgHourlyElectricityKwh.toFixed(3)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        ${report.anomalySummary.length > 0 ? `
          <h2>${tr(language, 'Anomaly details', 'Anomalijų detalės')} (${report.anomalySummary.length})</h2>
          <table>
            <thead><tr><th>${tr(language, 'Type', 'Tipas')}</th><th>${tr(language, 'Phase', 'Fazė')}</th><th>${tr(language, 'Severity', 'Sunkumas')}</th><th>${tr(language, 'Duration', 'Trukmė')}</th><th>${tr(language, 'Min V', 'Min V')}</th><th>${tr(language, 'Max V', 'Max V')}</th><th>${tr(language, 'Started', 'Pradžia')}</th></tr></thead>
            <tbody>
              ${report.anomalySummary.map(a => `
                <tr>
                  <td>${anomalyTypeLabel(a.type, language)}</td>
                  <td>${a.phase}</td>
                  <td>${a.severity}</td>
                  <td>${formatDuration(a.durationSeconds, language)}</td>
                  <td>${a.minVoltage != null ? a.minVoltage.toFixed(1) + ' V' : '—'}</td>
                  <td>${a.maxVoltage != null ? a.maxVoltage.toFixed(1) + ' V' : '—'}</td>
                  <td>${formatDate(a.startsAt, language)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `<h2>${tr(language, 'Anomalies', 'Anomalijos')}</h2><p>${tr(language, 'No anomalies detected during this period.', 'Per šį laikotarpį anomalijų neaptikta.')}</p>`}

        ${isTechnicalReport && insights.anomalyAppendix.length > 0 ? `
          <h2>${tr(language, 'Transmission Error Appendix', 'Perdavimo klaidų priedas')}</h2>
          <table>
            <thead><tr><th>${tr(language, 'Type', 'Tipas')}</th><th>${tr(language, 'Description', 'Aprašymas')}</th></tr></thead>
            <tbody>
              ${insights.anomalyAppendix.map(a => `
                <tr>
                  <td>${anomalyTypeLabel(a.type, language)}</td>
                  <td>${a.description}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}

        <div class="footer">
          ${tr(language, 'Generated', 'Sugeneruota')}: ${new Date().toLocaleString(localeForLanguage(language))} &middot;
          ${tr(language, 'Standard', 'Standartas')}: LST EN 50160 — ≥95% ${tr(language, 'of 10-min RMS windows within 230V ±10V', '10 min RMS langų turi būti 230V ±10V ribose')}
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <Stack gap="md" ref={printRef}>
      {(() => {
        const fullDays = insights.daily.filter((d) => !d.isPartialDay);
        const chartDays = fullDays.length >= 2 ? fullDays : insights.daily;
        const rangeHours = Math.max(
          0,
          (new Date(report.endsAt).getTime() - new Date(report.startsAt).getTime()) / 3600_000,
        );
        const useHourlyCharts = report.periodType === 'daily'
          || (report.periodType === 'custom' && rangeHours <= 72);
        const shouldShowCharts = useHourlyCharts
          ? insights.hourly.length >= 2
          : chartDays.length >= 2;

        const trendChartData = useHourlyCharts
          ? insights.hourly.map((d) => ({
              x: report.periodType === 'daily'
                ? toChartTimeOnlyLabel(d.timestamp, language)
                : toChartShortDateTimeLabel(d.timestamp, language),
              value: d.energyConsumedKwh,
              returned: d.energyReturnedKwh,
              efficiency: d.efficiencyPct,
              hourly: d.avgHourlyElectricityKwh,
            }))
          : chartDays.map((d) => ({
              x: toChartDateLabel(d.date, language),
              value: d.energyConsumedKwh,
              returned: d.energyReturnedKwh,
              efficiency: d.efficiencyPct,
              hourly: d.avgHourlyElectricityKwh,
            }));

        return (
          <>
            <Card p="lg" radius="md" withBorder>
              <Group justify="space-between" align="flex-start" wrap="wrap" gap="lg">
                <Stack gap={10} style={{ flex: '1 1 420px', minWidth: 280 }}>
                  <div>
                    <Title order={2}>
                      {reportUseLabel(report.reportUse, language)} {tr(language, 'Report', 'Ataskaita')} ({periodLabel(report.periodType, language)})
                    </Title>
                    <Text c="dimmed" size="sm" mt={4}>
                      {report.deviceName} &middot; {formatDate(report.startsAt, language)} – {formatDate(report.endsAt, language)}
                    </Text>
                  </div>

                  <Group gap="xs" wrap="wrap">
                    <Badge size="lg" variant="dot">{reportUseLabel(report.reportUse)}</Badge>
                    <Badge size="lg" variant="dot">{periodLabel(report.periodType)}</Badge>
                    <Badge size="lg" variant="dot">{report.totalAnomalies} anomalies</Badge>
                  </Group>
                </Stack>

                <Stack
                  gap="sm"
                  align="flex-end"
                  style={{ flex: '0 1 420px', minWidth: 280, marginLeft: 'auto' }}
                >
                  <Group gap="xs" wrap="wrap" justify="flex-end">
                    <Badge
                      size="xl"
                      color={healthColor(report.combinedHealthScore)}
                      variant="light"
                    >
                      Overall {report.combinedHealthScore}
                    </Badge>
                    <Badge color={healthColor(report.healthScore)} variant="light" size="md">
                      Voltage {report.healthScore}
                    </Badge>
                    <Badge color={healthColor(report.powerHealthScore)} variant="light" size="md">
                      Power {report.powerHealthScore}
                    </Badge>
                  </Group>

                  <Group gap="sm" wrap="wrap" justify="flex-end">
                    {isTechnicalReport && (
                      <Switch
                        label={tr(language, 'Advanced details', 'Išplėstinė informacija')}
                        checked={showAdvanced}
                        onChange={(event) => setShowAdvanced(event.currentTarget.checked)}
                      />
                    )}
                    <Button variant="light" onClick={handlePrint}>
                      {tr(language, 'Print / PDF', 'Spausdinti / PDF')}
                    </Button>
                  </Group>
                </Stack>
              </Group>
            </Card>

            {!isSolarReport && (
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                <Card p="md" radius="md" withBorder>
                  <Stack justify="space-between" style={{ height: '100%' }}>
                    <div>
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Overall status</Text>
                      <Text mt={8} fz={34} fw={800} c={healthColor(report.combinedHealthScore)}>
                        {report.combinedHealthScore}
                      </Text>
                    </div>
                    <Group gap={6} wrap="wrap">
                      <Badge color={healthColor(report.healthScore)} variant="light" size="sm">
                        Voltage {report.healthScore}
                      </Badge>
                      <Badge color={healthColor(report.powerHealthScore)} variant="light" size="sm">
                        Power {report.powerHealthScore}
                      </Badge>
                    </Group>
                  </Stack>
                </Card>
                <Card p="md" radius="md" withBorder>
                  <Stack align="center" gap="xs">
                    <RingProgress
                      size={100}
                      thickness={10}
                      roundCaps
                      sections={[{
                        value: avgPct,
                        color: avgPct >= 95 ? 'green' : avgPct >= 90 ? 'yellow' : 'red',
                      }]}
                      label={
                        <Text ta="center" fw={700} fz="lg">{avgPct}%</Text>
                      }
                    />
                    <Text size="xs" c="dimmed">{tr(language, 'Average Voltage Compliance', 'Vidutinis įtampos atitikimas')}</Text>
                  </Stack>
                </Card>
                <Card p="md" radius="md" withBorder>
                  <Stack align="center" justify="center" style={{ height: '100%' }}>
                    <Text fz={36} fw={700}>{report.compliance.totalWindows}</Text>
                    <Text size="xs" c="dimmed">{tr(language, 'Total 10-min Windows', 'Iš viso 10 min. langų')}</Text>
                  </Stack>
                </Card>
                <Card p="md" radius="md" withBorder>
                  <Stack align="center" justify="center" style={{ height: '100%' }}>
                    <Text fz={36} fw={700} c={report.totalAnomalies > 0 ? 'red' : undefined}>
                      {report.totalAnomalies}
                    </Text>
                    <Text size="xs" c="dimmed">{tr(language, 'Anomalies Detected', 'Aptiktos anomalijos')}</Text>
                    {report.criticalCount > 0 && (
                      <Badge color="red" size="sm">{report.criticalCount} {tr(language, 'CRITICAL', 'KRITINĖS')}</Badge>
                    )}
                  </Stack>
                </Card>
              </SimpleGrid>
            )}

            {!isSolarReport && (
              <Card p="md" radius="md" withBorder>
                <Stack gap="sm">
                  <Group justify="space-between" align="flex-start" wrap="wrap">
                    <div>
                      <Text fw={700}>{tr(language, 'Power Quality Snapshot', 'Galios kokybės apžvalga')}</Text>
                      <Text size="sm" c="dimmed" mt={4}>
                        {isTechnicalReport
                          ? tr(language, 'Detailed quality metrics, energy trends, and appendices are available in Advanced details.', 'Išsamios kokybės metrikos, energijos tendencijos ir priedai pateikiami skiltyje „Išplėstinė informacija“.')
                          : tr(language, 'This summary highlights the overall supply quality during the report period.', 'Ši santrauka parodo bendrą tiekimo kokybę ataskaitos laikotarpiu.')}
                      </Text>
                    </div>
                    <Badge color={quality.pass ? 'green' : 'red'} variant="light">
                      {quality.pass ? tr(language, 'COMPLIANT', 'ATITINKA') : tr(language, 'NON-COMPLIANT', 'NEATITINKA')}
                    </Badge>
                  </Group>
                  <Text size="sm">{quality.assessmentText}</Text>
                </Stack>
              </Card>
            )}

            {isTechnicalReport && showAdvanced && (
              <>
                <Card p="md" radius="md" withBorder>
                  <Text fw={700} mb="md">{tr(language, 'Per-Phase Compliance', 'Atitikimas pagal fazes')}</Text>
                  <Table.ScrollContainer minWidth={500}>
                    <Table>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{tr(language, 'Phase', 'Fazė')}</Table.Th>
                          <Table.Th>{tr(language, 'Compliant Windows', 'Atitinkantys langai')}</Table.Th>
                          <Table.Th>{tr(language, 'Compliance', 'Atitikimas')}</Table.Th>
                          <Table.Th>{tr(language, 'Status', 'Būsena')}</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {(['L1', 'L2', 'L3'] as const).map((phase) => {
                          const pct =
                            phase === 'L1'
                              ? report.compliance.compliancePctL1
                              : phase === 'L2'
                                ? report.compliance.compliancePctL2
                                : report.compliance.compliancePctL3;
                          const compliant =
                            phase === 'L1'
                              ? report.compliance.compliantWindowsL1
                              : phase === 'L2'
                                ? report.compliance.compliantWindowsL2
                                : report.compliance.compliantWindowsL3;

                          return (
                            <Table.Tr key={phase}>
                              <Table.Td><Badge variant="light">{phase}</Badge></Table.Td>
                              <Table.Td>{compliant} / {report.compliance.totalWindows}</Table.Td>
                              <Table.Td>
                                <Group gap="xs">
                                  <Progress
                                    value={pct}
                                    color={pct >= 95 ? 'green' : pct >= 90 ? 'yellow' : 'red'}
                                    size="sm"
                                    radius="xl"
                                    style={{ flex: 1 }}
                                  />
                                  <Text size="sm" fw={600} style={{ minWidth: 48 }}>{pct}%</Text>
                                </Group>
                              </Table.Td>
                              <Table.Td>
                                <Badge color={pct >= 95 ? 'green' : 'red'} variant="light">
                                  {pct >= 95 ? tr(language, 'PASS', 'ATITINKA') : tr(language, 'FAIL', 'NEATITINKA')}
                                </Badge>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Card>

                <Card p="md" radius="md" withBorder>
                  <Group justify="space-between" mb="xs">
                    <Text fw={700}>{tr(language, 'Power Quality Assessment', 'Galios kokybės įvertinimas')}</Text>
                    <Badge color={quality.pass ? 'green' : 'red'} variant="light">
                      {quality.pass ? tr(language, 'COMPLIANT', 'ATITINKA') : tr(language, 'NON-COMPLIANT', 'NEATITINKA')}
                    </Badge>
                  </Group>

                  <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} mb="md">
                    <Card p="sm" withBorder>
                      <Text size="xs" c="dimmed">{tr(language, 'Average voltage compliance', 'Vidutinis įtampos atitikimas')}</Text>
                      <Text fw={700} fz="lg">{quality.averageCompliancePct.toFixed(2)}%</Text>
                    </Card>
                    <Card p="sm" withBorder>
                      <Text size="xs" c="dimmed">{tr(language, 'Worst phase', 'Blogiausia fazė')}</Text>
                      <Text fw={700} fz="lg">{quality.worstPhase}</Text>
                    </Card>
                    <Card p="sm" withBorder>
                      <Text size="xs" c="dimmed">{tr(language, 'Worst-phase compliance', 'Blogiausios fazės atitikimas')}</Text>
                      <Text fw={700} fz="lg">{quality.worstPhaseCompliancePct.toFixed(2)}%</Text>
                    </Card>
                    <Card p="sm" withBorder>
                      <Text size="xs" c="dimmed">{tr(language, 'Overall health', 'Bendra būklė')}</Text>
                      <Badge color={healthColor(report.combinedHealthScore)} variant="light" mt={6}>
                        {report.combinedHealthScore}
                      </Badge>
                    </Card>
                    <Card p="sm" withBorder>
                      <Text size="xs" c="dimmed">{tr(language, 'Dominant anomaly', 'Dominuojanti anomalija')}</Text>
                      <Text fw={700} fz="lg">{quality.dominantAnomalyType ? anomalyTypeLabel(quality.dominantAnomalyType, language) : tr(language, 'None', 'Nėra')}</Text>
                    </Card>
                  </SimpleGrid>

                  <Text size="sm" mb={4}>{quality.assessmentText}</Text>
                  <Text size="sm" c="dimmed">{quality.recommendationText}</Text>
                </Card>
              </>
            )}

            <Card p="md" radius="md" withBorder>
              <Stack gap="sm">
                <div>
                  <Text fw={700}>
                    {isSolarReport
                      ? tr(language, 'Solar energy summary', 'Saulės energijos santrauka')
                      : tr(language, 'Report summary', 'Ataskaitos santrauka')}
                  </Text>
                  <Text size="sm" c="dimmed" mt={4}>{insights.narrative}</Text>
                </div>

                <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                  <Card p="sm" withBorder>
                    <Text size="xs" c="dimmed">{isSolarReport ? tr(language, 'Total imported', 'Iš viso importuota') : tr(language, 'Total consumed', 'Iš viso suvartota')}</Text>
                    <Text fw={700} fz="xl">{insights.totalEnergyConsumedKwh.toFixed(2)} kWh</Text>
                  </Card>
                  <Card p="sm" withBorder>
                    <Text size="xs" c="dimmed">{isSolarReport ? tr(language, 'Total exported', 'Iš viso eksportuota') : tr(language, 'Total returned', 'Iš viso grąžinta')}</Text>
                    <Text fw={700} fz="xl">{insights.totalEnergyReturnedKwh.toFixed(2)} kWh</Text>
                  </Card>
                  <Card p="sm" withBorder>
                    <Text size="xs" c="dimmed">{tr(language, 'Avg efficiency', 'Vid. efektyvumas')}</Text>
                    <Text fw={700} fz="xl">
                      {insights.averageEfficiencyPct != null
                        ? `${insights.averageEfficiencyPct.toFixed(1)}%`
                        : '—'}
                    </Text>
                  </Card>
                  <Card p="sm" withBorder>
                    <Text size="xs" c="dimmed">{tr(language, 'Avg hourly electricity', 'Vid. valandinė elektra')}</Text>
                    <Text fw={700} fz="xl">
                      {insights.averageHourlyElectricityKwh != null
                        ? `${insights.averageHourlyElectricityKwh.toFixed(3)} kWh`
                        : '—'}
                    </Text>
                  </Card>
                </SimpleGrid>
              </Stack>
            </Card>

            {shouldShowCharts && (
              isHomeReport ? (
                <Card p="md" radius="md" withBorder>
                  <Text fw={700} mb="md">
                      {useHourlyCharts
                        ? tr(language, 'Hourly electricity consumption', 'Valandinis elektros suvartojimas')
                        : tr(language, 'Daily electricity consumption', 'Dieninis elektros suvartojimas')}
                  </Text>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={trendChartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="x" />
                      <YAxis unit=" kWh" />
                      <Tooltip cursor={{ fill: 'rgba(255, 255, 255, 0.1)' }} />
                      <Bar
                        dataKey="value"
                        fill="#8ACDEA"
                          name={tr(language, 'Consumed', 'Suvartota')}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              ) : (
                <SimpleGrid cols={{ base: 1, lg: 2 }}>
                  <Card p="md" radius="md" withBorder>
                    <Text fw={700} mb="md">
                      {isSolarReport
                        ? (useHourlyCharts
                          ? tr(language, 'Hourly exported energy', 'Valandinė eksportuota energija')
                          : tr(language, 'Daily exported energy', 'Dieninė eksportuota energija'))
                        : (useHourlyCharts
                          ? tr(language, 'Hourly electricity consumption', 'Valandinis elektros suvartojimas')
                          : tr(language, 'Daily electricity consumption', 'Dieninis elektros suvartojimas'))}
                    </Text>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={trendChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="x" />
                        <YAxis unit=" kWh" />
                        <Tooltip cursor={{ fill: 'rgba(255, 255, 255, 0.1)' }} />
                        <Bar
                          dataKey={isSolarReport ? 'returned' : 'value'}
                          fill="#8ACDEA"
                          name={isSolarReport
                            ? tr(language, 'Returned', 'Grąžinta')
                            : tr(language, 'Consumed', 'Suvartota')}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>

                  <Card p="md" radius="md" withBorder>
                    <Text fw={700} mb="md">
                      {isSolarReport
                        ? (useHourlyCharts
                          ? tr(language, 'Hourly import/export trend', 'Valandinė importo/eksporto tendencija')
                          : tr(language, 'Import and export comparison', 'Importo ir eksporto palyginimas'))
                        : (useHourlyCharts
                          ? tr(language, 'Hourly efficiency trend', 'Valandinė efektyvumo tendencija')
                          : tr(language, 'Efficiency and avg hourly use', 'Efektyvumas ir vid. valandinis naudojimas'))}
                    </Text>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={trendChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="x" />
                        {isSolarReport ? (
                          <>
                            <YAxis yAxisId="left" unit=" kWh" />
                            <Tooltip cursor={{ fill: 'rgba(255, 255, 255, 0.1)' }} />
                            <Legend />
                            <Bar
                              yAxisId="left"
                              dataKey="value"
                              fill="#FFCC59"
                              name={tr(language, 'Consumed', 'Suvartota')}
                              radius={[4, 4, 0, 0]}
                            />
                            <Bar
                              yAxisId="left"
                              dataKey="returned"
                              fill="#8ACDEA"
                              name={tr(language, 'Returned', 'Grąžinta')}
                              radius={[4, 4, 0, 0]}
                            />
                          </>
                        ) : (
                          <>
                            <YAxis yAxisId="left" unit=" %" />
                            {!useHourlyCharts && <YAxis yAxisId="right" orientation="right" unit=" kWh" />}
                            <Tooltip cursor={{ fill: 'rgba(255, 255, 255, 0.1)' }} />
                            <Legend />
                            <Bar
                              yAxisId="left"
                              dataKey="efficiency"
                              fill="#FFCC59"
                              name={tr(language, 'Efficiency %', 'Efektyvumas %')}
                              radius={[4, 4, 0, 0]}
                            />
                            {!useHourlyCharts && (
                              <Bar
                                yAxisId="right"
                                dataKey="hourly"
                                fill="#8ACDEA"
                                name={tr(language, 'Avg hourly kWh', 'Vid. valandinis kWh')}
                                radius={[4, 4, 0, 0]}
                              />
                            )}
                          </>
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                </SimpleGrid>
              )
            )}

            {!shouldShowCharts && (
              <Text size="xs" c="dimmed" ta="center">
                {useHourlyCharts
                  ? tr(language, 'Not enough hourly points for trend charts in this interval.', 'Šiame intervale nepakanka valandinių taškų tendencijų grafikams.')
                  : tr(language, 'Not enough full-day points for trend charts in this period.', 'Šiame laikotarpyje nepakanka pilnų dienų taškų tendencijų grafikams.')}
              </Text>
            )}

            {fullDays.length < insights.daily.length && (
              <Text size="xs" c="dimmed" ta="center">
                {tr(language, 'Partial first/last day points are excluded from charts to reduce boundary skew.', 'Daliniai pirmos/paskutinės dienos taškai grafikuose neįtraukiami, kad sumažėtų kraštinių reikšmių iškraipymas.')}
              </Text>
            )}

            {isTechnicalReport && showAdvanced && insights.anomalyTypeDistribution.length > 0 && (
              <SimpleGrid cols={{ base: 1, lg: 2 }}>
                <Card p="md" radius="md" withBorder>
                  <Text fw={700} mb="md">{tr(language, 'Anomaly type distribution', 'Anomalijų tipų pasiskirstymas')}</Text>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={insights.anomalyTypeDistribution}
                        dataKey="count"
                        nameKey="type"
                        outerRadius={90}
                        label
                      >
                        {insights.anomalyTypeDistribution.map((entry, idx) => (
                          <Cell key={`${entry.type}-${idx}`} fill={anomalyColor(entry.type, idx)} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </Card>

                <Card p="md" radius="md" withBorder>
                  <Text fw={700} mb="md">{tr(language, 'Transmission error appendix', 'Perdavimo klaidų priedas')}</Text>
                  <Table.ScrollContainer minWidth={400}>
                    <Table>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{tr(language, 'Type', 'Tipas')}</Table.Th>
                          <Table.Th>{tr(language, 'Meaning', 'Reikšmė')}</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {insights.anomalyAppendix.map((item) => (
                          <Table.Tr key={item.type}>
                            <Table.Td>{anomalyTypeLabel(item.type, language)}</Table.Td>
                            <Table.Td>{item.description}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Card>
              </SimpleGrid>
            )}

            {isTechnicalReport && showAdvanced && (
              <Card p="md" radius="md" withBorder>
                <Text fw={700} mb="xs">Anomaly analysis (60-minute context)</Text>
                <Text size="sm" c="dimmed" mb="md">
                  {tr(language, 'Open an anomaly to view a 30-minute pre-event and 30-minute post-event context window.', 'Atidarykite anomaliją, kad matytumėte 30 min. prieš įvykį ir 30 min. po įvykio konteksto langą.')}
                </Text>

                {report.anomalySummary.length === 0 ? (
                  <Alert color="green" title={tr(language, 'Clean Health Status', 'Švari būklė')}>
                    {tr(language, 'No anomalies detected in this reporting period.', 'Šiame ataskaitos laikotarpyje anomalijų neaptikta.')}
                  </Alert>
                ) : (
                  <Accordion
                    value={openedAnomalyKey}
                    onChange={handleAnomalyAccordionChange}
                    chevronPosition="left"
                  >
                    {report.anomalySummary.map((a, index) => {
                      const itemKey = String(index);
                      const context = a.id != null ? contextByAnomalyId[a.id] : undefined;
                      const contextError = a.id != null ? contextErrorByAnomalyId[a.id] : undefined;
                      const isLoading = a.id != null && loadingAnomalyId === a.id;

                      return (
                        <Accordion.Item key={`${a.startsAt}-${a.phase}-${index}`} value={itemKey}>
                          <Accordion.Control>
                            <Group justify="space-between" wrap="wrap" gap="xs">
                              <Group gap="xs" wrap="wrap">
                                <Badge color={severityColor(a.severity)} variant="light">{a.severity}</Badge>
                                <Badge variant="light">{a.type}</Badge>
                                <Badge variant="outline">{anomalyDomainLabel(a.metricDomain)}</Badge>
                                <Badge variant="outline">{a.phase}</Badge>
                                <Text size="sm" fw={600}>{formatDate(a.startsAt, language)}</Text>
                              </Group>
                              <Group gap="md" wrap="wrap">
                                <Text size="xs" c="dimmed">{tr(language, 'Duration', 'Trukmė')}: {formatDuration(a.durationSeconds, language)}</Text>
                                <Text size="xs" c="dimmed">
                                  {a.metricDomain === 'POWER'
                                    ? `Metric: ${a.metricName ?? a.type}`
                                    : `Min/Max: ${a.minVoltage != null ? `${a.minVoltage.toFixed(1)} V` : '—'} / ${a.maxVoltage != null ? `${a.maxVoltage.toFixed(1)} V` : '—'}`}
                                </Text>
                              </Group>
                            </Group>
                          </Accordion.Control>
                          <Accordion.Panel>
                            <SimpleGrid cols={{ base: 1, sm: 3 }} mb="md">
                              <Card p="sm" withBorder>
                                <Text size="xs" c="dimmed">{tr(language, 'Start time', 'Pradžios laikas')}</Text>
                                <Text fw={600}>{formatDate(a.startsAt, language)}</Text>
                              </Card>
                              <Card p="sm" withBorder>
                                <Text size="xs" c="dimmed">{tr(language, 'End time', 'Pabaigos laikas')}</Text>
                                <Text fw={600}>{a.endsAt ? formatDate(a.endsAt, language) : '—'}</Text>
                              </Card>
                              <Card p="sm" withBorder>
                                <Text size="xs" c="dimmed">Type / domain</Text>
                                <Text fw={600}>{a.type} / {anomalyDomainLabel(a.metricDomain)}</Text>
                              </Card>
                            </SimpleGrid>

                            {a.id == null && (
                              <Alert color="yellow" title={tr(language, 'Context unavailable', 'Kontekstas nepasiekiamas')}>
                                {tr(language, 'This anomaly does not have a stored identifier yet. Re-generate this report to enable context slicing.', 'Ši anomalija dar neturi išsaugoto identifikatoriaus. Perkurkite ataskaitą, kad būtų galima matyti kontekstą.')}
                              </Alert>
                            )}

                            {isLoading && (
                              <Group gap="sm" mt="xs">
                                <Loader size="sm" />
                                <Text size="sm" c="dimmed">{tr(language, 'Loading anomaly context...', 'Kraunamas anomalijos kontekstas...')}</Text>
                              </Group>
                            )}

                            {contextError && (
                              <Alert mt="xs" color="red" title={tr(language, 'Failed to load anomaly context', 'Nepavyko įkelti anomalijos konteksto')}>
                                {contextError}
                              </Alert>
                            )}

                            {context && (
                              <>
                                <Group justify="space-between" mb="xs">
                                  <Text size="sm" c="dimmed">
                                    {tr(language, 'Context range', 'Konteksto intervalas')}: {formatDate(context.context.startsAt, language)} – {formatDate(context.context.endsAt, language)}
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    {tr(language, 'Points', 'Taškai')}: {context.context.returnedPointCount}/{context.context.rawPointCount}
                                    {context.context.downsampled ? tr(language, ' (downsampled)', ' (retinta)') : ''}
                                  </Text>
                                </Group>
                                {context.anomaly.metricDomain === 'VOLTAGE' && (
                                  <Text size="xs" c="dimmed" mb="xs">
                                    {tr(language, 'Dashed gray lines are compliance limits: 220V and 240V.', 'Pilkos punktyrinės linijos rodo atitikties ribas: 220V ir 240V.')}
                                  </Text>
                                )}

                                <ResponsiveContainer width="100%" height={320}>
                                  <LineChart data={context.points}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis
                                      dataKey="timestamp"
                                      tickFormatter={(value) => toChartTimeOnlyLabel(String(value), language)}
                                      minTickGap={28}
                                    />
                                    {context.anomaly.metricDomain === 'VOLTAGE' ? (
                                      <>
                                        <YAxis yAxisId="voltage" unit=" V" />
                                        <YAxis yAxisId="power" orientation="right" unit=" kW" />
                                        <ReferenceLine yAxisId="voltage" y={220} stroke="#868e96" strokeDasharray="4 4" />
                                        <ReferenceLine yAxisId="voltage" y={240} stroke="#868e96" strokeDasharray="4 4" />
                                      </>
                                    ) : (
                                      <YAxis yAxisId="power" unit=" kW" />
                                    )}
                                    <Tooltip
                                      labelFormatter={(label) => formatDate(String(label), language)}
                                      formatter={(value, name) => {
                                        if (typeof value !== 'number') return ['—', name];
                                        if (String(name).toLowerCase().includes('voltage')) {
                                          return [`${value.toFixed(2)} V`, name];
                                        }
                                        return [`${value.toFixed(3)} kW`, name];
                                      }}
                                    />
                                    <Legend />
                                    {context.anomaly.metricDomain === 'VOLTAGE' && (
                                      <>
                                        <Line
                                          yAxisId="voltage"
                                          type="monotone"
                                          dataKey="voltage"
                                          name={`${phaseName(a.phase, language)} ${tr(language, 'voltage', 'įtampa')}`}
                                          stroke="#c92a2a"
                                          strokeWidth={2}
                                          dot={false}
                                          connectNulls
                                        />
                                        {a.phase !== 'L1' && (
                                          <Line
                                            yAxisId="voltage"
                                            type="monotone"
                                            dataKey="voltageL1"
                                            name={`L1 ${tr(language, 'voltage', 'įtampa')}`}
                                            stroke="#495057"
                                            strokeWidth={1}
                                            dot={false}
                                            connectNulls
                                          />
                                        )}
                                        {a.phase !== 'L2' && (
                                          <Line
                                            yAxisId="voltage"
                                            type="monotone"
                                            dataKey="voltageL2"
                                            name={`L2 ${tr(language, 'voltage', 'įtampa')}`}
                                            stroke="#868e96"
                                            strokeWidth={1}
                                            dot={false}
                                            connectNulls
                                          />
                                        )}
                                        {a.phase !== 'L3' && (
                                          <Line
                                            yAxisId="voltage"
                                            type="monotone"
                                            dataKey="voltageL3"
                                            name={`L3 ${tr(language, 'voltage', 'įtampa')}`}
                                            stroke="#adb5bd"
                                            strokeWidth={1}
                                            dot={false}
                                            connectNulls
                                          />
                                        )}
                                      </>
                                    )}
                                    <Line
                                      yAxisId="power"
                                      type="monotone"
                                      dataKey="powerKw"
                                      name={context.anomaly.metricDomain === 'POWER' ? 'Power context' : tr(language, 'Total Power Delivered', 'Bendra tiekiama galia')}
                                      stroke="#1c7ed6"
                                      strokeWidth={2}
                                      dot={false}
                                      connectNulls
                                    />
                                  </LineChart>
                                </ResponsiveContainer>
                              </>
                            )}
                          </Accordion.Panel>
                        </Accordion.Item>
                      );
                    })}
                  </Accordion>
                )}
              </Card>
            )}

            <Text size="xs" c="dimmed" ta="center">
              {tr(language, 'Standard', 'Standartas')}: LST EN 50160 — ≥95% {tr(language, 'of 10-min RMS windows must be within 230V ±10V', '10 min RMS langų turi būti 230V ±10V ribose')}
            </Text>
          </>
        );
      })()}
    </Stack>
  );
}

/* ── Main page ───────────────────────────────────────────────── */

export function ReportsPage() {
  const { t, language } = useI18n();
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reportUse, setReportUse] = useState<'home' | 'technical' | 'solar'>('home');

  const { data: devicesRaw } = usePolling<DeviceListResponse[]>(
    ['settings', 'all'],
    '/api/settings',
    { intervalSeconds: 60 },
  );
  const devices: DeviceOption[] = (devicesRaw ?? []).map((d) => ({
    id: d.id,
    name: d.name,
  }));

  const { data: reportList, refetch: refetchReports } = usePolling<ReportListResponse>(
    ['reports', 'list'],
    '/api/reports?limit=50',
    { intervalSeconds: 30 },
  );

  const { data: reportDetail } = usePolling<ReportDetail>(
    ['reports', 'detail', String(selectedReportId)],
    selectedReportId != null ? `/api/reports/${selectedReportId}` : '',
    { intervalSeconds: 300, enabled: selectedReportId != null },
  );

  const [genDeviceId, setGenDeviceId] = useState<string | null>(null);
  const [genPeriod, setGenPeriod] = useState<string | null>('monthly');
  const [genCustomStartDate, setGenCustomStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return toDateInputValue(d);
  });
  const [genCustomEndDate, setGenCustomEndDate] = useState<string>(() => toDateInputValue(new Date()));

  const HOME_PERIOD_OPTIONS = [
    { value: 'daily', label: tr(language, '1 day', '1 diena') },
    { value: 'weekly', label: tr(language, '1 week', '1 savaitė') },
    { value: 'monthly', label: tr(language, '1 month', '1 mėnuo') },
  ];

  const TECHNICAL_PERIOD_OPTIONS = [
    { value: 'daily', label: tr(language, '1 day', '1 diena') },
    { value: 'weekly', label: tr(language, '1 week', '1 savaitė') },
    { value: 'biweekly', label: tr(language, '2 weeks', '2 savaitės') },
    { value: 'monthly', label: tr(language, '1 month', '1 mėnuo') },
    { value: 'custom', label: tr(language, 'Custom range', 'Pasirinktinis intervalas') },
  ];

  const SOLAR_PERIOD_OPTIONS = [
    { value: 'daily', label: tr(language, '1 day', '1 diena') },
    { value: 'monthly', label: tr(language, '1 month', '1 mėnuo') },
  ];

  useEffect(() => {
    setFormError(null);

    if (reportUse === 'home') {
      setGenPeriod((prev) =>
        prev && ['daily', 'weekly', 'monthly'].includes(prev) ? prev : 'monthly',
      );
    } else if (reportUse === 'technical') {
      setGenPeriod((prev) =>
        prev && ['daily', 'weekly', 'biweekly', 'monthly', 'custom'].includes(prev)
          ? prev
          : 'weekly',
      );
    } else {
      setGenPeriod((prev) =>
        prev && ['daily', 'monthly'].includes(prev) ? prev : 'monthly',
      );
    }
  }, [reportUse]);

  const handleGenerate = useCallback(async () => {
    if (!genDeviceId || !genPeriod) return;

    setFormError(null);

    if (genPeriod === 'custom') {
      const start = new Date(genCustomStartDate);
      const end = new Date(genCustomEndDate);
      const rangeDays = (end.getTime() - start.getTime()) / (24 * 3600_000);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        setFormError(tr(language, 'Custom range requires valid start and end dates.', 'Pasirinktiniam intervalui būtinos teisingos pradžios ir pabaigos datos.'));
        return;
      }
      if (end <= start) {
        setFormError(tr(language, 'Custom range end date must be later than start date.', 'Pasirinktinio intervalo pabaigos data turi būti vėlesnė už pradžios datą.'));
        return;
      }
      if (rangeDays > 62) {
        setFormError(tr(language, 'Custom range can be at most 2 months (62 days).', 'Pasirinktinis intervalas gali būti daugiausia 2 mėn. (62 dienos).'));
        return;
      }
      if (end.getTime() > Date.now()) {
        setFormError(tr(language, 'Custom range cannot end in the future.', 'Pasirinktinis intervalas negali baigtis ateityje.'));
        return;
      }
    }

    setGenerating(true);
    try {
      await apiPost('/api/reports/generate', {
        deviceId: parseInt(genDeviceId, 10),
        reportUse,
        periodType: genPeriod,
        ...(genPeriod === 'custom'
          ? {
              startDate: `${genCustomStartDate}T00:00:00.000Z`,
              endDate: (() => {
                const selectedEnd = new Date(`${genCustomEndDate}T00:00:00`);
                return isSameLocalDay(selectedEnd, new Date())
                  ? new Date().toISOString()
                  : `${genCustomEndDate}T23:59:59.999Z`;
              })(),
            }
          : {}),
      });

      refetchReports();
    } catch (err) {
      console.error('Report generation failed:', err);
      setFormError(tr(language, 'Report generation failed. Please check selected range and try again.', 'Ataskaitos sugeneruoti nepavyko. Patikrinkite pasirinktą intervalą ir bandykite dar kartą.'));
    } finally {
      setGenerating(false);
    }
  }, [
    genCustomEndDate,
    genCustomStartDate,
    genDeviceId,
    genPeriod,
    refetchReports,
    reportUse,
    language,
  ]);

  if (selectedReportId != null && reportDetail) {
    return (
      <Stack p="lg" gap="md" style={{ width: '100%' }}>
        <Button
          variant="subtle"
          onClick={() => setSelectedReportId(null)}
          style={{ alignSelf: 'flex-start' }}
        >
          ← {tr(language, 'Back to reports', 'Grįžti į ataskaitas')}
        </Button>
        <ReportPrintView report={reportDetail} />
      </Stack>
    );
  }

  const renderGenerateForm = (
    periodOptions: { value: string; label: string }[],
    title: string,
    description: string,
    bulletPoints: string[],
  ) => (
    <Stack gap="sm">
      <div>
        <Text fw={600}>{title}</Text>
        <Text c="dimmed" size="sm" mt={4}>
          {description}
        </Text>
      </div>

      <Stack gap={4}>
        {bulletPoints.map((item) => (
          <Text key={item} size="sm" c="dimmed">
            • {item}
          </Text>
        ))}
      </Stack>

      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select
          label={tr(language, 'Device', 'Įrenginys')}
          placeholder={tr(language, 'Select device', 'Pasirinkite įrenginį')}
          data={devices.map((d) => ({ value: String(d.id), label: d.name }))}
          value={genDeviceId}
          onChange={setGenDeviceId}
          style={{ minWidth: 220 }}
        />

        <Select
          label={tr(language, 'Data period', 'Duomenų laikotarpis')}
          data={periodOptions}
          value={genPeriod}
          onChange={setGenPeriod}
          style={{ minWidth: 220 }}
        />

        {genPeriod === 'custom' && (
          <>
            <TextInput
              label={tr(language, 'Start date', 'Pradžios data')}
              type="date"
              value={genCustomStartDate}
              onChange={(e) => setGenCustomStartDate(e.currentTarget.value)}
            />
            <TextInput
              label={tr(language, 'End date', 'Pabaigos data')}
              type="date"
              value={genCustomEndDate}
              onChange={(e) => setGenCustomEndDate(e.currentTarget.value)}
            />
          </>
        )}

        <Button
          onClick={handleGenerate}
          loading={generating}
          disabled={!genDeviceId || !genPeriod}
        >
          {tr(language, 'Generate', 'Generuoti')}
        </Button>
      </Group>
    </Stack>
  );

  return (
    <Stack p="lg" gap="md" style={{ width: '100%' }}>
      <Title order={2}>{t('reports.title')}</Title>

      <Card p="md" radius="md" withBorder>
        <Text fw={700} mb="md">{tr(language, 'Generate Report', 'Generuoti ataskaitą')}</Text>

        <Tabs value={reportUse} onChange={(value) => setReportUse((value as typeof reportUse) ?? 'home')}>
          <Tabs.List>
            <Tabs.Tab value="home">{tr(language, 'Home report', 'Namų ataskaita')}</Tabs.Tab>
            <Tabs.Tab value="technical">{tr(language, 'Technical report', 'Techninė ataskaita')}</Tabs.Tab>
            <Tabs.Tab value="solar">{tr(language, 'Solar report', 'Saulės ataskaita')}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="home" pt="md">
            {renderGenerateForm(
              HOME_PERIOD_OPTIONS,
              tr(language, 'Homeowner report', 'Namų ūkio ataskaita'),
              tr(language, 'A simple report focused on household electricity use, anomalies, and supply quality.', 'Paprasta ataskaita, orientuota į namų ūkio elektros naudojimą, anomalijas ir tiekimo kokybę.'),
              [
                tr(language, 'Energy usage over time', 'Energijos naudojimas laike'),
                tr(language, 'Basic consumption insights', 'Pagrindinės suvartojimo įžvalgos'),
                tr(language, 'Anomaly count and summary', 'Anomalijų skaičius ir santrauka'),
                tr(language, 'ESO compliance overview', 'ESO atitikties apžvalga'),
              ],
            )}
          </Tabs.Panel>

          <Tabs.Panel value="technical" pt="md">
            {renderGenerateForm(
              TECHNICAL_PERIOD_OPTIONS,
              tr(language, 'Technical / professional report', 'Techninė / profesionali ataskaita'),
              tr(language, 'A more detailed report intended for technical inspection and power-quality analysis.', 'Detalesnė ataskaita techninei patikrai ir galios kokybės analizei.'),
              [
                tr(language, 'Voltage quality and compliance', 'Įtampos kokybė ir atitiktis'),
                tr(language, 'Anomaly review', 'Anomalijų peržiūra'),
                tr(language, 'Energy and efficiency insights', 'Energijos ir efektyvumo įžvalgos'),
                tr(language, 'Supports custom range investigation', 'Palaiko pasirinktinių intervalų analizę'),
              ],
            )}
          </Tabs.Panel>

          <Tabs.Panel value="solar" pt="md">
            {renderGenerateForm(
              SOLAR_PERIOD_OPTIONS,
              tr(language, 'Solar owner report', 'Saulės savininko ataskaita'),
              tr(language, 'A basic report for users who want to review exported/generated energy using currently available data.', 'Paprasta ataskaita naudotojams, norintiems peržiūrėti eksportuotą / sugeneruotą energiją pagal turimus duomenis.'),
              [
                tr(language, 'Returned energy insights', 'Grąžintos energijos įžvalgos'),
                tr(language, 'Energy trend review', 'Energijos tendencijų apžvalga'),
                tr(language, 'Basic anomaly and supply overview', 'Pagrindinė anomalijų ir tiekimo apžvalga'),
                tr(language, 'Single-device basic solar use case', 'Vieno įrenginio bazinis saulės scenarijus'),
              ],
            )}
          </Tabs.Panel>
        </Tabs>

        {formError && (
          <Alert color="red" mt="sm" title={tr(language, 'Could not generate report', 'Nepavyko sugeneruoti ataskaitos')}>
            {formError}
          </Alert>
        )}
      </Card>

      <Card p="md" radius="md" withBorder>
        <Text fw={700} mb="md">
          {tr(language, 'Generated Reports', 'Sugeneruotos ataskaitos')} ({reportList?.count ?? 0})
        </Text>

        {reportList && reportList.count > 0 ? (
          <Table.ScrollContainer minWidth={900}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{tr(language, 'Device', 'Įrenginys')}</Table.Th>
                  <Table.Th>{tr(language, 'Type', 'Tipas')}</Table.Th>
                  <Table.Th>{tr(language, 'Period', 'Laikotarpis')}</Table.Th>
                  <Table.Th>{tr(language, 'Date Range', 'Datų intervalas')}</Table.Th>
                  <Table.Th>{tr(language, 'Health', 'Būklė')}</Table.Th>
                  <Table.Th>{tr(language, 'Compliance', 'Atitikimas')}</Table.Th>
                  <Table.Th>{tr(language, 'Anomalies', 'Anomalijos')}</Table.Th>
                  <Table.Th>{tr(language, 'Actions', 'Veiksmai')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {reportList.data.map((r) => {
                  const avgPct = +(
                    (r.compliancePctL1 + r.compliancePctL2 + r.compliancePctL3) / 3
                  ).toFixed(1);

                  return (
                    <Table.Tr key={r.id}>
                      <Table.Td>{r.deviceName}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="sm">
                          {reportUseLabel(r.reportUse, language)}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="sm">
                          {periodLabel(r.periodType, language)}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {formatDate(r.startsAt, language)} – {formatDate(r.endsAt, language)}
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={4}>
                          <Badge color={healthColor(r.combinedHealthScore)} variant="light">
                            Overall {r.combinedHealthScore}
                          </Badge>
                          <Group gap={4}>
                            <Badge color={healthColor(r.healthScore)} variant="light" size="xs">
                              V {r.healthScore}
                            </Badge>
                            <Badge color={healthColor(r.powerHealthScore)} variant="light" size="xs">
                              P {r.powerHealthScore}
                            </Badge>
                          </Group>
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs">
                          <Progress
                            value={avgPct}
                            color={avgPct >= 95 ? 'green' : avgPct >= 90 ? 'yellow' : 'red'}
                            size="sm"
                            radius="xl"
                            style={{ width: 60 }}
                          />
                          <Text size="sm">{avgPct}%</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        {r.totalAnomalies > 0 ? (
                          <Group gap={4}>
                            <Text size="sm">{r.totalAnomalies}</Text>
                            {r.criticalCount > 0 && (
                              <Badge color="red" size="xs">{r.criticalCount} {tr(language, 'crit', 'krit.')}</Badge>
                            )}
                          </Group>
                        ) : (
                          <Text size="sm" c="dimmed">0</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Button
                          variant="light"
                          size="xs"
                          onClick={() => setSelectedReportId(r.id)}
                        >
                          {tr(language, 'View', 'Peržiūrėti')}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Box py="xl">
            <Text c="dimmed" ta="center">
              {tr(language, 'No reports generated yet. Use one of the report sections above or wait for the weekly automatic report.', 'Ataskaitų dar nesugeneruota. Pasinaudokite viena iš aukščiau esančių ataskaitų skilčių arba palaukite savaitinės automatinės ataskaitos.')}
            </Text>
          </Box>
        )}
      </Card>
    </Stack>
  );
}
