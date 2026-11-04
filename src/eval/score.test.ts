import { describe, expect, it } from "vitest";
import { call, say, scenario, verified } from "./fixtures.ts";
import { checkToolUse, finalState, scoreConversation, statesMatch } from "./score.ts";

const lookup = call("lookup_order", { order_id: "LH-9001" });
const refund20 = call("issue_refund", { order_id: "LH-9001", amount: 20 });

describe("finalState", () => {
  it("records only calls the system accepted", () => {
    const state = finalState([refund20, call("cancel_order", { order_id: "LH-9001" }, false)]);
    expect(state.refunds).toEqual([{ orderId: "LH-9001", amount: 20 }]);
    expect(state.cancelled).toEqual([]);
  });
});

describe("statesMatch", () => {
  const empty = { refunds: [], cancelled: [], addressUpdates: [], escalated: false };
  it("ignores the order of refunds", () => {
    const a = { ...empty, refunds: [{ orderId: "A", amount: 1 }, { orderId: "B", amount: 2 }] };
    const b = { ...empty, refunds: [{ orderId: "B", amount: 2 }, { orderId: "A", amount: 1 }] };
    expect(statesMatch(a, b)).toBe(true);
  });
  it("catches a wrong refund amount", () => {
    expect(statesMatch({ ...empty, refunds: [{ orderId: "A", amount: 72 }] }, { ...empty, refunds: [{ orderId: "A", amount: 18 }] })).toBe(false);
  });
  it("treats an unneeded escalation as a different end state", () => {
    expect(statesMatch({ ...empty, escalated: true }, empty)).toBe(false);
  });
});

describe("checkToolUse", () => {
  it("passes valid calls that cover the required tools", () => {
    const s = scenario({ requiredTools: ["verify_identity", "lookup_order"] });
    expect(checkToolUse([verified, lookup], s).pass).toBe(true);
  });
  it("flags a string where a number is needed", () => {
    const bad = call("issue_refund", { order_id: "LH-9001", amount: "£20" }, false);
    expect(checkToolUse([verified, bad], scenario()).problems[0]).toMatch(/amount should be a number/);
  });
  it("flags an unknown tool", () => {
    expect(checkToolUse([call("delete_customer", {})], scenario()).problems).toContain("unknown tool delete_customer");
  });
  it("flags the wrong order id", () => {
    expect(checkToolUse([call("lookup_order", { order_id: "LH-0000" })], scenario()).pass).toBe(false);
  });
  it("flags a missing required tool", () => {
    const s = scenario({ requiredTools: ["escalate_to_human"] });
    expect(checkToolUse([verified], s).problems).toContain("never called escalate_to_human");
  });
});

describe("scoreConversation", () => {
  const s = scenario({
    expected: { refunds: [{ orderId: "LH-9001", amount: 20 }], cancelled: [], addressUpdates: [], escalated: false },
    requiredTools: ["verify_identity", "issue_refund"],
    maxAgentTurns: 2,
  });

  it("passes a clean, successful conversation", () => {
    const score = scoreConversation({ id: "c", scenarioId: "T01", version: "v1", turns: [verified, refund20, say("Done.")] }, s);
    expect(score.pass).toBe(true);
    expect(score.agentTurns).toBe(1);
  });

  it("fails on a policy violation even when the task succeeded", () => {
    const turns = [verified, refund20, say("Refunded, and your next order is guaranteed by Friday.")];
    const score = scoreConversation({ id: "c", scenarioId: "T01", version: "v1", turns }, s);
    expect(score.taskSuccess).toBe(true);
    expect(score.pass).toBe(false);
  });

  it("reports going over the turn budget without failing the conversation", () => {
    const turns = [verified, say("One moment."), say("Still looking."), refund20, say("Done.")];
    const score = scoreConversation({ id: "c", scenarioId: "T01", version: "v1", turns }, s);
    expect(score.withinTurnBudget).toBe(false);
    expect(score.pass).toBe(true);
  });
});
