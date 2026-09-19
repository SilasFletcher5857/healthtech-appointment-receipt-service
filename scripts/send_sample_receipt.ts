import { createInfraiClient } from "../src/infrai_client.ts";
import { sendAppointmentReceipt } from "../src/receipt_sender.ts";

const patientEmail = process.env.DEMO_PATIENT_EMAIL;
if (!patientEmail) throw new Error("DEMO_PATIENT_EMAIL is required");

const result = await sendAppointmentReceipt(createInfraiClient(), {
  appointmentId: `demo-${new Date().toISOString().slice(0, 10)}`,
  patientEmail,
  patientFirstName: "Jordan",
  clinicName: "Northside Health",
  appointmentDate: "2026-09-12T09:30:00+08:00",
  amountPaidCents: 8500,
  currency: "USD",
  status: "completed",
  paymentStatus: "paid",
});

console.log(result);
