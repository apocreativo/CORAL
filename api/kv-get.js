import type { VercelRequest, VercelResponse } from "@vercel/node";
import { kv } from "@vercel/kv";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { key } = req.query;
  const value = await kv.get(key as string);
  return res.status(200).json({ ok: true, value });
}
