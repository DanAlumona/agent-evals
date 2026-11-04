// Tiny builders for tests: one order, one scenario, and turns written inline.

import type { Order, Scenario, Turn } from "./types.ts";

export const order = (overrides: Partial<Order> = {}): Order => ({
  id: "LH-9001",
  email: "test@example.com",
  status: "delivered",
  total: 50,
  items: [{ sku: "SKU-1", name: "Test item", price: 50 }],
  daysSinceDelivery: 5,
  shippingAddress: "1 Test Road",
  ...overrides,
});

export const scenario = (overrides: Partial<Scenario> = {}): Scenario => ({
  id: "T01",
  title: "Test",
  intent: "Test",
  critical: false,
  customer: { name: "Test", email: "test@example.com" },
  order: order(),
  expected: { refunds: [], cancelled: [], addressUpdates: [], escalated: false },
  requiredTools: [],
  maxAgentTurns: 6,
  ...overrides,
});

export const call = (name: string, args: Record<string, unknown>, ok = true): Turn => ({
  role: "tool",
  call: { name, args, result: ok ? { ok: true } : { ok: false, error: "rejected" } },
});

export const verified = call("verify_identity", { email: "test@example.com", order_id: "LH-9001" });
export const say = (text: string): Turn => ({ role: "agent", text });
