import assert from "node:assert/strict";
import test from "node:test";
import { createInfraiClient, type InfraiClient } from "../src/infrai_client.ts";
import { sendAppointmentReceipt, type AppointmentReceipt } from "../src/receipt_sender.ts";

const paidAppointment: AppointmentReceipt = {
  appointmentId: "apt-1042",
  patientEmail: "patient@example.com",
  patientFirstName: "Jordan",
  clinicName: "Northside Health",
  appointmentDate: "2026-09-12T09:30:00+08:00",
  amountPaidCents: 8500,
  currency: "USD",
  status: "completed",
  paymentStatus: "paid",
};

test("a scheduled appointment does not render or send a receipt", async () => {
  let calls = 0;
  const client = {
    pdf: { generate: async () => { calls += 1; return { url: "https://example.com/receipt.pdf" }; } },
    email: { send: async () => { calls += 1; return { message_id: "msg-unused" }; } },
  } as InfraiClient;

  const result = await sendAppointmentReceipt(client, { ...paidAppointment, status: "scheduled" });

  assert.deepEqual(result, { kind: "skipped", reason: "appointment_not_completed", appointmentId: "apt-1042" });
  assert.equal(calls, 0);
});

test("a completed paid appointment renders then sends a patient-safe receipt", async () => {
  const events: string[] = [];
  const client = {
    pdf: { generate: async (payload: { html: string }, idempotencyKey: string) => {
      events.push("pdf");
      assert.match(payload.html, /Amount paid/);
      assert.doesNotMatch(payload.html, /diagnosis|treatment/i);
      assert.equal(idempotencyKey, "appointment-apt-1042-receipt-pdf");
      return { url: "https://example.com/receipt.pdf" };
    } },
    email: { send: async (payload: { attachments: Array<{ url: string }> }, idempotencyKey: string) => {
      events.push("email");
      assert.equal(payload.attachments[0]?.url, "https://example.com/receipt.pdf");
      assert.equal(idempotencyKey, "appointment-apt-1042-receipt-email");
      return { message_id: "msg-2048" };
    } },
  } as InfraiClient;

  const result = await sendAppointmentReceipt(client, paidAppointment);

  assert.deepEqual(events, ["pdf", "email"]);
  assert.deepEqual(result, { kind: "sent", messageId: "msg-2048", appointmentId: "apt-1042" });
});

test("the client serializes idempotency keys as capability request fields", async () => {
  const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const client = createInfraiClient({
    apiKey: "test-key",
    fetchImpl: async (_input, init) => {
      requests.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      const data = requests.length === 1 ? { url: "https://example.com/receipt.pdf" } : { message_id: "msg-2048" };
      return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
    },
  });

  await client.pdf.generate({ html: "<p>Receipt</p>", page_size: "A4", orientation: "portrait", store: true }, "pdf-key");
  await client.email.send(
    { to: "patient@example.com", subject: "Receipt", html: "<p>Attached</p>", attachments: [] },
    "email-key",
  );

  assert.equal(requests[0]?.body.idempotency_key, "pdf-key");
  assert.equal(requests[1]?.body.idempotency_key, "email-key");
  assert.equal(requests[0]?.headers.has("Idempotency-Key"), false);
  assert.equal(requests[1]?.headers.has("Idempotency-Key"), false);
});
