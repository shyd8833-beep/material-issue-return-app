export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    };

    const json = (body, status = 200) => new Response(
      JSON.stringify(body),
      { status, headers: corsHeaders }
    );

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === "GET") {
      return json({
        success: true,
        message: "Material Issue API Worker is running",
        diagnostics: {
          appsScriptUrlConfigured: typeof env.APPS_SCRIPT_URL === "string" && !!env.APPS_SCRIPT_URL.trim(),
          materialApiSecretConfigured: typeof env.MATERIAL_API_SECRET === "string" && !!env.MATERIAL_API_SECRET
        }
      });
    }

    if (request.method !== "POST") {
      return json({ success: false, message: "Method not allowed" }, 405);
    }

    const url = env.APPS_SCRIPT_URL;
    const secret = env.MATERIAL_API_SECRET;

    if (typeof url !== "string" || !url.trim() ||
        typeof secret !== "string" || !secret) {
      return json({ success: false, message: "Worker configuration is incomplete" }, 500);
    }

    try {
      const incomingData = await request.json();
      if (!incomingData || typeof incomingData !== "object" || Array.isArray(incomingData)) {
        return json({ success: false, message: "Invalid request data" }, 400);
      }

      const payload = { ...incomingData, apiSecret: secret };
      const upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "follow"
      });

      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: corsHeaders
      });
    } catch (error) {
      return json({
        success: false,
        message: "API request failed",
        error: String(error && error.message ? error.message : error)
      }, 502);
    }
  }
};
