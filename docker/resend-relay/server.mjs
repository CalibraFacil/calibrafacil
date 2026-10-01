// Local stand-in for the Resend HTTP API.
//
// The app sends every email through the official `resend` SDK, which honours
// RESEND_BASE_URL. In development docker-compose points that at this relay, which
// accepts the Resend `POST /emails` and `POST /emails/batch` payloads and hands
// each message to Mailpit's send API. Nothing leaves your machine: open
// http://localhost:8025 to read magic links, invitations and notifications.
//
// Any other Resend endpoint (domains, audiences, broadcasts…) answers with a
// Resend-shaped 404, which the SDK surfaces as `{ data: null, error }`.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3025);
const MAILPIT_URL = (
  process.env.MAILPIT_URL ?? "http://localhost:8025"
).replace(/\/+$/, "");

function parseAddress(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(.*)<([^>]+)>$/);
  if (!match) return { Email: text, Name: "" };
  return {
    Email: match[2].trim(),
    Name: match[1].trim().replace(/^"|"$/g, ""),
  };
}

function toList(value) {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function attachmentContent(content) {
  if (typeof content === "string") return content;
  // A Node Buffer serialised by JSON.stringify.
  if (content && content.type === "Buffer" && Array.isArray(content.data)) {
    return Buffer.from(content.data).toString("base64");
  }
  if (Array.isArray(content)) return Buffer.from(content).toString("base64");
  return "";
}

function toMailpitMessage(email) {
  const headers = {};
  for (const [key, value] of Object.entries(email.headers ?? {})) {
    headers[key] = String(value);
  }

  return {
    From: parseAddress(email.from),
    To: toList(email.to).map(parseAddress),
    Cc: toList(email.cc).map(parseAddress),
    Bcc: toList(email.bcc).map((entry) => parseAddress(entry).Email),
    ReplyTo: toList(email.reply_to ?? email.replyTo).map(parseAddress),
    Subject: String(email.subject ?? ""),
    Text: typeof email.text === "string" ? email.text : "",
    HTML: typeof email.html === "string" ? email.html : "",
    Headers: headers,
    Tags: toList(email.tags)
      .map((tag) =>
        typeof tag === "string" ? tag : `${tag.name}:${tag.value}`,
      )
      .filter(Boolean),
    Attachments: toList(email.attachments).map((attachment) => ({
      Content: attachmentContent(attachment.content),
      Filename: attachment.filename ?? "attachment",
      ContentType: attachment.content_type ?? attachment.contentType ?? "",
      ContentID: attachment.content_id ?? attachment.contentId ?? "",
    })),
  };
}

async function deliver(email) {
  const response = await fetch(`${MAILPIT_URL}/api/v1/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(toMailpitMessage(email)),
  });
  if (!response.ok) {
    throw new Error(`Mailpit ${response.status}: ${await response.text()}`);
  }
  return { id: randomUUID() };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://relay").pathname.replace(
    /\/+$/,
    "",
  );

  try {
    if (request.method === "GET" && (path === "" || path === "/health")) {
      return send(response, 200, { ok: true });
    }

    if (request.method === "POST" && path === "/emails") {
      const email = await readJson(request);
      const result = await deliver(email);
      console.log(
        `[resend-relay] ${email.subject ?? "(no subject)"} -> ${toList(email.to).join(", ")}`,
      );
      return send(response, 200, result);
    }

    if (request.method === "POST" && path === "/emails/batch") {
      const emails = await readJson(request);
      const data = [];
      for (const email of toList(emails)) data.push(await deliver(email));
      console.log(`[resend-relay] batch of ${data.length} email(s)`);
      return send(response, 200, { data });
    }

    return send(response, 404, {
      statusCode: 404,
      name: "not_found",
      message: `The local Resend relay does not implement ${request.method} ${path}`,
    });
  } catch (error) {
    console.error("[resend-relay]", error);
    return send(response, 500, {
      statusCode: 500,
      name: "application_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, () => {
  console.log(
    `[resend-relay] listening on :${PORT}, delivering to ${MAILPIT_URL}`,
  );
});
