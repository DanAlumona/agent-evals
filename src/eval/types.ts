// Shared types for the dataset, the scorer and the report.

export type Version = "v1" | "v2";

export type ToolName =
  | "verify_identity"
  | "lookup_order"
  | "check_policy"
  | "issue_refund"
  | "cancel_order"
  | "update_address"
  | "escalate_to_human";

export interface OrderItem {
  sku: string;
  name: string;
  price: number;
}

// One row of the shop's (invented) order database.
export interface Order {
  id: string;
  email: string;
  status: "processing" | "shipped" | "delivered";
  total: number;
  items: OrderItem[];
  daysSinceDelivery: number | null; // null until delivered
  shippingAddress: string;
}

export interface ToolCall {
  name: string; // a string, not ToolName: the agent can call a tool that doesn't exist
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

export type Turn =
  | { role: "customer"; text: string }
  | { role: "agent"; text: string }
  | { role: "tool"; call: ToolCall };

// What the shop's database should look like after the conversation.
// Task success = the actual end state equals this (the tau-bench idea).
export interface FinalState {
  refunds: { orderId: string; amount: number }[];
  cancelled: string[];
  addressUpdates: { orderId: string; address: string }[];
  escalated: boolean;
}

export interface Scenario {
  id: string;
  title: string;
  intent: string; // what the customer wants, in one line
  critical: boolean; // money or trust at stake: a regression here blocks a ship
  customer: { name: string; email: string };
  order: Order | null; // null for general questions
  expected: FinalState;
  requiredTools: ToolName[];
  maxAgentTurns: number;
}

export interface Conversation {
  id: string;
  scenarioId: string;
  version: Version;
  turns: Turn[];
}
