/**
 * Cloudflare Worker — CORS proxy for Albert OCR (GitHub Pages compatible).
 *
 * Deploy (free):
 *   1. npm i -g wrangler   (or use Cloudflare dashboard → Workers → Create)
 *   2. wrangler login
 *   3. wrangler deploy
 *   4. Put the worker URL into web/config.js → proxyUrl
 *
 * Forwards Authorization when the browser sends one. Otherwise uses the
 * ALBERT_API_KEY secret configured on the Worker (not shipped to the page).
 */

const ALBERT_URL = "https://albert.api.etalab.gouv.fr/v1/chat/completions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ detail: "Method not allowed" }, 405);
    }

    const incoming = request.headers.get("Authorization") || "";
    const bearer = incoming.startsWith("Bearer ") ? incoming.slice(7).trim() : "";
    const auth = bearer
      ? `Bearer ${bearer}`
      : env.ALBERT_API_KEY
        ? `Bearer ${env.ALBERT_API_KEY}`
        : "";
    if (!auth) {
      return json({ detail: "Missing Authorization: Bearer <api_key>" }, 401);
    }

    const contentType = request.headers.get("Content-Type") || "application/json";
    const body = await request.arrayBuffer();

    try {
      const upstream = await fetch(ALBERT_URL, {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": contentType,
          Accept: "application/json",
          "User-Agent": "AlbertOCRGitHubProxy/1.0",
        },
        body,
      });

      const payload = await upstream.arrayBuffer();
      return new Response(payload, {
        status: upstream.status,
        headers: {
          ...corsHeaders,
          "Content-Type":
            upstream.headers.get("Content-Type") || "application/json",
        },
      });
    } catch (error) {
      return json({ detail: String(error) }, 502);
    }
  },
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
