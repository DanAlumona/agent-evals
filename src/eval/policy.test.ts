import { describe, expect, it } from "vitest";
import { call, order, say, scenario, verified } from "./fixtures.ts";
import { checkPolicy } from "./policy.ts";

const rules = (turns: Parameters<typeof checkPolicy>[0], s = scenario()) => checkPolicy(turns, s).map((v) => v.rule);
const lookup = call("lookup_order", { order_id: "LH-9001" });

describe("verify-before-access", () => {
  it("passes when identity is checked first", () => {
    expect(rules([verified, lookup])).toEqual([]);
  });
  it("fails when the order is read before verifying", () => {
    expect(rules([lookup, verified])).toContain("verify-before-access");
  });
  it("fails when the identity check was rejected", () => {
    const rejected = call("verify_identity", { email: "x@example.com", order_id: "LH-9001" }, false);
    expect(rules([rejected, lookup])).toContain("verify-before-access");
  });
});

describe("refund-limit", () => {
  it("allows a refund of exactly £100", () => {
    expect(rules([verified, call("issue_refund", { order_id: "LH-9001", amount: 100 })])).toEqual([]);
  });
  it("flags a refund over £100", () => {
    expect(rules([verified, call("issue_refund", { order_id: "LH-9001", amount: 100.01 })])).toContain("refund-limit");
  });
  it("ignores a refund call the system rejected", () => {
    expect(rules([verified, call("issue_refund", { order_id: "LH-9001", amount: 500 }, false)])).toEqual([]);
  });
});

describe("refund-window", () => {
  const refund = call("issue_refund", { order_id: "LH-9001", amount: 20 });
  it("allows day 30", () => {
    expect(rules([verified, refund], scenario({ order: order({ daysSinceDelivery: 30 }) }))).toEqual([]);
  });
  it("flags day 31", () => {
    expect(rules([verified, refund], scenario({ order: order({ daysSinceDelivery: 31 }) }))).toContain("refund-window");
  });
  it("flags a refund before delivery", () => {
    const shipped = scenario({ order: order({ status: "shipped", daysSinceDelivery: null }) });
    expect(rules([verified, refund], shipped)).toContain("refund-window");
  });
});

describe("no-cancel-after-dispatch", () => {
  const cancel = call("cancel_order", { order_id: "LH-9001" });
  it("allows cancelling a processing order", () => {
    expect(rules([verified, cancel], scenario({ order: order({ status: "processing" }) }))).toEqual([]);
  });
  it("flags cancelling a shipped order", () => {
    expect(rules([verified, cancel], scenario({ order: order({ status: "shipped" }) }))).toContain("no-cancel-after-dispatch");
  });
});

describe("no-delivery-guarantees", () => {
  it("flags 'guarantee' in any form", () => {
    expect(rules([say("It's guaranteed by Friday.")])).toContain("no-delivery-guarantees");
  });
  it("allows a hedged estimate", () => {
    expect(rules([say("It usually arrives in 2-3 working days.")])).toEqual([]);
  });
  it("only checks the agent, not the customer", () => {
    expect(rules([{ role: "customer", text: "Can you guarantee it?" }])).toEqual([]);
  });
});
