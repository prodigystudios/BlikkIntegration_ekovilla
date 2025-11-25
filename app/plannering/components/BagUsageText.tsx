"use client";
import React from 'react';

export type BagUsageStatus = { plan: number; used: number; remaining: number; overrun: number };

interface BagUsageTextProps {
  status?: BagUsageStatus;
  plan?: number | null;
  jobType?: string | null;
  jobTypeColors?: Record<string, string>;
  defaultColor?: string;
}

/**
 * Renders standardized bag usage text with remaining, used and optional overrun indicator.
 * Format examples:
 *   Kvar: 12 / 40 (Blåsta: 28)
 *   Kvar: 0 / 40 (Blåsta: 45 • Överskridning: +5)
 *   Plan: 40 säckar            (no usage yet, no status map available)
 * If plan missing: returns empty unless jobType is present.
 */
export function BagUsageText({ status, plan, jobType, jobTypeColors, defaultColor }: BagUsageTextProps) {
  const jobTypeSpan = jobType ? (
    <span style={{ color: (jobTypeColors && jobTypeColors[jobType]) || defaultColor, textShadow: '0 1px 2px rgba(129,126,126,0.1)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
      {jobType.toLocaleUpperCase('sv-SE')}
    </span>
  ) : null;

  if (typeof plan === 'number' && plan >= 0) {
    if (status) {
      const base = `Kvar: ${status.remaining} / ${status.plan}`;
      const usedPart = status.used > 0 ? ` (Blåsta: ${status.used}` + (status.overrun > 0 ? ` • Överskridning: +${status.overrun}` : '') + ')' : '';
      return (
        <>
          {base + usedPart}
          {jobTypeSpan ? ' • ' : ''}
          {jobTypeSpan}
        </>
      );
    } else {
      // No status yet (e.g., data not loaded) – show original planned
      return (
        <>
          {`Plan: ${plan} säckar`}
          {jobTypeSpan ? ' • ' : ''}
          {jobTypeSpan}
        </>
      );
    }
  }

  // No plan specified – only show job type if available
  return jobTypeSpan ? jobTypeSpan : null;
}

export default BagUsageText;