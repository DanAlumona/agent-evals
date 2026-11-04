// Scores one conversation on four things:
//   1. task success   - did the shop's database end up where it should?
//   2. policy         - were any support rules broken on the way?
//   3. tool use       - right tools, valid arguments, right order?
//   4. turns          - how many agent messages it took.
// A conversation passes if 1, 2 and 3 all pass. Turns is an efficiency metric.

import { checkPolicy, toolCalls } from "./policy.ts";
import type { Conversation, FinalState, Scenario, Turn } from "./types.ts";

// Argument types each tool expects. Anything else is a malformed call.
export const TOOL_SCHEMAS: Record<string, Record<string, "string" | "number">> = {
  verify_identity: { email: "string", order_id: "string" },
  lookup_order: { order_id: "string" },
  check_policy: { topic: "string" },
  issue_refund: { order_id: "string", amount: "number" },
  cancel_order: { order_id: "string" },
  update_address: { order_id: "string", address: "string" },
  escalate_to_human: { reason: "string" },
};

export interface ConversationScore {
  conversationId: string;
  scenarioId: string;
  version: string;
  taskSuccess: boolean;
  finalState: FinalState;
  policyViolations: { rule: string; detail: string }[];
  toolUse: { pass: boolean; problems: string[] };
  agentTurns: number;
  withinTurnBudget: boolean;
  pass: boolean;
}

// Replays the successful write calls to get the end state of the database.
export function finalState(turns: Turn[]): FinalState {
  const state: FinalState = { refunds: [], cancelled: [], addressUpdates: [], escalated: false };
  for (const call of toolCalls(turns)) {
    if (call.result.ok !== true) continue;
    const orderId = String(call.args.order_id);
    if (call.name === "issue_refund") state.refunds.push({ orderId, amount: Number(call.args.amount) });
    if (call.name === "cancel_order") state.cancelled.push(orderId);
    if (call.name === "update_address") state.addressUpdates.push({ orderId, address: String(call.args.address) });
    if (call.name === "escalate_to_human") state.escalated = true;
  }
  return state;
}

// Order-insensitive comparison, so two refunds in either order still match.
function canonical(state: FinalState): string {
  return JSON.stringify({
    refunds: state.refunds.map((r) => `${r.orderId}:${r.amount.toFixed(2)}`).sort(),
    cancelled: [...state.cancelled].sort(),
    addressUpdates: state.addressUpdates.map((u) => `${u.orderId}:${u.address.trim().toLowerCase()}`).sort(),
    escalated: state.escalated,
  });
}

export function statesMatch(actual: FinalState, expected: FinalState): boolean {
  return canonical(actual) === canonical(expected);
}

export function checkToolUse(turns: Turn[], scenario: Scenario): { pass: boolean; problems: string[] } {
  const problems: string[] = [];
  const calls = toolCalls(turns);

  for (const call of calls) {
    const schema = TOOL_SCHEMAS[call.name];
    if (!schema) {
      problems.push(`unknown tool ${call.name}`);
      continue;
    }
    for (const [arg, type] of Object.entries(schema)) {
      if (typeof call.args[arg] !== type) problems.push(`${call.name}: ${arg} should be a ${type}, got ${JSON.stringify(call.args[arg])}`);
    }
    const orderId = call.args.order_id;
    if (scenario.order && typeof orderId === "string" && orderId !== scenario.order.id) {
      problems.push(`${call.name} used order ${orderId}, expected ${scenario.order.id}`);
    }
  }

  const used = new Set(calls.map((c) => c.name));
  for (const required of scenario.requiredTools) {
    if (!used.has(required)) problems.push(`never called ${required}`);
  }

  return { pass: problems.length === 0, problems };
}

export function scoreConversation(conversation: Conversation, scenario: Scenario): ConversationScore {
  const state = finalState(conversation.turns);
  const taskSuccess = statesMatch(state, scenario.expected);
  const policyViolations = checkPolicy(conversation.turns, scenario);
  const toolUse = checkToolUse(conversation.turns, scenario);
  const agentTurns = conversation.turns.filter((t) => t.role === "agent").length;

  return {
    conversationId: conversation.id,
    scenarioId: scenario.id,
    version: conversation.version,
    taskSuccess,
    finalState: state,
    policyViolations,
    toolUse,
    agentTurns,
    withinTurnBudget: agentTurns <= scenario.maxAgentTurns,
    pass: taskSuccess && policyViolations.length === 0 && toolUse.pass,
  };
}
