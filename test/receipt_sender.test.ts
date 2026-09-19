import assert from "node:assert/strict";
import test from "node:test";
import type { InfraiClient } from "../src/infrai_client.ts";
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
    pdf: { generate: async (payload: { html: string }) => {
      events.push("pdf");
      assert.match(payload.html, /Amount paid/);
      assert.doesNotMatch(payload.html, /diagnosis|treatment/i);
      return { url: "https://example.com/receipt.pdf" };
    } },
    email: { send: async (payload: { attachments: Array<{ url: string }> }) => {
      events.push("email");
      assert.equal(payload.attachments[0]?.url, "https://example.com/receipt.pdf");
      return { message_id: "msg-2048" };
    } },
  } as InfraiClient;

  const result = await sendAppointmentReceipt(client, paidAppointment);

  assert.deepEqual(events, ["pdf", "email"]);
  assert.deepEqual(result, { kind: "sent", messageId: "msg-2048", appointmentId: "apt-1042" });
});
