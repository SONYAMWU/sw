import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(
  `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid,bucket_id text);alter table storage.objects enable row level security;`,
);
let sql = fs.readFileSync(
  new URL("../supabase/migrations/001_wishlist.sql", import.meta.url),
  "utf8",
);
sql = sql
  .replace(
    "create extension if not exists pgcrypto with schema extensions;",
    "",
  )
  .replace("alter publication supabase_realtime add table public.gifts;", "");
await db.exec(sql);
await db.exec(
  `insert into auth.users values('11111111-1111-4111-8111-111111111111'); insert into private.admins values('11111111-1111-4111-8111-111111111111'); grant usage on schema public to anon,authenticated,service_role;`,
);
async function fails(q, label) {
  let failed = false;
  try {
    await db.exec(q);
  } catch {
    failed = true;
  }
  assert.ok(failed, label);
}
await db.exec(`set role anon`);
assert.equal(
  (await db.query("select public.is_admin() as admin")).rows[0].admin,
  false,
);
await fails(
  `insert into public.gifts(title) values('Forbidden')`,
  "Anon insert denied",
);
await fails(`select * from private.reservations`, "Private tokens denied");
await fails(`select * from public.suggestions`, "Anon suggestion read denied");
await fails(
  `select public.reserve_gift(gen_random_uuid(),repeat('a',64))`,
  "Anon RPC denied",
);
await db.exec(
  `reset role;set role authenticated;set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';`,
);
assert.equal(
  (await db.query("select public.is_admin() as admin")).rows[0].admin,
  true,
);
const gift = (
  await db.query(
    `insert into public.gifts(title) values('Test wish') returning *`,
  )
).rows[0];
await fails(
  `update public.gifts set reserved=true where id='${gift.id}'`,
  "Admin reserved update denied",
);
await fails(`select * from private.reservations`, "Admin tokens denied");
await fails(
  `select public.cancel_gift('${gift.id}',repeat('a',64))`,
  "Admin cancel RPC denied",
);
await db.exec(
  `set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';`,
);
assert.equal(
  (await db.query("select public.is_admin() as admin")).rows[0].admin,
  false,
);
await fails(
  `insert into public.gifts(title) values('Not admin')`,
  "Nonadmin insert denied",
);
assert.equal(
  (
    await db.query(
      `update public.gifts set title='Forbidden' where id='${gift.id}' returning id`,
    )
  ).rows.length,
  0,
);
await db.exec(`reset role;set role service_role;`);
await db.exec(`select public.reserve_gift('${gift.id}',repeat('a',64))`);
await fails(
  `select public.reserve_gift('${gift.id}',repeat('b',64))`,
  "Second reservation denied",
);
await fails(
  `select public.cancel_gift('${gift.id}',repeat('b',64))`,
  "Wrong token denied",
);
assert.equal(
  (await db.query(`select reserved from public.gifts where id='${gift.id}'`))
    .rows[0].reserved,
  true,
);
await db.exec(`select public.cancel_gift('${gift.id}',repeat('a',64))`);
await db.exec(`select public.reserve_gift('${gift.id}',repeat('b',64))`);
await fails(
  `select public.cancel_gift('${gift.id}',repeat('a',64))`,
  "Old token denied",
);
await db.exec(`select public.cancel_gift('${gift.id}',repeat('b',64))`);
assert.equal(
  (await db.query(`select reserved from public.gifts where id='${gift.id}'`))
    .rows[0].reserved,
  false,
);
for (let i = 0; i < 5; i++)
  assert.equal(
    (await db.query(`select public.check_rate('test',5) as ok`)).rows[0].ok,
    true,
  );
assert.equal(
  (await db.query(`select public.check_rate('test',5) as ok`)).rows[0].ok,
  false,
);
const suggestion = (
  await db.query(
    `insert into public.suggestions(title) values('Suggested') returning id`,
  )
).rows[0];
await db.exec(`select public.moderate_suggestion('${suggestion.id}',true)`);
await fails(
  `select public.moderate_suggestion('${suggestion.id}',true)`,
  "Duplicate moderation denied",
);
assert.equal(
  (
    await db.query(
      `select count(*)::int as n from public.gifts where title='Suggested'`,
    )
  ).rows[0].n,
  1,
);
await db.exec(`reset role;`);
// Invariant: failed reservation insert must roll back the preceding status update.
await db.exec(
  `update public.gifts set reserved=false where id='${gift.id}';insert into private.reservations values('${gift.id}',repeat('c',64));set role service_role;`,
);
await fails(
  `select public.reserve_gift('${gift.id}',repeat('d',64))`,
  "Conflicting row fails",
);
assert.equal(
  (await db.query(`select reserved from public.gifts where id='${gift.id}'`))
    .rows[0].reserved,
  false,
);
await db.close();
console.log(
  "PASS SQL migration, admin/anon/nonadmin RLS, private token isolation, service-only RPC, duplicate reservation, wrong/old cancellation tokens, rate limit, atomic moderation, rollback.\nSupabase auth/storage/realtime were stubbed; real cross-device race still requires deployed integration test.",
);
