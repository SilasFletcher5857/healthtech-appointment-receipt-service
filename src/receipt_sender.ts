import type { InfraiClient } from "./infrai_client.ts";

export type AppointmentReceipt = {
  appointmentId: string;
  patientEmail: string;
  patientFirstName: string;
  clinicName: string;
  appointmentDate: string;
  amountPaidCents: number;
  currency: "USD";
  status: "scheduled" | "completed" | "cancelled";
  paymentStatus: "pending" | "paid" | "refunded";
};

export type ReceiptOutcome =
  | { kind: "sent"; messageId: string; appointmentId: string }
  | { kind: "skipped"; reason: "appointment_not_completed" | "payment_not_paid"; appointmentId: string };

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function decideReceipt(input: AppointmentReceipt): ReceiptOutcome | undefined {
  if (input.status !== "completed") {
    return { kind: "skipped", reason: "appointment_not_completed", appointmentId: input.appointmentId };
  }
  if (input.paymentStatus !== "paid") {
    return { kind: "skipped", reason: "payment_not_paid", appointmentId: input.appointmentId };
  }
  return undefined;
}

export async function sendAppointmentReceipt(client: InfraiClient, input: AppointmentReceipt): Promise<ReceiptOutcome> {
  const decision = decideReceipt(input);
  if (decision) return decision;

  const amount = money(input.amountPaidCents, input.currency);
  const appointmentId = escapeHtml(input.appointmentId);
  const clinic = escapeHtml(input.clinicName);
  const date = escapeHtml(input.appointmentDate);
  const receiptHtml = `<h1>Payment receipt</h1><p>${clinic}</p><dl><dt>Appointment reference</dt><dd>${appointmentId}</dd><dt>Date</dt><dd>${date}</dd><dt>Amount paid</dt><dd>${amount}</dd></dl><p>Keep this receipt for your records.</p>`;

  const pdf = await client.pdf.generate(
    { html: receiptHtml, page_size: "A4", orientation: "portrait", store: true },
    `appointment-${input.appointmentId}-receipt-pdf`,
  );

  const email = await client.email.send(
    {
      to: input.patientEmail,
      subject: `Receipt from ${input.clinicName}`,
      html: `<p>Hello ${escapeHtml(input.patientFirstName)},</p><p>Your payment receipt is attached. It contains billing and appointment reference details only.</p>`,
      attachments: [{ filename: `receipt-${input.appointmentId}.pdf`, url: pdf.url }],
    },
    `appointment-${input.appointmentId}-receipt-email`,
  );

  return { kind: "sent", messageId: email.message_id, appointmentId: input.appointmentId };
}
