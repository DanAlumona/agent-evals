// The report page. It runs the same scoring code as the CLI, in the browser,
// over the same JSON files, so the page can never drift from `npm run eval`.

import { useMemo, useState } from "react";
import conversationsJson from "../../data/conversations.json";
import scenariosJson from "../../data/scenarios.json";
import { buildReport, type Report, type VersionSummary } from "../eval/report.ts";
import type { ConversationScore } from "../eval/score.ts";
import type { Conversation, Scenario, Version } from "../eval/types.ts";

const scenarios = scenariosJson as unknown as Scenario[];
const conversations = conversationsJson as unknown as Conversation[];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signed = (x: number, digits = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(digits)}`;

type Filter = "all" | "failing" | "changed";

export function App() {
  const report = useMemo(() => buildReport(scenarios, conversations), []);
  const [filter, setFilter] = useState<Filter>("failing");
  const [selected, setSelected] = useState<{ scenarioId: string; version: Version } | null>({
    scenarioId: report.regressions[0] ?? scenarios[0].id,
    version: "v2",
  });

  const score = (scenarioId: string, version: Version) =>
    report.scores.find((s) => s.scenarioId === scenarioId && s.version === version);

  const rows = scenarios.filter((s) => {
    const v1 = score(s.id, "v1");
    const v2 = score(s.id, "v2");
    if (filter === "failing") return !v1?.pass || !v2?.pass;
    if (filter === "changed") return v1?.pass !== v2?.pass;
    return true;
  });

  return (
    <main>
      <header className="page-header">
        <p className="eyebrow">Agent evals · Larkspur Home support agent (synthetic)</p>
        <h1>Should v2 replace v1?</h1>
        <p className="lede">
          {scenarios.length} customer-service scenarios, each run by both agent versions ({conversations.length}{" "}
          conversations). Every conversation is scored on task success, policy compliance and tool use; it passes only if
          all three hold.
        </p>
      </header>

      <Decision report={report} />
      <Headline report={report} />

      <section className="card">
        <h2>Pass rate with 95% confidence interval</h2>
        <IntervalChart v1={report.summary.v1} v2={report.summary.v2} />
      </section>

      <section className="card">
        <h2>v1 vs v2</h2>
        <MetricsTable v1={report.summary.v1} v2={report.summary.v2} />
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Scenarios</h2>
          <div className="filters" role="group" aria-label="Filter scenarios">
            {(["failing", "changed", "all"] as Filter[]).map((f) => (
              <button key={f} className={filter === f ? "chip active" : "chip"} onClick={() => setFilter(f)}>
                {f === "failing" ? "Any failure" : f === "changed" ? "Changed" : "All"}
              </button>
            ))}
          </div>
        </div>
        <p className="hint">Click a result to read the conversation.</p>
        <div className="split">
          <table className="scenarios">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>v1</th>
                <th>v2</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="mono muted">{s.id}</span> {s.title}
                    {s.critical && <span className="tag">critical</span>}
                    {report.regressions.includes(s.id) && <span className="tag bad">regression</span>}
                    {report.fixes.includes(s.id) && <span className="tag good">fix</span>}
                  </td>
                  {(["v1", "v2"] as Version[]).map((v) => {
                    const sc = score(s.id, v);
                    const isSelected = selected?.scenarioId === s.id && selected.version === v;
                    return (
                      <td key={v}>
                        <button
                          className={`result ${sc?.pass ? "pass" : "fail"} ${isSelected ? "selected" : ""}`}
                          onClick={() => setSelected({ scenarioId: s.id, version: v })}
                          aria-pressed={isSelected}
                        >
                          {sc?.pass ? "✓ pass" : "✕ fail"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {selected && (
            <Transcript
              scenario={scenarios.find((s) => s.id === selected.scenarioId)!}
              conversation={conversations.find((c) => c.scenarioId === selected.scenarioId && c.version === selected.version)!}
              score={score(selected.scenarioId, selected.version)!}
            />
          )}
        </div>
      </section>

      <footer>
        Synthetic data; Larkspur Home is invented. Method inspired by τ-bench (Yao et al., 2024, Sierra): judge an agent by the
        state it leaves the database in, plus the rules it follows on the way. No τ-bench data is used.
      </footer>
    </main>
  );
}

function Decision({ report }: { report: Report }) {
  const tone = report.decision === "SHIP" ? "good" : report.decision === "DON'T SHIP" ? "bad" : "warn";
  const icon = tone === "good" ? "✓" : tone === "bad" ? "✕" : "!";
  return (
    <section className={`card decision ${tone}`}>
      <div className="decision-label">
        <span className="decision-icon" aria-hidden>
          {icon}
        </span>
        <div>
          <p className="eyebrow">Readout</p>
          <p className="decision-text">{report.decision}</p>
        </div>
      </div>
      <ul className="reasons">
        {report.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <h3>Guardrails</h3>
      <ul className="guardrails">
        {report.guardrails.map((g) => (
          <li key={g.id} className={g.pass ? "ok" : "breach"}>
            <span aria-hidden>{g.pass ? "✓" : "✕"}</span>
            <strong>{g.label}</strong>
            <span className="muted">{g.pass ? "holds" : "breached"} · {g.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Headline({ report }: { report: Report }) {
  const { v1, v2 } = report.summary;
  const tiles = [
    { label: "v2 pass rate", value: pct(v2.passRate), sub: `v1 ${pct(v1.passRate)}` },
    { label: "Lift", value: `${signed(report.lift * 100)} pts`, sub: `McNemar p = ${report.pValue.toFixed(3)}` },
    { label: "Fixes / regressions", value: `${report.fixes.length} / ${report.regressions.length}`, sub: "scenarios that changed" },
    { label: "Policy breaches", value: `${v2.policyViolations}`, sub: `conversations in v2 (v1: ${v1.policyViolations})` },
  ];
  return (
    <section className="tiles">
      {tiles.map((t) => (
        <div className="card tile" key={t.label}>
          <p className="tile-label">{t.label}</p>
          <p className="tile-value">{t.value}</p>
          <p className="tile-sub">{t.sub}</p>
        </div>
      ))}
    </section>
  );
}

// One row per version: a dot at the pass rate, a line across its 95% interval.
function IntervalChart({ v1, v2 }: { v1: VersionSummary; v2: VersionSummary }) {
  const [hover, setHover] = useState<Version | null>(null);
  const W = 640, rowH = 44, left = 44, right = 16, top = 8;
  const x = (p: number) => left + p * (W - left - right);
  const rows = [v1, v2];
  const H = top + rows.length * rowH + 28;
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Pass rate: v1 ${pct(v1.passRate)}, v2 ${pct(v2.passRate)}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={top + rows.length * rowH} className="grid" />
            <text x={x(t)} y={H - 8} textAnchor="middle" className="axis">
              {t * 100}%
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = top + i * rowH + rowH / 2;
          const cls = r.version === "v1" ? "s1" : "s2";
          return (
            <g key={r.version} onMouseEnter={() => setHover(r.version)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill="transparent" />
              <text x={0} y={y + 4} className="axis-label">
                {r.version}
              </text>
              <line x1={x(r.passRateCI.low)} x2={x(r.passRateCI.high)} y1={y} y2={y} className={`ci ${cls}`} />
              <circle cx={x(r.passRate)} cy={y} r={hover === r.version ? 7 : 5.5} className={`dot ${cls}`} />
              <text x={x(r.passRateCI.high) + 8} y={y + 4} className="value-label">
                {pct(r.passRate)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="tooltip" role="status">
          {(() => {
            const r = hover === "v1" ? v1 : v2;
            return (
              <>
                <strong>{r.version}</strong>: {r.passed}/{r.n} passed ({pct(r.passRate)}), 95% CI {pct(r.passRateCI.low)}–
                {pct(r.passRateCI.high)}
              </>
            );
          })()}
        </div>
      )}
      <p className="hint">
        The intervals overlap, which is why the readout also uses a paired test: both versions ran the same scenarios.
      </p>
    </div>
  );
}

function MetricsTable({ v1, v2 }: { v1: VersionSummary; v2: VersionSummary }) {
  const rows: [string, number, number][] = [
    ["Pass (all three)", v1.passRate, v2.passRate],
    ["Task success", v1.taskSuccessRate, v2.taskSuccessRate],
    ["Policy compliant", v1.policyCompliantRate, v2.policyCompliantRate],
    ["Correct tool use", v1.toolUseRate, v2.toolUseRate],
    ["Within turn budget", v1.withinTurnBudgetRate, v2.withinTurnBudgetRate],
  ];
  return (
    <table className="metrics">
      <thead>
        <tr>
          <th>Metric</th>
          <th className="num">v1</th>
          <th className="num">v2</th>
          <th className="num">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, a, b]) => (
          <tr key={label}>
            <td>{label}</td>
            <td className="num">{pct(a)}</td>
            <td className="num">{pct(b)}</td>
            <td className="num">{signed((b - a) * 100)} pts</td>
          </tr>
        ))}
        <tr>
          <td>Mean agent turns</td>
          <td className="num">{v1.meanAgentTurns.toFixed(2)}</td>
          <td className="num">{v2.meanAgentTurns.toFixed(2)}</td>
          <td className="num">{signed(v2.meanAgentTurns - v1.meanAgentTurns, 2)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function Transcript({ scenario, conversation, score }: { scenario: Scenario; conversation: Conversation; score: ConversationScore }) {
  return (
    <aside className="transcript" aria-label="Conversation">
      <p className="eyebrow">
        {conversation.id} · {scenario.critical ? "critical · " : ""}
        {score.pass ? "pass" : "fail"}
      </p>
      <h3>{scenario.title}</h3>
      <p className="muted">{scenario.intent}</p>

      <ol className="turns">
        {conversation.turns.map((t, i) =>
          t.role === "tool" ? (
            <li key={i} className="turn tool">
              <code>
                {t.call.name}({JSON.stringify(t.call.args)}) → {t.call.result.ok === true ? "ok" : String(t.call.result.error)}
              </code>
            </li>
          ) : (
            <li key={i} className={`turn ${t.role}`}>
              <span className="who">{t.role === "agent" ? "Agent" : "Customer"}</span>
              {t.text}
            </li>
          ),
        )}
      </ol>

      <dl className="checks">
        <dt>Task success</dt>
        <dd>{score.taskSuccess ? "✓ reached the expected end state" : `✕ ended in ${describeState(score.finalState)}; expected ${describeState(scenario.expected)}`}</dd>
        <dt>Policy</dt>
        <dd>{score.policyViolations.length ? score.policyViolations.map((v) => `✕ ${v.rule}: ${v.detail}`).join("; ") : "✓ no rule broken"}</dd>
        <dt>Tool use</dt>
        <dd>{score.toolUse.pass ? "✓ valid calls, required tools used" : score.toolUse.problems.map((p) => `✕ ${p}`).join("; ")}</dd>
        <dt>Agent turns</dt>
        <dd>
          {score.agentTurns} (budget {scenario.maxAgentTurns}){score.withinTurnBudget ? "" : " · over budget"}
        </dd>
      </dl>
    </aside>
  );
}

function describeState(s: Scenario["expected"]): string {
  const parts = [
    ...s.refunds.map((r) => `refund £${r.amount}`),
    ...s.cancelled.map(() => "cancellation"),
    ...s.addressUpdates.map(() => "address update"),
    ...(s.escalated ? ["escalation"] : []),
  ];
  return parts.length ? parts.join(" + ") : "no changes";
}
