export interface SuccessfulTerminalCheck {
  command: string;
  startedAt: number;
  finishedAt: number;
  exitCode: number | null;
  codeChangeVersion: number;
}

/**
 * A successful build/test only verifies the exact code generation present
 * when the command started. This prevents an old or overlapping check from
 * validating edits written while that command was running.
 */
export function hasSuccessfulTerminalVerification(
  checks: readonly SuccessfulTerminalCheck[],
  currentCodeChangeVersion: number,
  notBefore = Number.NEGATIVE_INFINITY,
): boolean {
  return checks.some((check) =>
    check.exitCode === 0 &&
    check.codeChangeVersion === currentCodeChangeVersion &&
    Number.isFinite(check.finishedAt) &&
    check.finishedAt >= notBefore,
  );
}
