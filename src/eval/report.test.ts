import { describe, expect, it } from "vitest";
import { call, say, scenario, verified } from "./fixtures.ts";
import { buildReport } from "./report.ts";
import { mcnemarExact, wilson } from "./stats.ts";
import type { Conversation, Scenario, Turn } from "./types.ts";

describe("wilson", () => {
  it("matches a published value (8/10 → 49.0%–94.3%)", () => {
    const ci = wilson(8, 10);
    expect(ci.low).toBeCloseTo(0.49, 2);
    expect(ci.high).toBeCloseTo(0.943, 2);
  });
  it("stays inside 0..1 at the extremes", () => {
    expect(wilson(0, 5).low).toBe(0);
    expect(wilson(5, 5).high).toBe(1);
  });
});

describe("mcnemarExact", () => {
  it("is 1 when there are no disagreements", () => {
    expect(mcnemarExact(0, 0)).toBe(1);
  });
  it("gives 2 × 0.5^6 for 6 fixes and no regressions", () => {
    expect(mcnemarExact(0, 6)).toBeCloseTo(0.03125, 6);
  });
  it("is symmetric", () => {
    expect(mcnemarExact(1, 7)).toBeCloseTo(mcnemarExact(7, 1), 10);
  });
});

// Builds a report where each scenario's v1/v2 result is set by hand.
const pass: Turn[] = [verified, say("Done.")];
const failPolicy: Turn[] = [verified, say("Guaranteed by Friday.")];

function report(rows: { v1: Turn[]; v2: Turn[]; critical?: boolean }[]) {
  const scenarios: Scenario[] = rows.map((r, i) => scenario({ id: `T${i}`, critical: r.critical ?? false }));
  const conversations: Conversation[] = rows.flatMap((r, i) => [
    { id: `T${i}-v1`, scenarioId: `T${i}`, version: "v1" as const, turns: r.v1 },
    { id: `T${i}-v2`, scenarioId: `T${i}`, version: "v2" as const, turns: r.v2 },
  ]);
  return buildReport(scenarios, conversations);
}

describe("buildReport decision", () => {
  it("ships a significant improvement with guardrails intact", () => {
    const r = report([...Array(6).fill({ v1: failPolicy, v2: pass }), ...Array(4).fill({ v1: pass, v2: pass })]);
    expect(r.fixes).toHaveLength(6);
    expect(r.decision).toBe("SHIP");
  });

  it("blocks a better headline when a critical scenario regresses", () => {
    const r = report([...Array(8).fill({ v1: failPolicy, v2: pass }), { v1: pass, v2: failPolicy, critical: true }]);
    expect(r.regressions).toEqual(["T8"]);
    expect(r.decision).toBe("DON'T SHIP");
    expect(r.guardrails.find((g) => g.id === "no-critical-regressions")?.pass).toBe(false);
  });

  it("asks for more evidence when the gain isn't significant", () => {
    const r = report([...Array(2).fill({ v1: failPolicy, v2: pass }), ...Array(5).fill({ v1: pass, v2: pass })]);
    expect(r.decision).toBe("NEEDS MORE EVIDENCE");
  });

  it("fails the turn guardrail when v2 is much chattier", () => {
    const chatty = [verified, say("a"), say("b"), say("c"), say("Done.")];
    const r = report([{ v1: pass, v2: chatty }]);
    expect(r.guardrails.find((g) => g.id === "turns-not-worse")?.pass).toBe(false);
  });

  it("rejects a conversation for an unknown scenario", () => {
    expect(() => buildReport([], [{ id: "x", scenarioId: "nope", version: "v1", turns: [call("lookup_order", {})] }])).toThrow(/unknown scenario/);
  });
});
