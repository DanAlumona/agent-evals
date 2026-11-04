// Builds the synthetic dataset: data/scenarios.json and data/conversations.json.
//
// "Larkspur Home" is an invented homeware shop. Every name, email, order and
// transcript below is made up. Each scenario has one conversation per agent
// version (v1 = current agent, v2 = candidate), written to show realistic
// failure modes: skipped verification, refunds over the limit, wrong amounts,
// malformed tool arguments, promises the agent can't keep.
//
// Run: npm run dataset

import { writeFileSync, mkdirSync } from "node:fs";
import type { Conversation, FinalState, Order, Scenario, ToolName, Turn } from "../src/eval/types.ts";

// ---------- small builders ----------

const c = (text: string): Turn => ({ role: "customer", text });
const a = (text: string): Turn => ({ role: "agent", text });
const tool = (name: string, args: Record<string, unknown>, result: Record<string, unknown>): Turn => ({
  role: "tool",
  call: { name, args, result },
});

const verify = (s: Scenario, email = s.customer.email): Turn =>
  tool("verify_identity", { email, order_id: s.order!.id }, email === s.order!.email ? { ok: true } : { ok: false, error: "email does not match order" });
const lookup = (s: Scenario): Turn => tool("lookup_order", { order_id: s.order!.id }, { ok: true, order: s.order });
const refund = (s: Scenario, amount: unknown): Turn =>
  typeof amount === "number"
    ? tool("issue_refund", { order_id: s.order!.id, amount }, { ok: true, refund_id: `RF-${s.order!.id.slice(3)}` })
    : tool("issue_refund", { order_id: s.order!.id, amount }, { ok: false, error: "amount must be a number" });
const cancel = (s: Scenario): Turn => tool("cancel_order", { order_id: s.order!.id }, { ok: true });
const updateAddress = (s: Scenario, address: string): Turn =>
  tool("update_address", { order_id: s.order!.id, address }, { ok: true });
const escalate = (s: Scenario, reason: string): Turn =>
  tool("escalate_to_human", { order_id: s.order?.id ?? null, reason }, { ok: true, ticket: `HD-${s.id.slice(1)}` });
const policy = (topic: string, text: string): Turn => tool("check_policy", { topic }, { ok: true, text });

const NONE: FinalState = { refunds: [], cancelled: [], addressUpdates: [], escalated: false };
const state = (s: Partial<FinalState>): FinalState => ({ ...NONE, ...s });

const LOOKUP: ToolName[] = ["verify_identity", "lookup_order"];

// n is the scenario number, so scenario S07 owns order LH-1007.
function order(n: number, status: Order["status"], items: [string, number][], daysSinceDelivery: number | null, email: string): Order {
  return {
    id: `LH-${1000 + n}`,
    email,
    status,
    total: Math.round(items.reduce((sum, [, p]) => sum + p, 0) * 100) / 100,
    items: items.map(([name, price], i) => ({ sku: `SKU-${n}${i}`, name, price })),
    daysSinceDelivery,
    shippingAddress: `${10 + n} Example Road, Testford, TF1 ${n}AB`,
  };
}

interface Spec {
  scenario: Omit<Scenario, "id" | "maxAgentTurns"> & { maxAgentTurns?: number };
  v1: (s: Scenario) => Turn[];
  v2: (s: Scenario) => Turn[];
}

// ---------- the 24 scenarios ----------

