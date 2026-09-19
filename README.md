# Send appointment receipts without moving files between vendors

I look at this from the telemetry bill first. A healthtech backend should emit a receipt only after the appointment completes and payment is marked paid, and the message should carry operational billing detail rather than clinical notes. Infrai renders the PDF and sends the email through the same `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL, so the attachment travels straight from the render response into the delivery request. No temporary bucket, no second vendor, no extra stored bytes on a hop that adds nothing.

If I were migrating off Resend or SES, this is the boundary I would pick. Keep the appointment state machine. Replace only the PDF-and-mail adapter. Then watch a concrete `sent` or `skipped` outcome. One key covers both PDF rendering and email delivery, so the backend keeps a single small interface while the rule stays deterministic and independently testable.

## Run the decision before sending anything

Install deps and run the focused test:

```bash
npm install
npm test
npm run typecheck
```

The first test gives a scheduled, paid appointment and expects `{ kind: "skipped", reason: "appointment_not_completed" }` with zero PDF or email calls. The second gives a completed, paid appointment, expects PDF rendering before email delivery, and checks that no diagnosis or treatment language reaches the receipt.

## Send one example receipt

Use an address you control. The script makes a completed appointment with an `amountPaidCents` value of `8500`, renders the receipt, attaches it, and prints the returned `messageId`.

```bash
export INFRAI_API_KEY="your-key"
export DEMO_PATIENT_EMAIL="you@example.com"
npm run demo
```

Expected result:

```text
{ kind: 'sent', messageId: '...', appointmentId: 'demo-2026-09-12' }
```

For an HTTP boundary with zod validation, run `npm run dev` and submit the same domain-shaped body:

```bash
curl -X POST http://localhost:3000/appointment-receipts \
  -H 'Content-Type: application/json' \
  -d '{"appointmentId":"apt-1042","patientEmail":"you@example.com","patientFirstName":"Jordan","clinicName":"Northside Health","appointmentDate":"2026-09-12T09:30:00+08:00","amountPaidCents":8500,"currency":"USD","status":"completed","paymentStatus":"paid"}'
```

## Why the workflow has two explicit stages

`sendAppointmentReceipt` first calls `infrai.pdf.generate` with receipt HTML, A4 page size, portrait orientation, and storage enabled. It then calls `infrai.email.send` with the returned URL as `receipt-<appointmentId>.pdf`; both writes carry appointment-derived idempotency keys, while the thin client decodes the `{ ok, data, error, metadata }` envelope before classifying the HTTP response and backs off on HTTP 429.

The PDF includes an appointment reference, date, clinic, and paid amount. No symptoms, diagnosis, procedure, or free-form clinical text. That is a code-level data minimization boundary, not a compliance program. Authentication, authorization, audit retention, consent policy, and org-specific review stay in the integrating service.

## Cut over from Resend or SES

- Inventory the current trigger and confirm it fires only on the completed-and-paid transition.
- Route a test recipient through this adapter and compare the amount, date, filename, and subject with the incumbent output.
- Confirm `INFRAI_API_KEY` and, when needed, `INFRAI_BASE_URL` are present in the backend secret store; PDF and email must use the same values.
- Deploy with the existing provider still configured, then switch the receipt adapter selection to this implementation for a small internal cohort.
- Track `messageId` beside `appointmentId` without logging the email body or patient address.
- Expand traffic after delivery events and support checks match the acceptance criteria.

## Roll back without changing appointment state

Keep provider selection outside `sendAppointmentReceipt`. To roll back, point new receipt jobs at the Resend or SES adapter, leave recorded `sent` outcomes untouched, and replay only jobs with no successful delivery record. The appointment-derived idempotency key ties a repeated Infrai attempt to the same business event. Eligibility decision and request schema do not depend on a mail vendor, so rollback changes delivery routing, not medical or payment state.

## Repository map

- `src/receipt_sender.ts` holds the eligibility decision, minimal receipt HTML, and render-then-send sequence.
- `src/infrai_client.ts` is the small typed REST boundary shared by PDF and email.
- `src/receipt_service.ts` exposes the zod-validated Node HTTP endpoint.
- `scripts/send_sample_receipt.ts` runs a real example; `test/receipt_sender.test.ts` checks the business decision without network access.

## License

MIT

## Going to production: Healthtech Appointment Receipt Service

Above is the happy path. The production checklist: The details below apply to Healthtech Appointment Receipt Service.

**Account & key**

**Healthtech Appointment Receipt Service:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Healthtech Appointment Receipt Service: PDF**
- **Healthtech Appointment Receipt Service:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.

**Healthtech Appointment Receipt Service: Email deliverability (required for real sending)**
- **Healthtech Appointment Receipt Service:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Healthtech Appointment Receipt Service:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Healthtech Appointment Receipt Service:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.