import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { key } = req.body || {};
  const next = await kv.incr(key);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, value: next });
}
