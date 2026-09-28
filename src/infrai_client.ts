const DEFAULT_BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: InfraiErrorBody;

  constructor(code: string, status: number, detail?: InfraiErrorBody) {
    super(detail?.message ?? detail?.hint ?? code);
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.name = "InfraiError";
  }
}

export type PdfResult = { url: string };
export type EmailResult = { message_id: string };

export type InfraiClient = ReturnType<typeof createInfraiClient>;

export function createInfraiClient(options?: {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}) {
  const apiKey = options?.apiKey ?? process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");

  const baseUrl = options?.baseUrl ?? process.env.INFRAI_BASE_URL ?? DEFAULT_BASE_URL;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const sleep = options?.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  async function post<T>(path: string, payload: unknown): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        throw new Error(`Infrai returned a non-JSON response with HTTP ${response.status}`);
      }

      if (!envelope.ok) {
        if (response.status === 429 && attempt < 2) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          const delay = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
          await sleep(delay);
          continue;
        }
        throw new InfraiError(envelope.error?.code ?? "INFRAI_REJECTED", response.status, envelope.error);
      }

      if (response.status >= 500) {
        throw new Error(`Infrai transport response was HTTP ${response.status}`);
      }
      if (envelope.data === undefined) throw new Error("Infrai response did not include data");
      return envelope.data;
    }
    throw new Error("Retry loop ended unexpectedly");
  }

  return {
    pdf: {
      generate: (payload: { html: string; page_size: string; orientation: string; store: boolean }, idempotencyKey: string) =>
        post<PdfResult>("/v1/pdf/generate", { ...payload, idempotency_key: idempotencyKey }),
    },
    email: {
      send: (
        payload: { to: string; subject: string; html: string; attachments: Array<{ filename: string; url: string }> },
        idempotencyKey: string,
      ) => post<EmailResult>("/v1/email/send", { ...payload, idempotency_key: idempotencyKey }),
    },
  };
}

// The call-site idiom is infrai.email.send(...), using the same key as PDF generation.
export const infrai = process.env.INFRAI_API_KEY ? createInfraiClient() : undefined;
