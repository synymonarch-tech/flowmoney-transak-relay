import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 8080);
const RELAY_SECRET = process.env.RELAY_SECRET;

function send(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function safeEqual(a = "", b = "") {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true, service: "flowmoney-transak-relay" });
  }

  if (req.method !== "POST" || req.url !== "/transak/session") {
    return send(res, 404, { error: "not_found" });
  }

  if (!RELAY_SECRET) {
    return send(res, 500, { error: "relay_not_configured" });
  }

  const suppliedSecret = req.headers["x-flowmoney-relay-secret"];

  if (!safeEqual(String(suppliedSecret || ""), RELAY_SECRET)) {
    return send(res, 401, { error: "unauthorized" });
  }

  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 100000) {
        return send(res, 413, { error: "payload_too_large" });
      }
    }

    const input = JSON.parse(raw || "{}");

    if (!input.apiKey || !input.accessToken || !input.userIp || !input.widgetParams) {
      return send(res, 400, { error: "missing_required_fields" });
    }

    const response = await fetch(
      "https://api-gateway.transak.com/api/v2/auth/session",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": input.apiKey,
          "access-token": input.accessToken,
          "x-user-ip": input.userIp
        },
        body: JSON.stringify({
          widgetParams: input.widgetParams
        })
      }
    );

    const text = await response.text();

    res.writeHead(response.status, {
      "content-type":
        response.headers.get("content-type") || "application/json"
    });

    res.end(text);
  } catch (error) {
    console.error("Relay error:", error?.message);
    return send(res, 502, { error: "transak_request_failed" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`FlowMoney Transak relay listening on ${PORT}`);
});
