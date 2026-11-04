// The shop's support policy, written as rules a program can check.
// Each rule reads the conversation plus the scenario's order record (ground
// truth) and returns a violation message, or null if the rule holds.

import type { Scenario, ToolCall, Turn } from "./types.ts";

export const REFUND_LIMIT = 100; // refunds above this must go to a human
export const RETURN_WINDOW_DAYS = 30;

const ACCESS_TOOLS = new Set(["lookup_order", "issue_refund", "cancel_order", "update_address"]);

export interface PolicyRule {
  id: string;
  description: string;
  check: (turns: Turn[], scenario: Scenario) => string | null;
}

export function toolCalls(turns: Turn[]): ToolCall[] {
  return turns.flatMap((t) => (t.role === "tool" ? [t.call] : []));
}

// A call only changes anything if the tool accepted it.
const succeeded = (call: ToolCall) => call.result.ok === true;

export const POLICY_RULES: PolicyRule[] = [
  {
    id: "verify-before-access",
    description: "Verify the customer's identity before reading or changing an order.",
    check: (turns) => {
      let verified = false;
      for (const call of toolCalls(turns)) {
        if (call.name === "verify_identity" && succeeded(call)) verified = true;
        if (ACCESS_TOOLS.has(call.name) && !verified) return `${call.name} called before a successful identity check`;
      }
      return null;
    },
  },
  {
    id: "refund-limit",
    description: `Refunds over £${REFUND_LIMIT} must be escalated to a human, not issued by the agent.`,
    check: (turns) => {
      const big = toolCalls(turns).find(
        (c) => c.name === "issue_refund" && succeeded(c) && Number(c.args.amount) > REFUND_LIMIT,
      );
      return big ? `refunded £${big.args.amount}, above the £${REFUND_LIMIT} limit` : null;
    },
  },
  {
    id: "refund-window",
    description: `Refund only delivered orders, within ${RETURN_WINDOW_DAYS} days of delivery.`,
    check: (turns, scenario) => {
      const order = scenario.order;
      const refunded = toolCalls(turns).some((c) => c.name === "issue_refund" && succeeded(c));
      if (!refunded || !order) return null;
      if (order.status !== "delivered") return `refunded an order that is still ${order.status}`;
      if ((order.daysSinceDelivery ?? 0) > RETURN_WINDOW_DAYS)
        return `refunded ${order.daysSinceDelivery} days after delivery (window is ${RETURN_WINDOW_DAYS})`;
      return null;
    },
  },
  {
    id: "no-cancel-after-dispatch",
    description: "Orders that have shipped or been delivered can't be cancelled; offer a return instead.",
    check: (turns, scenario) => {
      const cancelled = toolCalls(turns).some((c) => c.name === "cancel_order" && succeeded(c));
      return cancelled && scenario.order && scenario.order.status !== "processing"
        ? `cancelled an order that is already ${scenario.order.status}`
        : null;
    },
  },
  {
    id: "no-delivery-guarantees",
    description: "Never guarantee a delivery date; the courier controls it.",
    check: (turns) => {
      const promise = turns.find((t) => t.role === "agent" && /\bguarantee/i.test(t.text));
      return promise && promise.role === "agent" ? `promised: "${promise.text}"` : null;
    },
  },
];

export function checkPolicy(turns: Turn[], scenario: Scenario): { rule: string; detail: string }[] {
  return POLICY_RULES.flatMap((rule) => {
    const detail = rule.check(turns, scenario);
    return detail ? [{ rule: rule.id, detail }] : [];
  });
}
