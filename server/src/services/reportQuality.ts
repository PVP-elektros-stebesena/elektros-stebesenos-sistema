export interface PowerQualityAssessment {
  averageCompliancePct: number;
  worstPhase: 'L1' | 'L2' | 'L3';
  worstPhaseCompliancePct: number;
  pass: boolean;
  dominantAnomalyType: string | null;
  assessmentText: string;
  recommendationText: string;
}

interface ComplianceInput {
  compliancePctL1: number;
  compliancePctL2: number;
  compliancePctL3: number;
  overallCompliant: boolean;
}

interface AnomalyInput {
  type: string;
}

export function buildPowerQualityAssessment(
  compliance: ComplianceInput,
  anomalies: AnomalyInput[],
): PowerQualityAssessment {
  const byPhase = {
    L1: compliance.compliancePctL1,
    L2: compliance.compliancePctL2,
    L3: compliance.compliancePctL3,
  } as const;

  const phaseEntries = Object.entries(byPhase) as Array<['L1' | 'L2' | 'L3', number]>;
  const [worstPhase, worstPhaseCompliancePct] = phaseEntries.reduce((acc, cur) =>
    (cur[1] < acc[1] ? cur : acc),
  );

  const averageCompliancePct = +(
    (compliance.compliancePctL1 + compliance.compliancePctL2 + compliance.compliancePctL3) / 3
  ).toFixed(2);

  const anomalyCounts = anomalies.reduce<Record<string, number>>((acc, anomaly) => {
    acc[anomaly.type] = (acc[anomaly.type] ?? 0) + 1;
    return acc;
  }, {});

  const dominantAnomalyType = Object.entries(anomalyCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const pass = compliance.overallCompliant;

  const assessmentText = pass
    ? `Power quality is compliant with the EN 50160 target (>=95% in-range 10-minute windows). Worst observed phase was ${worstPhase} at ${worstPhaseCompliancePct.toFixed(2)}%.`
    : `Power quality is not compliant with the EN 50160 target. Worst observed phase was ${worstPhase} at ${worstPhaseCompliancePct.toFixed(2)}%, below the 95% threshold.`;

  const recommendationText = dominantAnomalyType
    ? `Primary anomaly driver in this interval: ${dominantAnomalyType}. Review phase-level events and recurrence timing.`
    : 'No dominant anomaly type detected in this interval.';

  return {
    averageCompliancePct,
    worstPhase,
    worstPhaseCompliancePct,
    pass,
    dominantAnomalyType,
    assessmentText,
    recommendationText,
  };
}
