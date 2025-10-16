import { kv } from '@vercel/kv';

function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch ?? base;
  if (typeof base === 'object' && typeof patch === 'object' && base && patch) {
    const out = { ...base };
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      out[k] = deepMerge(base[k], v);
    }
    return out;
  }
  return patch ?? base;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { stateKey, patch, revKey } = req.body || {};
  const cur = (await kv.get(stateKey)) ?? {};
  const next = deepMerge(cur, patch);
  await kv.set(stateKey, next);
  const r = await kv.incr(revKey);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, state: next, rev: r });
}
