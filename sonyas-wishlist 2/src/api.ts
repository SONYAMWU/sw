import { createClient } from "@supabase/supabase-js";
export const configured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
);
export const db = createClient(
  import.meta.env.VITE_SUPABASE_URL || "https://unconfigured.supabase.co",
  import.meta.env.VITE_SUPABASE_ANON_KEY || "unconfigured",
);
export const categories = [
  "beauty",
  "fashion",
  "home",
  "books",
  "little things",
  "other",
] as const;
export type Gift = {
  id: string;
  title: string;
  description: string;
  image_url: string;
  shop_url: string;
  price: number | null;
  category: string;
  priority: string;
  reserved: boolean;
  created_at: string;
};
export function safeUrl(value: string) {
  if (!value) return "";
  const u = new URL(value);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw Error("Используйте ссылку http или https.");
  return u.href;
}
export async function action(action: string, payload: object) {
  const { data, error } = await db.functions.invoke("gift-actions", {
    body: { action, ...payload },
  });
  if (error) {
    let message = error.message;
    try {
      message = (await error.context.json()).error || message;
    } catch {}
    throw Error(message);
  }
  if (data.error) throw Error(data.error);
  return data;
}
export async function upload(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw Error("Фото: JPG, PNG или WebP, до 5 МБ.");
  const ext = file.type.split("/")[1];
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage
    .from("gift-images")
    .upload(path, file, { contentType: file.type });
  if (error) throw error;
  return db.storage.from("gift-images").getPublicUrl(path).data.publicUrl;
}