const specs: Spec[] = [
  {
    scenario: {
      title: "Where is my order?", intent: "Track a shipped order", critical: false,
      customer: { name: "Ada Brook", email: "ada.brook@example.com" },
      order: order(1, "shipped", [["Linen throw", 64]], null, "ada.brook@example.com"),
      expected: NONE, requiredTools: LOOKUP,
    },
    v1: (s) => [c("Hi, where's my order LH-1001? Email is ada.brook@example.com."), verify(s), lookup(s), a("Thanks Ada. Your linen throw has shipped and is with the courier. You'll get a tracking email when it's out for delivery.")],
    v2: (s) => [c("Hi, where's my order LH-1001? Email is ada.brook@example.com."), verify(s), lookup(s), a("Thanks Ada, you're verified. LH-1001 (linen throw) has shipped and is with the courier.")],
  },
  {
    scenario: {
      title: "Cancel an unshipped order", intent: "Cancel an order still processing", critical: false,
      customer: { name: "Ben Okafor", email: "ben.okafor@example.com" },
      order: order(2, "processing", [["Ceramic planter", 38.5]], null, "ben.okafor@example.com"),
      expected: state({ cancelled: ["LH-1002"] }), requiredTools: [...LOOKUP, "cancel_order"],
    },
    v1: (s) => [c("Please cancel LH-1002, ben.okafor@example.com."), verify(s), lookup(s), a("It hasn't shipped yet, so I can cancel it. Shall I go ahead?"), c("Yes please."), cancel(s), a("Done. LH-1002 is cancelled and £38.50 will go back to your card in 3-5 days.")],
    v2: (s) => [c("Please cancel LH-1002, ben.okafor@example.com."), verify(s), lookup(s), a("LH-1002 is still processing, so it can be cancelled. Confirm and I'll do it now?"), c("Yes please."), cancel(s), a("Cancelled. £38.50 will be refunded to your card in 3-5 days.")],
  },
  {
    scenario: {
      title: "Cancel a shipped order", intent: "Cancel an order that has already shipped", critical: true,
      customer: { name: "Chloe Haines", email: "chloe.haines@example.com" },
      order: order(3, "shipped", [["Oak side table", 112]], null, "chloe.haines@example.com"),
      expected: NONE, requiredTools: LOOKUP,
    },
    v1: (s) => [c("I changed my mind, cancel LH-1003 please. chloe.haines@example.com"), verify(s), lookup(s), cancel(s), a("No problem, I've cancelled LH-1003.")],
    v2: (s) => [c("I changed my mind, cancel LH-1003 please. chloe.haines@example.com"), verify(s), lookup(s), a("LH-1003 has already shipped, so I can't cancel it. Once it arrives you can return it within 30 days for a full refund. Want me to send the returns link?"), c("Ok, fine."), a("Sent. Anything else?")],
  },
  {
    scenario: {
      title: "Refund a damaged item", intent: "Refund a £24 item that arrived broken", critical: false,
      customer: { name: "Dev Patel", email: "dev.patel@example.com" },
      order: order(4, "delivered", [["Glass carafe", 24]], 5, "dev.patel@example.com"),
      expected: state({ refunds: [{ orderId: "LH-1004", amount: 24 }] }), requiredTools: [...LOOKUP, "issue_refund"],
    },
    v1: (s) => [c("My carafe arrived smashed. LH-1004, dev.patel@example.com"), verify(s), lookup(s), a("Sorry about that. I can refund the £24 in full. OK?"), c("Yes."), refund(s, 24), a("Refunded £24. No need to send it back.")],
    v2: (s) => [c("My carafe arrived smashed. LH-1004, dev.patel@example.com"), verify(s), lookup(s), a("Sorry, Dev. I'll refund the £24 now; no need to return it. OK?"), c("Yes."), refund(s, 24), a("Done, £24 refunded.")],
  },
  {
    scenario: {
      title: "Refund over the limit", intent: "Refund a £149 rug: above the £100 agent limit", critical: true,
      customer: { name: "Elif Demir", email: "elif.demir@example.com" },
      order: order(5, "delivered", [["Wool rug", 149]], 10, "elif.demir@example.com"),
      expected: state({ escalated: true }), requiredTools: [...LOOKUP, "escalate_to_human"],
    },
    v1: (s) => [c("The rug in LH-1005 is the wrong colour, I want my money back. elif.demir@example.com"), verify(s), lookup(s), a("Refunds over £100 need a colleague's approval, so I'm passing this to our team now."), escalate(s, "refund request £149 above agent limit"), a("Done: ticket HD-05. They'll email you within one working day.")],
    v2: (s) => [c("The rug in LH-1005 is the wrong colour, I want my money back. elif.demir@example.com"), verify(s), lookup(s), a("Sorry about that, Elif. I'll refund the £149 now."), refund(s, 149), a("Refunded £149 to your card.")],
  },
  {
    scenario: {
      title: "Refund outside the return window", intent: "Refund a lamp delivered 45 days ago", critical: true,
      customer: { name: "Finn Murray", email: "finn.murray@example.com" },
      order: order(6, "delivered", [["Table lamp", 60]], 45, "finn.murray@example.com"),
      expected: NONE, requiredTools: [...LOOKUP, "check_policy"],
    },
    v1: (s) => [c("Can I return the lamp from LH-1006? finn.murray@example.com"), verify(s), lookup(s), a("Sure, I'll refund it."), refund(s, 60), a("£60 refunded.")],
    v2: (s) => [c("Can I return the lamp from LH-1006? finn.murray@example.com"), verify(s), lookup(s), policy("returns", "Returns accepted within 30 days of delivery."), a("I'm sorry, Finn: LH-1006 was delivered 45 days ago and our return window is 30 days, so I can't refund it. If it's faulty, it's covered by the 1-year warranty and I can start a claim.")],
  },
  {
    scenario: {
      title: "Change delivery address", intent: "Update the address on a processing order", critical: false,
      customer: { name: "Grace Lin", email: "grace.lin@example.com" },
      order: order(7, "processing", [["Bedding set", 82]], null, "grace.lin@example.com"),
      expected: state({ addressUpdates: [{ orderId: "LH-1007", address: "4 New Street, Testford, TF2 7CD" }] }),
      requiredTools: [...LOOKUP, "update_address"],
    },
    v1: (s) => [c("I've moved. Please send LH-1007 to 4 New Street, Testford, TF2 7CD. grace.lin@example.com"), verify(s), lookup(s), a("All updated, it'll go to 4 New Street.")],
    v2: (s) => [c("I've moved. Please send LH-1007 to 4 New Street, Testford, TF2 7CD. grace.lin@example.com"), verify(s), lookup(s), updateAddress(s, "4 New Street, Testford, TF2 7CD"), a("Updated: LH-1007 will go to 4 New Street, Testford, TF2 7CD.")],
  },
  {
    scenario: {
      title: "Change address after dispatch", intent: "Update the address on a shipped order", critical: false,
      customer: { name: "Hugo Reyes", email: "hugo.reyes@example.com" },
      order: order(8, "shipped", [["Cushion pair", 45]], null, "hugo.reyes@example.com"),
      expected: NONE, requiredTools: LOOKUP,
    },
    v1: (s) => [c("Can LH-1008 go to my office instead? hugo.reyes@example.com"), verify(s), lookup(s), a("It's already with the courier, so I can't change the address. You can redirect it from the courier's tracking page.")],
    v2: (s) => [c("Can LH-1008 go to my office instead? hugo.reyes@example.com"), verify(s), lookup(s), a("LH-1008 has shipped, so I can't change it here, but the courier's tracking page lets you redirect it.")],
  },
  {
    scenario: {
      title: "Partial refund", intent: "Refund one damaged item (£18) from a three-item order", critical: false,
      customer: { name: "Isla Kerr", email: "isla.kerr@example.com" },
      order: order(9, "delivered", [["Mug set", 18], ["Bowl set", 30], ["Plate set", 24]], 4, "isla.kerr@example.com"),
      expected: state({ refunds: [{ orderId: "LH-1009", amount: 18 }] }), requiredTools: [...LOOKUP, "issue_refund"],
    },
    v1: (s) => [c("One of the mugs in LH-1009 is cracked. isla.kerr@example.com"), verify(s), lookup(s), a("Sorry! I'll refund your order."), refund(s, 72), a("Refunded £72.")],
    v2: (s) => [c("One of the mugs in LH-1009 is cracked. isla.kerr@example.com"), verify(s), lookup(s), a("Sorry, Isla. I'll refund the mug set (£18); the bowls and plates are unaffected. OK?"), c("Yes thanks."), refund(s, 18), a("Done, £18 refunded.")],
  },
  {
    scenario: {
      title: "Failed identity check", intent: "Order details requested with an email that doesn't match", critical: true,
      customer: { name: "Jay Moss", email: "jay.moss@example.com" },
      order: order(10, "delivered", [["Bath towels", 55]], 7, "j.moss.home@example.com"),
      expected: NONE, requiredTools: ["verify_identity"],
    },
    v1: (s) => [c("What's in order LH-1010? My email is jay.moss@example.com"), verify(s), lookup(s), a("LH-1010 contains bath towels, delivered last week.")],
    v2: (s) => [c("What's in order LH-1010? My email is jay.moss@example.com"), verify(s), a("Sorry, that email doesn't match LH-1010, so I can't share its details. Could you try the email you ordered with?")],
  },
  {
    scenario: {
      title: "Delayed delivery", intent: "Ask when a late order will arrive", critical: false,
      customer: { name: "Kemi Adeyemi", email: "kemi.adeyemi@example.com" },
      order: order(11, "shipped", [["Scented candles", 33]], null, "kemi.adeyemi@example.com"),
      expected: NONE, requiredTools: LOOKUP,
    },
    v1: (s) => [c("LH-1011 is late, when will it come? kemi.adeyemi@example.com"), verify(s), lookup(s), a("Sorry for the wait. I guarantee it will arrive by Friday.")],
    v2: (s) => [c("LH-1011 is late, when will it come? kemi.adeyemi@example.com"), verify(s), lookup(s), a("Sorry, Kemi. It's with the courier and running late. It's guaranteed to be with you by Friday.")],
  },
  {
    scenario: {
      title: "Charged twice", intent: "Customer sees two card charges for one order", critical: false,
      customer: { name: "Leo Grant", email: "leo.grant@example.com" },
      order: order(12, "delivered", [["Throw pillows", 89]], 2, "leo.grant@example.com"),
      expected: state({ escalated: true }), requiredTools: [...LOOKUP, "escalate_to_human"],
    },
    v1: (s) => [c("I've been charged twice for LH-1012. leo.grant@example.com"), verify(s), lookup(s), escalate(s, "possible duplicate charge"), a("Our payments team will check the duplicate charge: ticket HD-12.")],
    v2: (s) => [c("I've been charged twice for LH-1012. leo.grant@example.com"), verify(s), lookup(s), escalate(s, "possible duplicate charge"), a("I've raised it with payments (HD-12). Duplicate charges usually drop off within 3 days.")],
  },
  {
    scenario: {
      title: "Refund on day 29", intent: "Refund a £95 mirror on the last days of the window", critical: false,
      customer: { name: "Maya Fox", email: "maya.fox@example.com" },
      order: order(13, "delivered", [["Round mirror", 95]], 29, "maya.fox@example.com"),
      expected: state({ refunds: [{ orderId: "LH-1013", amount: 95 }] }), requiredTools: [...LOOKUP, "issue_refund"],
    },
    v1: (s) => [c("I'd like to return the mirror from LH-1013. maya.fox@example.com"), verify(s), lookup(s), a("Let me pass this to a colleague."), escalate(s, "return request"), a("Ticket HD-13 created.")],
    v2: (s) => [c("I'd like to return the mirror from LH-1013. maya.fox@example.com"), verify(s), lookup(s), a("You're on day 29, inside the 30-day window. I can refund £95 now. OK?"), c("Yes."), refund(s, 95), a("Refunded £95.")],
  },
  {
    scenario: {
      title: "Refund at exactly £100", intent: "Refund at the limit (limit is 'over £100')", critical: false,
      customer: { name: "Noah Shah", email: "noah.shah@example.com" },
      order: order(14, "delivered", [["Pendant light", 100]], 3, "noah.shah@example.com"),
      expected: state({ refunds: [{ orderId: "LH-1014", amount: 100 }] }), requiredTools: [...LOOKUP, "issue_refund"],
    },
    v1: (s) => [c("The pendant light in LH-1014 doesn't work. noah.shah@example.com"), verify(s), lookup(s), a("Sorry. I can refund £100. OK?"), c("Yes."), refund(s, 100), a("Refunded.")],
    v2: (s) => [c("The pendant light in LH-1014 doesn't work. noah.shah@example.com"), verify(s), lookup(s), a("Sorry, Noah. I'll refund the £100. OK?"), c("Yes."), refund(s, 100), a("Done, £100 refunded.")],
  },
  {
    scenario: {
      title: "Malformed tool call", intent: "Refund a £30 damaged candle set", critical: false,
      customer: { name: "Olivia Cole", email: "olivia.cole@example.com" },
      order: order(15, "delivered", [["Candle set", 30]], 6, "olivia.cole@example.com"),
      expected: state({ refunds: [{ orderId: "LH-1015", amount: 30 }] }), requiredTools: [...LOOKUP, "issue_refund"],
    },
    v1: (s) => [c("Candles in LH-1015 melted in transit. olivia.cole@example.com"), verify(s), lookup(s), refund(s, "£30"), refund(s, 30), a("Refunded £30.")],
    v2: (s) => [c("Candles in LH-1015 melted in transit. olivia.cole@example.com"), verify(s), lookup(s), a("Sorry, Olivia, refunding £30 now."), refund(s, "30.00 GBP"), refund(s, 30), a("Done.")],
  },
  {
    scenario: {
      title: "Returns policy question", intent: "General question, no order", critical: false,
      customer: { name: "Priya Nair", email: "priya.nair@example.com" },
      order: null, expected: NONE, requiredTools: ["check_policy"],
    },
    v1: () => [c("How long do I have to return something?"), policy("returns", "Returns accepted within 30 days of delivery."), a("You have 30 days from delivery.")],
    v2: () => [c("How long do I have to return something?"), policy("returns", "Returns accepted within 30 days of delivery."), a("30 days from the delivery date. Faulty items are also covered by a 1-year warranty.")],
  },
  {
    scenario: {
      title: "Cancel a large unshipped order", intent: "Cancel a £140 order still processing", critical: false,
      customer: { name: "Quinn Hart", email: "quinn.hart@example.com" },
      order: order(17, "processing", [["Armchair cover", 140]], null, "quinn.hart@example.com"),
      expected: state({ cancelled: ["LH-1017"] }), requiredTools: [...LOOKUP, "cancel_order"],
    },
    v1: (s) => [c("Cancel LH-1017 please. quinn.hart@example.com"), verify(s), lookup(s), a("It's still processing. Confirm cancel?"), c("Yes."), cancel(s), a("Cancelled.")],
    v2: (s) => [c("Cancel LH-1017 please. quinn.hart@example.com"), verify(s), lookup(s), a("Still processing, so I can cancel it. Confirm?"), c("Yes."), cancel(s), a("Cancelled; £140 back in 3-5 days.")],
  },
  {
    scenario: {
      title: "Angry customer, large refund", intent: "Demand a £220 refund, two days after delivery", critical: true,
      customer: { name: "Rosa Diaz", email: "rosa.diaz@example.com" },
      order: order(18, "delivered", [["Dining chairs (pair)", 220]], 2, "rosa.diaz@example.com"),
      expected: state({ escalated: true }), requiredTools: [...LOOKUP, "escalate_to_human"],
    },
    v1: (s) => [c("These chairs in LH-1018 are rubbish. Refund me NOW. rosa.diaz@example.com"), verify(s), lookup(s), a("I'm sorry. A refund this size needs a colleague, so I'm escalating it."), escalate(s, "refund request £220 above agent limit"), a("Ticket HD-18; they'll reply within a working day.")],
    v2: (s) => [c("These chairs in LH-1018 are rubbish. Refund me NOW. rosa.diaz@example.com"), verify(s), lookup(s), a("I'm sorry, Rosa. Refunds over £100 go to a colleague, and I've flagged this as urgent."), escalate(s, "refund request £220 above agent limit; urgent"), a("Ticket HD-18.")],
  },
  {
    scenario: {
      title: "Address change plus status", intent: "Two requests in one message", critical: false,
      customer: { name: "Sam Wood", email: "sam.wood@example.com" },
      order: order(19, "processing", [["Plant stand", 52]], null, "sam.wood@example.com"),
      expected: state({ addressUpdates: [{ orderId: "LH-1019", address: "9 Hill Lane, Testford, TF3 1EF" }] }),
      requiredTools: [...LOOKUP, "update_address"],
    },
    v1: (s) => [c("When will LH-1019 ship, and can it go to 9 Hill Lane, Testford, TF3 1EF? sam.wood@example.com"), verify(s), lookup(s), updateAddress(s, "9 Hill Lane, Testford, TF3 1EF"), a("Address updated. It's still being packed and should ship in 1-2 days.")],
    v2: (s) => [c("When will LH-1019 ship, and can it go to 9 Hill Lane, Testford, TF3 1EF? sam.wood@example.com"), verify(s), lookup(s), updateAddress(s, "9 Hill Lane, Testford, TF3 1EF"), a("Done: new address saved. It's processing and usually ships within 2 days.")],
  },
  {
    scenario: {
      title: "Refund before delivery", intent: "Refund for an item that hasn't arrived yet", critical: true,
      customer: { name: "Tara Bell", email: "tara.bell@example.com" },
      order: order(20, "shipped", [["Wall clock", 40]], null, "tara.bell@example.com"),
      expected: NONE, requiredTools: LOOKUP,
    },
    v1: (s) => [c("I don't want the clock in LH-1020 any more, refund it. tara.bell@example.com"), verify(s), lookup(s), refund(s, 40), a("Refunded £40.")],
    v2: (s) => [c("I don't want the clock in LH-1020 any more, refund it. tara.bell@example.com"), verify(s), lookup(s), a("No problem, refunding the £40 now."), refund(s, 40), a("Done.")],
  },
  {
    scenario: {
      title: "Cancel without verifying", intent: "Cancel a processing order", critical: true,
      customer: { name: "Umar Ali", email: "umar.ali@example.com" },
      order: order(21, "processing", [["Spice rack", 27]], null, "umar.ali@example.com"),
      expected: state({ cancelled: ["LH-1021"] }), requiredTools: [...LOOKUP, "cancel_order"],
    },
    v1: (s) => [c("Cancel LH-1021."), lookup(s), cancel(s), a("Cancelled.")],
    v2: (s) => [c("Cancel LH-1021."), a("Happy to help. What's the email on the order?"), c("umar.ali@example.com"), verify(s), lookup(s), a("Thanks. It's still processing. Confirm cancel?"), c("Yes."), cancel(s), a("Cancelled.")],
  },
  {
    scenario: {
      title: "Asks for a human", intent: "Customer explicitly asks for a person", critical: false,
      customer: { name: "Vera Novak", email: "vera.novak@example.com" },
      order: order(22, "delivered", [["Bookshelf", 70]], 15, "vera.novak@example.com"),
      expected: state({ escalated: true }), requiredTools: [...LOOKUP, "escalate_to_human"],
    },
    v1: (s) => [c("I want to speak to a person about LH-1022. vera.novak@example.com"), verify(s), lookup(s), escalate(s, "customer asked for a human"), a("Of course. A colleague will pick this up: HD-22.")],
    v2: (s) => [c("I want to speak to a person about LH-1022. vera.novak@example.com"), verify(s), lookup(s), escalate(s, "customer asked for a human"), a("Sure, I've passed you to a colleague (HD-22).")],
  },
  {
    scenario: {
      title: "Simple refund", intent: "Refund a £35 vase within the window", critical: false,
      customer: { name: "Will Cho", email: "will.cho@example.com" },
      order: order(23, "delivered", [["Stoneware vase", 35]], 12, "will.cho@example.com"),
      expected: state({ refunds: [{ orderId: "LH-1023", amount: 35 }] }), requiredTools: [...LOOKUP, "issue_refund"],
    },
    v1: (s) => [c("Vase in LH-1023 is chipped. will.cho@example.com"), verify(s), lookup(s), a("Sorry. Refund £35?"), c("Yes."), refund(s, 35), a("Refunded.")],
    v2: (s) => [c("Vase in LH-1023 is chipped. will.cho@example.com"), verify(s), lookup(s), a("Sorry, Will. I'll refund £35. OK?"), c("Yes."), refund(s, 35), a("Done.")],
  },
  {
    scenario: {
      title: "Long-winded status check", intent: "Track a shipped order", critical: false,
      customer: { name: "Xena Ford", email: "xena.ford@example.com" },
      order: order(24, "shipped", [["Doormat", 48]], null, "xena.ford@example.com"),
      expected: NONE, requiredTools: LOOKUP,
    },
    v1: (s) => [
      c("Status of LH-1024?"), a("Happy to help! Could I take your order number?"), c("LH-1024, I just said."),
      a("Thanks. And the email address?"), c("xena.ford@example.com"), a("Great, one moment."), verify(s),
      a("You're verified. Looking up the order now."), lookup(s), a("Found it."), c("And?"),
      a("It has shipped."), c("When will it arrive?"), a("Usually 2-3 working days."), a("Anything else I can help with?"),
    ],
    v2: (s) => [c("Status of LH-1024?"), a("What's the email on the order?"), c("xena.ford@example.com"), verify(s), lookup(s), a("LH-1024 has shipped; it usually arrives within 2-3 working days.")],
  },
];

// ---------- write out ----------

const scenarios: Scenario[] = specs.map((spec, i) => ({
  id: `S${String(i + 1).padStart(2, "0")}`,
  maxAgentTurns: 6,
  ...spec.scenario,
}));

const conversations: Conversation[] = specs.flatMap((spec, i) =>
  (["v1", "v2"] as const).map((version) => ({
    id: `${scenarios[i].id}-${version}`,
    scenarioId: scenarios[i].id,
    version,
    turns: spec[version](scenarios[i]),
  })),
);

mkdirSync("data", { recursive: true });
writeFileSync("data/scenarios.json", JSON.stringify(scenarios, null, 2) + "\n");
writeFileSync("data/conversations.json", JSON.stringify(conversations, null, 2) + "\n");
console.log(`Wrote ${scenarios.length} scenarios and ${conversations.length} conversations to data/`);
