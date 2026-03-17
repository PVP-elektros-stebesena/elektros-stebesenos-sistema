import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Badge, Button, Card, Group, Progress,
  RingProgress, SimpleGrid, Stack, Table, Switch,
  Text, Title, Select, Divider, Box, TextInput,
} from '@mantine/core';
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePolling } from '../hooks/usePolling';
import { apiPost } from '../services/apiClient';

/* ── API response types ─────────────────────────────────────────── */

interface ReportListItem {
  id: number;
  deviceId: number;
  deviceName: string;
  periodType: string;
  startsAt: string;
  endsAt: string;
  healthScore: string;
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
  type: string;
  phase: string;
  durationSeconds: number | null;
  minVoltage: number | null;
  maxVoltage: number | null;
  startsAt: string;
  endsAt: string | null;
  severity: string;
}

interface ReportDetail {
  id: number;
  deviceId: number;
  deviceName: string;
  periodType: string;
  startsAt: string;
  endsAt: string;
  healthScore: string;
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

/* ── Helpers ────────────────────────────────────────────────────── */

function healthColor(score: string): string {
  switch (score) {
    case 'GREEN': return 'green';
    case 'YELLOW': return 'yellow';
    case 'RED': return 'red';
    default: return 'gray';
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('lt-LT', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

const PERIOD_OPTIONS = [
  { value: 'daily', label: '1 day' },
  { value: 'weekly', label: '1 week' },
  { value: 'biweekly', label: '2 weeks' },
  { value: 'monthly', label: '1 month' },
  { value: 'custom', label: 'Custom range' },
];

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toChartDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('lt-LT', {
    month: 'short',
    day: 'numeric',
  });
}

function toChartTimeOnlyLabel(timestamp: string): string {
  return new Date(timestamp).toLocaleString('lt-LT', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toChartShortDateTimeLabel(timestamp: string): string {
  return new Date(timestamp).toLocaleString('lt-LT', {
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

function periodLabel(periodType: string): string {
  const labels: Record<string, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    biweekly: 'Biweekly',
    monthly: 'Monthly',
    custom: 'Custom',
  };
  return labels[periodType] ?? periodType;
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

/* ── Print-friendly report view ─────────────────────────────────── */

function ReportPrintView({ report }: { report: ReportDetail }) {
  const printRef = useRef<HTMLDivElement>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
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
  const quality = report.powerQuality ?? {
    averageCompliancePct: avgPct,
    worstPhase: worstPhase.phase,
    worstPhaseCompliancePct: worstPhase.pct,
    pass: report.compliance.overallCompliant,
    dominantAnomalyType: null,
    assessmentText: 'Power quality assessment is unavailable for this report.',
    recommendationText: '',
  };
  const insights = report.insights ?? {
    totalEnergyConsumedKwh: 0,
    totalEnergyReturnedKwh: 0,
    averageEfficiencyPct: null,
    averageHourlyElectricityKwh: null,
    daily: [],
    hourly: [],
    anomalyTypeDistribution: [],
    narrative: 'Energy insights are unavailable for this report.',
    anomalyAppendix: [],
  };

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Voltage Report - ${report.deviceName}</title>
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
        <h1>LST EN 50160 Voltage Quality Report</h1>
        <p class="subtitle">
          Device: ${report.deviceName} &middot;
          Period: ${formatDate(report.startsAt)} – ${formatDate(report.endsAt)} &middot;
          Type: ${report.periodType}
        </p>

        <span class="health-badge health-${report.healthScore}">Health: ${report.healthScore}</span>

        <h2>Compliance Summary</h2>
        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-value">${avgPct}%</div>
            <div class="stat-label">Average Compliance</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">${report.compliance.totalWindows}</div>
            <div class="stat-label">Total 10-min Windows</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">${report.totalAnomalies}</div>
            <div class="stat-label">Anomalies Detected</div>
          </div>
        </div>

        <table>
          <thead><tr><th>Phase</th><th>Compliant Windows</th><th>Compliance %</th><th>Status</th></tr></thead>
          <tbody>
            <tr>
              <td>L1</td>
              <td>${report.compliance.compliantWindowsL1} / ${report.compliance.totalWindows}</td>
              <td>${report.compliance.compliancePctL1}%</td>
              <td>${report.compliance.compliancePctL1 >= 95 ? '✓ PASS' : '✗ FAIL'}</td>
            </tr>
            <tr>
              <td>L2</td>
              <td>${report.compliance.compliantWindowsL2} / ${report.compliance.totalWindows}</td>
              <td>${report.compliance.compliancePctL2}%</td>
              <td>${report.compliance.compliancePctL2 >= 95 ? '✓ PASS' : '✗ FAIL'}</td>
            </tr>
            <tr>
              <td>L3</td>
              <td>${report.compliance.compliantWindowsL3} / ${report.compliance.totalWindows}</td>
              <td>${report.compliance.compliancePctL3}%</td>
              <td>${report.compliance.compliancePctL3 >= 95 ? '✓ PASS' : '✗ FAIL'}</td>
            </tr>
          </tbody>
        </table>

        <h2>Power Quality Assessment</h2>
        <p>${quality.assessmentText}</p>
        <table>
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>EN 50160 status</td><td>${quality.pass ? 'Compliant' : 'Non-compliant'}</td></tr>
            <tr><td>Average compliance</td><td>${quality.averageCompliancePct.toFixed(2)}%</td></tr>
            <tr><td>Worst phase</td><td>${quality.worstPhase}</td></tr>
            <tr><td>Worst-phase compliance</td><td>${quality.worstPhaseCompliancePct.toFixed(2)}%</td></tr>
            <tr><td>Dominant anomaly type</td><td>${quality.dominantAnomalyType ?? 'None'}</td></tr>
          </tbody>
        </table>
        <p>${quality.recommendationText}</p>

        <h2>Energy Insights</h2>
        <p>${insights.narrative}</p>
        <table>
          <thead><tr><th>Date</th><th>Energy consumed (kWh)</th><th>Energy returned (kWh)</th><th>Efficiency (%)</th><th>Avg hourly electricity (kWh)</th></tr></thead>
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
          <h2>Anomaly Details (${report.anomalySummary.length})</h2>
          <table>
            <thead><tr><th>Type</th><th>Phase</th><th>Severity</th><th>Duration</th><th>Min V</th><th>Max V</th><th>Started</th></tr></thead>
            <tbody>
              ${report.anomalySummary.map(a => `
                <tr>
                  <td>${a.type}</td>
                  <td>${a.phase}</td>
                  <td>${a.severity}</td>
                  <td>${formatDuration(a.durationSeconds)}</td>
                  <td>${a.minVoltage != null ? a.minVoltage.toFixed(1) + ' V' : '—'}</td>
                  <td>${a.maxVoltage != null ? a.maxVoltage.toFixed(1) + ' V' : '—'}</td>
                  <td>${formatDate(a.startsAt)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<h2>Anomalies</h2><p>No anomalies detected during this period.</p>'}

        ${insights.anomalyAppendix.length > 0 ? `
          <h2>Transmission Error Appendix</h2>
          <table>
            <thead><tr><th>Type</th><th>Description</th></tr></thead>
            <tbody>
              ${insights.anomalyAppendix.map(a => `
                <tr>
                  <td>${a.type}</td>
                  <td>${a.description}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}

        <div class="footer">
          Generated: ${new Date().toLocaleString()} &middot;
          Standard: LST EN 50160 (≥95% of 10-min RMS windows within 230V ±10V)
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
                ? toChartTimeOnlyLabel(d.timestamp)
                : toChartShortDateTimeLabel(d.timestamp),
              value: d.energyConsumedKwh,
              efficiency: d.efficiencyPct,
              hourly: d.avgHourlyElectricityKwh,
            }))
          : chartDays.map((d) => ({
              x: toChartDateLabel(d.date),
              value: d.energyConsumedKwh,
              efficiency: d.efficiencyPct,
              hourly: d.avgHourlyElectricityKwh,
            }));

        return (
          <>
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={3}>
            {periodLabel(report.periodType)} Report
          </Title>
          <Text c="dimmed" size="sm">
            {report.deviceName} &middot; {formatDate(report.startsAt)} – {formatDate(report.endsAt)}
          </Text>
        </div>
        <Group gap="sm">
          <Badge
            size="xl"
            color={healthColor(report.healthScore)}
            variant="light"
          >
            {report.healthScore}
          </Badge>
          <Switch
            label="Advanced details"
            checked={showAdvanced}
            onChange={(event) => setShowAdvanced(event.currentTarget.checked)}
          />
          <Button variant="light" onClick={handlePrint}>
            Print / PDF
          </Button>
        </Group>
      </Group>

      <Divider />

      {/* Compliance overview */}
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
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
            <Text size="xs" c="dimmed">Average Compliance</Text>
          </Stack>
        </Card>
        <Card p="md" radius="md" withBorder>
          <Stack align="center" justify="center" style={{ height: '100%' }}>
            <Text fz={36} fw={700}>{report.compliance.totalWindows}</Text>
            <Text size="xs" c="dimmed">Total 10-min Windows</Text>
          </Stack>
        </Card>
        <Card p="md" radius="md" withBorder>
          <Stack align="center" justify="center" style={{ height: '100%' }}>
            <Text fz={36} fw={700} c={report.totalAnomalies > 0 ? 'red' : undefined}>
              {report.totalAnomalies}
            </Text>
            <Text size="xs" c="dimmed">Anomalies Detected</Text>
            {report.criticalCount > 0 && (
              <Badge color="red" size="sm">{report.criticalCount} CRITICAL</Badge>
            )}
          </Stack>
        </Card>
      </SimpleGrid>

      {showAdvanced && (
        <Card p="md" radius="md" withBorder>
          <Text fw={700} mb="md">Per-Phase Compliance</Text>
          <Table.ScrollContainer minWidth={500}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Phase</Table.Th>
                  <Table.Th>Compliant Windows</Table.Th>
                  <Table.Th>Compliance</Table.Th>
                  <Table.Th>Status</Table.Th>
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
                          {pct >= 95 ? 'PASS' : 'FAIL'}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}

      <Card p="md" radius="md" withBorder>
        <Group justify="space-between" mb="xs">
          <Text fw={700}>Power Quality Assessment</Text>
          <Badge color={quality.pass ? 'green' : 'red'} variant="light">
            {quality.pass ? 'COMPLIANT' : 'NON-COMPLIANT'}
          </Badge>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 4 }} mb="md">
          <Card p="sm" withBorder>
            <Text size="xs" c="dimmed">Average compliance</Text>
            <Text fw={700} fz="lg">{quality.averageCompliancePct.toFixed(2)}%</Text>
          </Card>
          <Card p="sm" withBorder>
            <Text size="xs" c="dimmed">Worst phase</Text>
            <Text fw={700} fz="lg">{quality.worstPhase}</Text>
          </Card>
          <Card p="sm" withBorder>
            <Text size="xs" c="dimmed">Worst-phase compliance</Text>
            <Text fw={700} fz="lg">{quality.worstPhaseCompliancePct.toFixed(2)}%</Text>
          </Card>
          <Card p="sm" withBorder>
            <Text size="xs" c="dimmed">Dominant anomaly</Text>
            <Text fw={700} fz="lg">{quality.dominantAnomalyType ?? 'None'}</Text>
          </Card>
        </SimpleGrid>

        <Text size="sm" mb={4}>{quality.assessmentText}</Text>
        <Text size="sm" c="dimmed">{quality.recommendationText}</Text>
      </Card>

      <Card p="md" radius="md" withBorder>
        <Text fw={700} mb="xs">Report summary</Text>
        <Text size="sm" c="dimmed">{insights.narrative}</Text>

        <SimpleGrid cols={{ base: 1, sm: 4 }} mt="md">
          <Card p="sm" withBorder>
            <Text size="xs" c="dimmed">Total consumed</Text>
            <Text fw={700} fz="xl">{insights.totalEnergyConsumedKwh.toFixed(2)} kWh</Text>
          </Card>
          <Card p="sm" withBorder>
            <Text size="xs" c="dimmed">Total returned</Text>
            <Text fw={700} fz="xl">{insights.totalEnergyReturnedKwh.toFixed(2)} kWh</Text>
          </Card>
          <Card p="sm" withBorder>
            <Text size="xs" c="dimmed">Avg efficiency</Text>
            <Text fw={700} fz="xl">
              {insights.averageEfficiencyPct != null
                ? `${insights.averageEfficiencyPct.toFixed(1)}%`
                : '—'}
            </Text>
          </Card>
          <Card p="sm" withBorder>
            <Text size="xs" c="dimmed">Avg hourly electricity</Text>
            <Text fw={700} fz="xl">
              {insights.averageHourlyElectricityKwh != null
                ? `${insights.averageHourlyElectricityKwh.toFixed(3)} kWh`
                : '—'}
            </Text>
          </Card>
        </SimpleGrid>
      </Card>

      {shouldShowCharts && (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Card p="md" radius="md" withBorder>
            <Text fw={700} mb="md">
              {useHourlyCharts ? 'Hourly electricity consumption' : 'Daily electricity consumption'}
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
                  name="Consumed"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card p="md" radius="md" withBorder>
            <Text fw={700} mb="md">
              {useHourlyCharts ? 'Hourly efficiency trend' : 'Efficiency and avg hourly use'}
            </Text>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="x" />
                <YAxis yAxisId="left" unit=" %" />
                {!useHourlyCharts && <YAxis yAxisId="right" orientation="right" unit=" kWh" />}
                <Tooltip cursor={{ fill: 'rgba(255, 255, 255, 0.1)' }} />
                <Legend />
                <Bar
                  yAxisId="left"
                  dataKey="efficiency"
                  fill="#FFCC59"
                  name="Efficiency %"
                  radius={[4, 4, 0, 0]}
                />
                {!useHourlyCharts && (
                  <Bar
                    yAxisId="right"
                    dataKey="hourly"
                    fill="#8ACDEA"
                    name="Avg hourly kWh"
                    radius={[4, 4, 0, 0]}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </SimpleGrid>
      )}

      {!shouldShowCharts && (
        <Text size="xs" c="dimmed" ta="center">
          {useHourlyCharts
            ? 'Not enough hourly points for trend charts in this interval.'
            : 'Not enough full-day points for trend charts in this period.'}
        </Text>
      )}

      {fullDays.length < insights.daily.length && (
        <Text size="xs" c="dimmed" ta="center">
          Partial first/last day points are excluded from charts to reduce boundary skew.
        </Text>
      )}

      {showAdvanced && insights.anomalyTypeDistribution.length > 0 && (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Card p="md" radius="md" withBorder>
            <Text fw={700} mb="md">Anomaly type distribution</Text>
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
            <Text fw={700} mb="md">Transmission error appendix</Text>
            <Table.ScrollContainer minWidth={400}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Meaning</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {insights.anomalyAppendix.map((item) => (
                    <Table.Tr key={item.type}>
                      <Table.Td>{item.type}</Table.Td>
                      <Table.Td>{item.description}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        </SimpleGrid>
      )}

      {/* Anomaly table */}
      {showAdvanced && report.anomalySummary.length > 0 && (
        <Card p="md" radius="md" withBorder>
          <Text fw={700} mb="md">
            Anomaly Details ({report.anomalySummary.length})
          </Text>
          <Table.ScrollContainer minWidth={600}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Phase</Table.Th>
                <Table.Th>Severity</Table.Th>
                <Table.Th>Duration</Table.Th>
                <Table.Th>Min V</Table.Th>
                <Table.Th>Max V</Table.Th>
                <Table.Th>Started</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {report.anomalySummary.map((a, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{a.type}</Table.Td>
                  <Table.Td><Badge variant="light">{a.phase}</Badge></Table.Td>
                  <Table.Td>
                    <Badge
                      color={a.severity === 'CRITICAL' ? 'red' : 'yellow'}
                      variant="light"
                      size="sm"
                    >
                      {a.severity}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{formatDuration(a.durationSeconds)}</Table.Td>
                  <Table.Td>{a.minVoltage != null ? `${a.minVoltage.toFixed(1)} V` : '—'}</Table.Td>
                  <Table.Td>{a.maxVoltage != null ? `${a.maxVoltage.toFixed(1)} V` : '—'}</Table.Td>
                  <Table.Td>{new Date(a.startsAt).toLocaleString()}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        </Card>
      )}

      <Text size="xs" c="dimmed" ta="center">
        Standard: LST EN 50160 — ≥95% of 10-min RMS windows must be within 230V ±10V
      </Text>
          </>
        );
      })()}
    </Stack>
  );
}

/* ── Main page ───────────────────────────────────────────────── */

export function ReportsPage() {
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Fetch devices for the generate form
  const { data: devicesRaw } = usePolling<DeviceListResponse[]>(
    ['settings', 'all'],
    '/api/settings',
    { intervalSeconds: 60 },
  );
  const devices: DeviceOption[] = (devicesRaw ?? []).map((d) => ({
    id: d.id,
    name: d.name,
  }));

  // Report list
  const { data: reportList, refetch: refetchReports } = usePolling<ReportListResponse>(
    ['reports', 'list'],
    '/api/reports?limit=50',
    { intervalSeconds: 30 },
  );

  // Report detail (only fetched when selected)
  const { data: reportDetail } = usePolling<ReportDetail>(
    ['reports', 'detail', String(selectedReportId)],
    selectedReportId != null ? `/api/reports/${selectedReportId}` : '',
    { intervalSeconds: 300, enabled: selectedReportId != null },
  );

  // Generate form state
  const [genDeviceId, setGenDeviceId] = useState<string | null>(null);
  const [genPeriod, setGenPeriod] = useState<string | null>('daily');
  const [genCustomStartDate, setGenCustomStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return toDateInputValue(d);
  });
  const [genCustomEndDate, setGenCustomEndDate] = useState<string>(() => toDateInputValue(new Date()));

  const handleGenerate = useCallback(async () => {
    if (!genDeviceId || !genPeriod) return;

    setFormError(null);

    if (genPeriod === 'custom') {
      const start = new Date(genCustomStartDate);
      const end = new Date(genCustomEndDate);
      const rangeDays = (end.getTime() - start.getTime()) / (24 * 3600_000);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        setFormError('Custom range requires valid start and end dates.');
        return;
      }
      if (end <= start) {
        setFormError('Custom range end date must be later than start date.');
        return;
      }
      if (rangeDays > 62) {
        setFormError('Custom range can be at most 2 months (62 days).');
        return;
      }
      if (end.getTime() > Date.now()) {
        setFormError('Custom range cannot end in the future.');
        return;
      }
    }

    setGenerating(true);
    try {
      await apiPost('/api/reports/generate', {
        deviceId: parseInt(genDeviceId, 10),
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
      setFormError('Report generation failed. Please check selected range and try again.');
    } finally {
      setGenerating(false);
    }
  }, [
    genCustomEndDate,
    genCustomStartDate,
    genDeviceId,
    genPeriod,
    refetchReports,
  ]);

  // If viewing a report detail
  if (selectedReportId != null && reportDetail) {
    return (
      <Stack p="lg" gap="md" style={{ width: '100%' }}>
        <Button
          variant="subtle"
          onClick={() => setSelectedReportId(null)}
          style={{ alignSelf: 'flex-start' }}
        >
          ← Back to reports
        </Button>
        <ReportPrintView report={reportDetail} />
      </Stack>
    );
  }

  return (
    <Stack p="lg" gap="md" style={{ width: '100%' }}>
      <Title order={2}>Reports</Title>

      {/* Generate new report */}
      <Card p="md" radius="md" withBorder>
        <Text fw={700} mb="md">Generate Report</Text>
        <Group gap="sm" align="flex-end">
          <Select
            label="Device"
            placeholder="Select device"
            data={devices.map((d) => ({ value: String(d.id), label: d.name }))}
            value={genDeviceId}
            onChange={setGenDeviceId}
            style={{ minWidth: 200 }}
          />
          <Select
            label="Data period"
            data={PERIOD_OPTIONS}
            value={genPeriod}
            onChange={setGenPeriod}
            style={{ minWidth: 200 }}
          />
          {genPeriod === 'custom' && (
            <>
              <TextInput
                label="Start date"
                type="date"
                value={genCustomStartDate}
                onChange={(e) => setGenCustomStartDate(e.currentTarget.value)}
              />
              <TextInput
                label="End date"
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
            Generate
          </Button>
        </Group>
        <Text c="dimmed" size="sm" mt="sm">
          Available periods: 1 day, 1 week, 2 weeks, 1 month, or custom range (max 2 months / 62 days).
        </Text>
        {formError && (
          <Alert color="red" mt="sm" title="Could not generate report">
            {formError}
          </Alert>
        )}
      </Card>

      {/* Report list */}
      <Card p="md" radius="md" withBorder>
        <Text fw={700} mb="md">
          Generated Reports ({reportList?.count ?? 0})
        </Text>

        {reportList && reportList.count > 0 ? (
          <Table.ScrollContainer minWidth={800}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Device</Table.Th>
                  <Table.Th>Period</Table.Th>
                  <Table.Th>Date Range</Table.Th>
                  <Table.Th>Health</Table.Th>
                  <Table.Th>Compliance</Table.Th>
                  <Table.Th>Anomalies</Table.Th>
                  <Table.Th>Actions</Table.Th>
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
                        {periodLabel(r.periodType)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {formatDate(r.startsAt)} – {formatDate(r.endsAt)}
                    </Table.Td>
                    <Table.Td>
                      <Badge color={healthColor(r.healthScore)} variant="light">
                        {r.healthScore}
                      </Badge>
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
                            <Badge color="red" size="xs">{r.criticalCount} crit</Badge>
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
                        View
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
              No reports generated yet. Use the form above or wait for the weekly
              automatic report (runs every Monday at 00:01).
            </Text>
          </Box>
        )}
      </Card>
    </Stack>
  );
}
