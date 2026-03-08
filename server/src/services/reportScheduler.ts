/**
 * Report Scheduler (Cron)
 *
 * Runs a weekly report generation job every Monday at 00:01.
 * Uses a simple setInterval approach (no external cron library needed).
 */

import { generateAllWeeklyReports } from './reportGenerator.js';

/** Milliseconds until next Monday 00:01 local time */
function msUntilNextMonday0001(): number {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, …

  // Days until next Monday (if today is Monday and past 00:01, wait 7 days)
  let daysUntil = (1 - day + 7) % 7;
  if (daysUntil === 0) {
    // It's Monday — check if we're past 00:01
    const todayTarget = new Date(now);
    todayTarget.setHours(0, 1, 0, 0);
    if (now >= todayTarget) daysUntil = 7;
  }

  const target = new Date(now);
  target.setDate(now.getDate() + daysUntil);
  target.setHours(0, 1, 0, 0);

  return target.getTime() - now.getTime();
}

const ONE_WEEK_MS = 7 * 24 * 3600_000;

let initialTimer: ReturnType<typeof setTimeout> | null = null;
let weeklyInterval: ReturnType<typeof setInterval> | null = null;
let currentNextRun: Date | null = null;

export function getSchedulerStatus() {
  return {
    isRunning: initialTimer !== null || weeklyInterval !== null,
    nextRun: currentNextRun ? currentNextRun.toISOString() : null,
  };
}

async function runWeeklyJob(): Promise<void> {
  console.log('[ReportScheduler] Running weekly report generation…');
  try {
    const reports = await generateAllWeeklyReports();
    console.log('[ReportScheduler] Generated %d weekly report(s).', reports.length);
  } catch (err) {
    console.error('[ReportScheduler] Weekly report generation failed:', err);
  }
}

/** Start the weekly cron scheduler */
export function startReportScheduler(): void {
  // Prevent double starts
  if (initialTimer || weeklyInterval) {
    console.log('[ReportScheduler] Scheduler is already running.');
    return;
  }

  const delayMs = msUntilNextMonday0001();
  const nextRun = new Date(Date.now() + delayMs);
  currentNextRun = nextRun;

  console.log(
    '[ReportScheduler] Next weekly report run: %s (in %s hours)',
    nextRun.toISOString(),
    (delayMs / 3600_000).toFixed(1),
  );

  initialTimer = setTimeout(() => {
    runWeeklyJob();

    // Then repeat every 7 days
    weeklyInterval = setInterval(() => {
      currentNextRun = new Date(Date.now() + ONE_WEEK_MS);
      runWeeklyJob();
    }, ONE_WEEK_MS);
  }, delayMs);
}

/** Stop the scheduler (for graceful shutdown) */
export function stopReportScheduler(): void {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (weeklyInterval) {
    clearInterval(weeklyInterval);
    weeklyInterval = null;
  }
  currentNextRun = null;
  console.log('[ReportScheduler] Stopped.');
}
