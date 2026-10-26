/*
 * Relay do RetroAchievements para o site do SNES TV (Cloudflare Workers, plano grátis).
 * Repassa os pedidos do site para https://retroachievements.org/dorequest.php e devolve a
 * resposta com permissão para o navegador (CORS). Não guarda nada.
 *
 * Como usar: dash.cloudflare.com → Workers e Pages → Criar → Worker → "Editar código",
 * apague o código de exemplo, cole este arquivo inteiro e clique em "Implantar".
 */
const SITE = "https://matheuslmsilva.github.io";   // só o seu site pode usar este relay
const RA = "https://retroachievements.org/dorequest.php";

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": origin === SITE ? SITE : "null",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (origin !== SITE) return new Response("forbidden", { status: 403, headers: cors });
    if (request.method !== "POST" && request.method !== "GET") return new Response("method", { status: 405, headers: cors });

    const url = new URL(request.url);
    const init = {
      method: request.method,
      headers: { "User-Agent": "SNESTV/1.0 rcheevos (web)" }
    };
    if (request.method === "POST") {
      init.headers["Content-Type"] = request.headers.get("Content-Type") || "application/x-www-form-urlencoded";
      init.body = await request.text();
    }
    const resp = await fetch(RA + url.search, init);
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: Object.assign({ "Content-Type": resp.headers.get("Content-Type") || "application/json" }, cors)
    });
  }
};
