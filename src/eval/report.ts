// Turns per-conversation scores into the v1-vs-v2 report and the ship decision.

import { scoreConversation, type ConversationScore } from "./score.ts";
import { mcnemarExact, wilson, type Interval } from "./stats.ts";
import type { Conversation, Scenario, Version } from "./types.ts";

export const SIGNIFICANCE = 0.05;
export const MAX_EXTRA_TURNS = 1; // v2 may use at most 1 more agent turn on average

export interface VersionSummary {
  version: Version;
  n: number;
  passed: number;
  passRate: number;
  passRateCI: Interval;
  taskSuccessRate: number;
  policyCompliantRate: number;
  toolUseRate: number;
  withinTurnBudgetRate: number;
  meanAgentTurns: number;
  policyViolations: number; // conversations with at least one violation
}

export interface Guardrail {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export type Decision = "SHIP" | "DON'T SHIP" | "NEEDS MORE EVIDENCE";

export interface Report {
  scenarios: Scenario[];
  scores: ConversationScore[];
  summary: Record<Version, VersionSummary>;
  regressions: string[]; // scenario ids: v1 passed, v2 failed
  fixes: string[]; // scenario ids: v1 failed, v2 passed
  lift: number; // v2 pass rate minus v1 pass rate
  pValue: number;
  guardrails: Guardrail[];
  decision: Decision;
  reasons: string[];
}

const rate = (k: number, n: number) => (n === 0 ? 0 : k / n);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pts = (x: number) => `${(x * 100).toFixed(1)} points`;
const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

export function summarise(version: Version, scores: ConversationScore[]): VersionSummary {
  const n = scores.length;
  const count = (f: (s: ConversationScore) => boolean) => scores.filter(f).length;
  const passed = count((s) => s.pass);
  return {
    version,
    n,
    passed,
    passRate: rate(passed, n),
    passRateCI: wilson(passed, n),
    taskSuccessRate: rate(count((s) => s.taskSuccess), n),
    policyCompliantRate: rate(count((s) => s.policyViolations.length === 0), n),
    toolUseRate: rate(count((s) => s.toolUse.pass), n),
    withinTurnBudgetRate: rate(count((s) => s.withinTurnBudget), n),
    meanAgentTurns: n === 0 ? 0 : scores.reduce((sum, s) => sum + s.agentTurns, 0) / n,
    policyViolations: count((s) => s.policyViolations.length > 0),
  };
}

export function buildReport(scenarios: Scenario[], conversations: Conversation[]): Report {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const scores = conversations.map((conv) => {
    const scenario = byId.get(conv.scenarioId);
    if (!scenario) throw new Error(`conversation ${conv.id} points at unknown scenario ${conv.scenarioId}`);
    return scoreConversation(conv, scenario);
  });

  const find = (scenarioId: string, version: Version) =>
    scores.find((s) => s.scenarioId === scenarioId && s.version === version);

  // Compare only scenarios that have both versions, so the test stays paired.
  const paired = scenarios.flatMap((s) => {
    const v1 = find(s.id, "v1");
    const v2 = find(s.id, "v2");
    return v1 && v2 ? [{ scenario: s, v1, v2 }] : [];
  });

  const summary = {
    v1: summarise("v1", paired.map((p) => p.v1)),
    v2: summarise("v2", paired.map((p) => p.v2)),
  };

  const regressions = paired.filter((p) => p.v1.pass && !p.v2.pass).map((p) => p.scenario.id);
  const fixes = paired.filter((p) => !p.v1.pass && p.v2.pass).map((p) => p.scenario.id);
  const lift = summary.v2.passRate - summary.v1.passRate;
  const pValue = mcnemarExact(regressions.length, fixes.length);

  // Guardrails: things v2 must not make worse, whatever the headline says.
  const newViolations = paired
    .filter((p) => p.v1.policyViolations.length === 0 && p.v2.policyViolations.length > 0)
    .map((p) => `${p.scenario.id} (${p.v2.policyViolations.map((v) => v.rule).join(", ")})`);
  const criticalRegressions = regressions.filter((id) => byId.get(id)?.critical);
  const extraTurns = summary.v2.meanAgentTurns - summary.v1.meanAgentTurns;

  const guardrails: Guardrail[] = [
    {
      id: "no-new-policy-violations",
      label: "No new policy violations",
      pass: newViolations.length === 0,
      detail: newViolations.length ? `New in v2: ${newViolations.join("; ")}` : "v2 breaks no rule that v1 kept",
    },
    {
      id: "no-critical-regressions",
      label: "No regressions on critical scenarios",
      pass: criticalRegressions.length === 0,
      detail: criticalRegressions.length ? `Regressed: ${criticalRegressions.join(", ")}` : "None",
    },
    {
      id: "turns-not-worse",
      label: `Mean agent turns up by at most ${MAX_EXTRA_TURNS}`,
      pass: extraTurns <= MAX_EXTRA_TURNS,
      detail: `${summary.v1.meanAgentTurns.toFixed(2)} → ${summary.v2.meanAgentTurns.toFixed(2)}`,
    },
  ];

  const reasons: string[] = [];
  let decision: Decision;
  const failed = guardrails.filter((g) => !g.pass);
  const significant = lift > 0 && pValue < SIGNIFICANCE;

  if (failed.length > 0) {
    decision = "DON'T SHIP";
    reasons.push(`${plural(failed.length, "guardrail", "guardrails")} breached: ${failed.map((g) => g.label.toLowerCase()).join("; ")}.`);
  } else if (significant) {
    decision = "SHIP";
    reasons.push(`Pass rate up ${pts(lift)} (p = ${pValue.toFixed(3)}) with all guardrails holding.`);
  } else if (lift >= 0) {
    decision = "NEEDS MORE EVIDENCE";
  } else {
    decision = "DON'T SHIP";
    reasons.push(`Pass rate down ${pts(-lift)}.`);
  }
  if (!significant && lift > 0) {
    reasons.push(
      `Pass rate is up ${pts(lift)}, but that isn't proven yet: ${plural(fixes.length, "fix", "fixes")} vs ${plural(regressions.length, "regression", "regressions")} gives p = ${pValue.toFixed(3)} (needs < ${SIGNIFICANCE}). Add scenarios or repeat trials.`,
    );
  }

  return { scenarios, scores, summary, regressions, fixes, lift, pValue, guardrails, decision, reasons };
}
