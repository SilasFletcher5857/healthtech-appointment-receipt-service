import { createServer } from "node:http";
import { z } from "zod";
import { createInfraiClient, InfraiError } from "./infrai_client.ts";
import { sendAppointmentReceipt } from "./receipt_sender.ts";

const receiptRequest = z.object({
  appointmentId: z.string().min(1).max(100),
  patientEmail: z.string().email(),
  patientFirstName: z.string().min(1).max(100),
  clinicName: z.string().min(1).max(160),
  appointmentDate: z.string().datetime({ offset: true }),
  amountPaidCents: z.number().int().nonnegative(),
  currency: z.literal("USD"),
  status: z.enum(["scheduled", "completed", "cancelled"]),
  paymentStatus: z.enum(["pending", "paid", "refunded"]),
}).strict();

const client = createInfraiClient();
const port = Number(process.env.PORT ?? 3000);

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "POST" || request.url !== "/appointment-receipts") {
    response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = receiptRequest.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid_request", issues: parsed.error.issues }));
      return;
    }

    const outcome = await sendAppointmentReceipt(client, parsed.data);
    response.writeHead(outcome.kind === "sent" ? 201 : 200).end(JSON.stringify(outcome));
  } catch (error) {
    if (error instanceof SyntaxError) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid_json" }));
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      response.writeHead(error.status).end(JSON.stringify({ error: error.code, message: error.message }));
      return;
    }
    console.error(error);
    response.writeHead(502).end(JSON.stringify({ error: "delivery_unavailable" }));
  }
});

server.listen(port, () => console.log(`Receipt service listening on http://localhost:${port}`));
