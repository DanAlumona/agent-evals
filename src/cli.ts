// Command-line runner: scores the dataset, prints the readout, writes reports/results.json.
// Run: npm run eval            (always exits 0)
//      npm run eval -- --gate  (exits 1 unless the decision is SHIP: use as a CI gate)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildReport } from "./eval/report.ts";
import type { Conversation, Scenario } from "./eval/types.ts";

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

const scenarios = readJson<Scenario[]>("data/scenarios.json");
const conversations = readJson<Conversation[]>("data/conversations.json");
const report = buildReport(scenarios, conversations);

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const { v1, v2 } = report.summary;

console.log(`\nAgent evals: ${scenarios.length} scenarios, ${conversations.length} conversations\n`);
console.table({
  "pass rate": { v1: pct(v1.passRate), v2: pct(v2.passRate) },
  "95% CI": {
    v1: `${pct(v1.passRateCI.low)} – ${pct(v1.passRateCI.high)}`,
    v2: `${pct(v2.passRateCI.low)} – ${pct(v2.passRateCI.high)}`,
  },
  "task success": { v1: pct(v1.taskSuccessRate), v2: pct(v2.taskSuccessRate) },
  "policy compliant": { v1: pct(v1.policyCompliantRate), v2: pct(v2.policyCompliantRate) },
  "correct tool use": { v1: pct(v1.toolUseRate), v2: pct(v2.toolUseRate) },
  "mean agent turns": { v1: v1.meanAgentTurns.toFixed(2), v2: v2.meanAgentTurns.toFixed(2) },
});

console.log(`Fixes (v1 fail → v2 pass): ${report.fixes.join(", ") || "none"}`);
console.log(`Regressions (v1 pass → v2 fail): ${report.regressions.join(", ") || "none"}`);
console.log(`Lift: ${(report.lift * 100).toFixed(1)} points, McNemar exact p = ${report.pValue.toFixed(3)}\n`);
for (const g of report.guardrails) console.log(`${g.pass ? "PASS" : "FAIL"}  ${g.label}: ${g.detail}`);
console.log(`\nDecision: ${report.decision}`);
for (const r of report.reasons) console.log(`  - ${r}`);

mkdirSync("reports", { recursive: true });
writeFileSync("reports/results.json", JSON.stringify(report, null, 2) + "\n");
console.log("\nWrote reports/results.json");

if (process.argv.includes("--gate") && report.decision !== "SHIP") process.exit(1);
