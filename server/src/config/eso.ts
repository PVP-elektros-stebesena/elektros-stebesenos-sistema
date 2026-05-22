/**
 * ESO grid quality standards
 * Reference: https://www.eso.lt/verslui/elektra/elektros-planiniai-atjungimai-ir-itampos-svyravimai/itampos-svyravimai/4031
 *
 * Key rules:
 * - Nominal low voltage (1-phase): 230 V +- 10%  -> [207, 253]
 * - Nominal low voltage (3-phase line-to-line): 400 V +- 10% -> [360, 440]
 * - Measured in 10-minute RMS intervals
 * - 95% of weekly 10-min windows must be within bounds
 *
 * NOTE: The tolerance is +-10% of nominal voltage.
 */

export const ESO = {
  /** Nominal phase-to-neutral voltage (V) — single-phase system */
  NOMINAL_VOLTAGE_1PH: 230,

  /** Nominal line-to-line voltage (V) — three-phase system */
  NOMINAL_VOLTAGE_3PH: 400,

  /** Voltage tolerance as a fraction of nominal voltage. */
  VOLTAGE_TOLERANCE_PCT: 0.1,

  /** Acceptable range for single-phase: 230 +- 10% */
  VOLTAGE_MIN_1PH: 207,
  VOLTAGE_MAX_1PH: 253,

  /** Acceptable range for three-phase (line-to-line): 400 +- 10% */
  VOLTAGE_MIN_3PH: 360,
  VOLTAGE_MAX_3PH: 440,

  /** RMS aggregation window duration in minutes */
  WINDOW_MINUTES: 10,

  /** Total seconds in one window */
  WINDOW_SECONDS: 600,

  /** Max allowed out-of-bounds percentage within a single window */
  WINDOW_OOB_THRESHOLD_PCT: 5,

  /** Max allowed out-of-bounds seconds within a 600s window (5% of 600) */
  WINDOW_OOB_MAX_SECONDS: 30,

  /** Weekly compliance: >=95% of 10-min windows must pass */
  WEEKLY_COMPLIANCE_PCT: 95,

  /** Total 10-min windows in a week: 7 * 24 * 6 = 1008 */
  WINDOWS_PER_WEEK: 1008,

  /** Long supply interruption threshold: voltage gone > 3 minutes */
  LONG_INTERRUPTION_SECONDS: 180,

  /** Short supply interruption: voltage gone <= 3 minutes */
  SHORT_INTERRUPTION_MAX_SECONDS: 180,

  /** Voltage below this is considered "zero" / supply lost */
  VOLTAGE_ZERO_THRESHOLD: 10,

  /** Reactive energy settlement defaults for commercial estimates. */
  REACTIVE_PENALTY: {
    ALLOWED_TAN_PHI_RATIO: 0.4,
    TARGET_POWER_FACTOR: 0.95,
    ELIGIBLE_MIN_GRID_CAPACITY_KW: 30,
    CONSUMED_REACTIVE_EUR_PER_KVARH: 0.02,
    RETURNED_REACTIVE_EUR_PER_KVARH: 0.04,
    CURRENCY: 'EUR',
    EFFECTIVE_FROM: '2026-01-01',
    SOURCE_URLS: [
      'https://www.e-tar.lt/rs/actualedition/TAR.77180231C700/YEWCFVSZCJ/',
      'https://www.eso.lt/namams/elektra/tarifu-planai-kainos-atsiskaitymas/tarifu-planai-ir-kainos-2026-metais/4801',
    ],
  },
} as const;

export type Phase = 'L1' | 'L2' | 'L3';
export const PHASES: Phase[] = ['L1', 'L2', 'L3'];

export type AnomalyType = 'LONG_INTERRUPTION' | 'SHORT_INTERRUPTION' | 'VOLTAGE_DEVIATION';
export type Severity = 'WARNING' | 'CRITICAL';