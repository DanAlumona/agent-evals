# agent-evals

Deterministic evals for a customer-service AI agent, and a ship / don't-ship readout for a new version.

Two versions of a support agent for an invented shop, Larkspur Home, each handle the same 24 customer scenarios (48 conversations). Every conversation is scored on:

| Check | Question | How |
|---|---|---|
| **Task success** | Did the shop's database end up where it should? | Replay the agent's successful tool calls (refunds, cancellations, address changes, escalations) and compare the end state to the scenario's expected state |
| **Policy compliance** | Did the agent break a support rule on the way? | Five rules written as code: verify identity first, no refunds over £100 without a human, 30-day refund window, no cancelling shipped orders, never guarantee delivery dates |
| **Tool use** | Right tools, valid arguments, right order ID? | Check every call against a small schema; check the required tools were called |
| **Turns** | How long did it take? | Count agent messages against a per-scenario budget (efficiency metric, not a pass condition) |

A conversation **passes** only if task success, policy and tool use all hold. The report then compares v1 and v2:

- pass rate per version with a **Wilson 95% confidence interval**;
- **fixes and regressions** per scenario, with an **exact McNemar test** (the versions ran the same scenarios, so the comparison is paired);
- **guardrails** v2 must not break, whatever the headline: no new policy violations, no regressions on critical scenarios, no big rise in turns;
- a decision: **SHIP**, **DON'T SHIP** or **NEEDS MORE EVIDENCE**.

## The result on this dataset

v2 passes 20/24 scenarios against v1's 14/24 (+25 points), but it **refunds a £149 rug without escalating** (scenario S05), a critical scenario v1 handled correctly. Two guardrails fail, so the readout is **DON'T SHIP**. Even with that fixed, 7 fixes against 1 regression gives p = 0.070: the gain isn't proven yet at 24 scenarios.

That's the point of the project: a better headline number isn't enough to ship an agent change.

## Run it

Needs Node.js 22.18 or later (the scripts run TypeScript directly with Node's built-in type stripping).

```bash
npm install
npm test          # unit tests for the scoring rules and statistics
npm run eval      # prints the readout and writes reports/results.json
npm run dev       # the React report at http://localhost:5173
npm run build     # type-check and build the static report into dist/
```

`npm run eval -- --gate` exits with an error unless the decision is SHIP, so it can block a merge in CI.

To change the dataset, edit `scripts/build-dataset.ts` and run `npm run dataset`.

## Layout

```
data/                 scenarios.json, conversations.json (generated, committed)
scripts/
  build-dataset.ts    writes the synthetic dataset
src/eval/
  types.ts            data shapes
  policy.ts           the five support rules
  score.ts            scores one conversation
  stats.ts            Wilson interval, exact McNemar test
  report.ts           v1 vs v2 comparison, guardrails, decision
  *.test.ts           vitest unit tests
src/cli.ts            command-line runner
src/ui/               React report (Vite)
.github/workflows/    CI: tests, build, eval readout
```

## Design credit

The approach is inspired by **τ-bench** (Yao, Shinn, Razavi and Narasimhan, 2024, *τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains*, arXiv:2406.12045, from Sierra): judge a tool-using agent by the database state it leaves behind and by whether it followed the domain policy, instead of by how its replies read. No τ-bench code or data is used here; the shop, policy, scenarios and transcripts are all invented.

Differences from τ-bench: the conversations here are fixed transcripts rather than live runs against a simulated user, so the eval is fully deterministic and needs no model or API key. τ-bench's pass^k (does the agent succeed on *every* one of k repeated trials?) is the natural next step once the scenarios are run live.

## Limits

- The transcripts were written to show common failure modes; they are not a sample of real traffic.
- Rule checks are deliberately simple (the delivery-promise rule is a word match). Real policies need more nuanced graders, and some need a human or a model to judge.
- 24 paired scenarios can only detect large changes. The readout says so rather than hiding it.

## Versions

Built and tested with Node.js 24.22.2, npm 11.19.1, TypeScript 7.0.2, React 19.3.1, Vite 8.3.5, Vitest 5.1.0, @vitejs/plugin-react 6.2.1.

## Licence

MIT. All data is synthetic.
