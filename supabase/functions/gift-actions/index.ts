import { createClient } from "npm:@supabase/supabase-js@2";
const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw Error(`Missing server setting: ${name}`);
  return value;
};
const cors = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
});
const sha = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
function url(value: unknown) {
  if (!value) return "";
  if (typeof value !== "string" || value.length > 2048)
    throw Error("Ссылка слишком длинная");
  const u = new URL(value);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw Error("Нужна ссылка http или https");
  return u.href;
}
function text(value: unknown, max: number, required = false) {
  if (value === undefined || value === null) value = "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw Error("Проверьте поля формы");
  return value.trim();
}
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((s) => s.trim());
  if (!origin || !allowed.includes(origin))
    return new Response("Origin not allowed", { status: 403 });
  const headers = cors(origin);
  const response = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST")
    return response({ error: "Method not allowed" }, 405);
  try {
    // Bound the actual streamed body, including requests without Content-Length.
    const reader = req.body?.getReader();
    if (!reader) throw Error("Пустой запрос");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 7100000) {
        await reader.cancel();
        return response({ error: "Фото слишком большое" }, 413);
      }
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      all.set(c, offset);
      offset += c.length;
    }
    const body = JSON.parse(new TextDecoder().decode(all));
    const db = createClient(
      env("SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );
    if (["approve", "reject"].includes(body.action)) {
      const token = (req.headers.get("authorization") || "").replace(
        /^Bearer /i,
        "",
      );
      const {
        data: { user },
        error,
      } = await db.auth.getUser(token);
      if (error || !user)
        return response({ error: "Нужен вход администратора" }, 401);
      const scoped = createClient(
        env("SUPABASE_URL"),
        env("SUPABASE_ANON_KEY"),
        {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false },
        },
      );
      const { data: admin, error: adminError } = await scoped.rpc("is_admin");
      if (adminError || !admin) return response({ error: "Нет доступа" }, 403);
      const { error: e } = await db.rpc("moderate_suggestion", {
        p_id: body.suggestion_id,
        p_approve: body.action === "approve",
      });
      if (e) throw Error(e.message);
      return response({ ok: true });
    }
    if (!["reserve", "cancel", "suggest"].includes(body.action))
      return response({ error: "Неизвестное действие" }, 400);
    // Persisted, atomic hourly counter. Store only a rotating salted hash, no raw IP.
    const ip = (
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "unknown"
    )
      .split(",")[0]
      .trim();
    const key = await sha(
      env("RATE_LIMIT_SALT") +
        new Date().toISOString().slice(0, 10) +
        ip +
        body.action,
    );
    const { data: can, error: rateError } = await db.rpc("check_rate", {
      p_key: key,
      p_limit: body.action === "suggest" ? 5 : 60,
    });
    if (rateError) throw Error("Не удалось проверить лимит");
    if (!can)
      return response(
        { error: "Слишком много попыток. Попробуйте через час." },
        429,
      );
    if (body.action === "suggest") {
      const verification = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body: new URLSearchParams({
            secret: env("TURNSTILE_SECRET_KEY"),
            response: String(body.captcha || ""),
          }),
        },
      );
      const verified = await verification.json();
      if (
        !verified.success ||
        !allowed.some((o) => new URL(o).hostname === verified.hostname)
      )
        return response({ error: "Пройдите проверку от спама ещё раз." }, 400);
      const gift = body.gift || {};
      const title = text(gift.title, 120, true),
        description = text(gift.description, 1000),
        shop_url = url(gift.shop_url);
      let image_url = "";
      if (
        typeof gift.image_url === "string" &&
        gift.image_url.startsWith("data:")
      ) {
        const match = gift.image_url.match(
          /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/,
        );
        if (!match) throw Error("Неподдерживаемый файл");
        const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
        if (bytes.length > 5242880 || bytes.length < 12)
          throw Error("Фото: до 5 МБ");
        const valid =
          match[1] === "jpeg"
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : match[1] === "png"
              ? [137, 80, 78, 71, 13, 10, 26, 10].every(
                  (b, i) => bytes[i] === b,
                )
              : new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
                new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
        if (!valid) throw Error("Содержимое файла не соответствует формату");
        const path = `suggested/${crypto.randomUUID()}.${match[1]}`;
        const { error } = await db.storage
          .from("gift-images")
          .upload(path, bytes, { contentType: `image/${match[1]}` });
        if (error) throw Error("Не удалось загрузить фото");
        image_url = db.storage.from("gift-images").getPublicUrl(path)
          .data.publicUrl;
      } else image_url = url(gift.image_url);
      const { error } = await db
        .from("suggestions")
        .insert({ title, description, shop_url, image_url });
      if (error) throw Error("Не удалось отправить предложение");
      return response({ ok: true });
    }
    if (
      typeof body.token !== "string" ||
      !/^[a-f0-9-]{72}$/.test(body.token) ||
      typeof body.gift_id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(body.gift_id)
    )
      throw Error("Недействительная ссылка");
    const { error } = await db.rpc(
      body.action === "reserve" ? "reserve_gift" : "cancel_gift",
      { p_gift: body.gift_id, p_hash: await sha(body.token) },
    );
    if (error) return response({ error: error.message }, 409);
    return response({ ok: true });
  } catch (e) {
    return response(
      {
        error: e instanceof Error ? e.message : "Не удалось выполнить действие",
      },
      400,
    );
  }
});
