/* Node 22+. Run ONLY against your test Supabase project after deployment.
Set env (do not save in source): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, TEST_ORIGIN (must match ALLOWED_ORIGINS).
node --env-file=.env tests/integration.mjs
The admin password can be supplied as an environment variable in your terminal session.
Creates one test gift and deletes it in finally. Never needs service_role.
*/
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const url = process.env.VITE_SUPABASE_URL,
  key = process.env.VITE_SUPABASE_ANON_KEY;
for (const n of [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "TEST_ADMIN_EMAIL",
  "TEST_ADMIN_PASSWORD",
  "TEST_ORIGIN",
])
  assert.ok(process.env[n], `Missing ${n}`);
const admin = createClient(url, key, { auth: { persistSession: false } }),
  anon = createClient(url, key, { auth: { persistSession: false } });
const login = await admin.auth.signInWithPassword({
  email: process.env.TEST_ADMIN_EMAIL,
  password: process.env.TEST_ADMIN_PASSWORD,
});
assert.ifError(login.error);
const a = await admin.rpc("is_admin");
assert.equal(a.data, true);
const made = await admin
  .from("gifts")
  .insert({ title: "INTEGRATION TEST — DELETE ME" })
  .select()
  .single();
assert.ifError(made.error);
const id = made.data.id;
async function call(action, token) {
  const res = await fetch(`${url}/functions/v1/gift-actions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Origin: process.env.TEST_ORIGIN,
    },
    body: JSON.stringify({ action, gift_id: id, token }),
  });
  return { status: res.status, body: await res.json() };
}
try {
  assert.ok((await anon.from("gifts").insert({ title: "unauthorized" })).error);
  assert.ok(
    (await admin.from("gifts").update({ reserved: true }).eq("id", id)).error,
  );
  const suggestions = await anon.from("suggestions").select("*");
  assert.ok(suggestions.error || suggestions.data?.length === 0);
  const secret = await anon.schema("private").from("reservations").select("*");
  assert.ok(secret.error);
  assert.ok(
    (await anon.rpc("reserve_gift", { p_gift: id, p_hash: "a".repeat(64) }))
      .error,
  );
  const tokens = [randomUUID() + randomUUID(), randomUUID() + randomUUID()];
  const results = await Promise.all(tokens.map((t) => call("reserve", t)));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 1);
  const winner = results.findIndex((r) => r.status === 200);
  assert.equal(
    (await anon.from("gifts").select("reserved").eq("id", id).single()).data
      .reserved,
    true,
  );
  assert.equal((await call("cancel", tokens[1 - winner])).status, 409);
  assert.equal((await call("cancel", tokens[winner])).status, 200);
  assert.equal((await call("cancel", tokens[winner])).status, 409);
  const fresh = randomUUID() + randomUUID();
  assert.equal((await call("reserve", fresh)).status, 200);
  assert.equal((await call("cancel", tokens[winner])).status, 409);
  assert.equal((await call("cancel", fresh)).status, 200);
  assert.equal(
    (await anon.from("gifts").select("reserved").eq("id", id).single()).data
      .reserved,
    false,
  );
  const denied = await fetch(`${url}/functions/v1/gift-actions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Origin: process.env.TEST_ORIGIN,
    },
    body: JSON.stringify({ action: "suggest", gift: { title: "No captcha" } }),
  });
  assert.equal(denied.status, 400);
  console.log(
    "PASS: race, cancellation, old-token rejection, public/admin privileges, CAPTCHA requirement.",
  );
} finally {
  const cleanup = await admin.from("gifts").delete().eq("id", id);
  assert.ifError(cleanup.error);
  await admin.auth.signOut();
}
