export async function kvGet(key: string) {
  const r = await fetch(`/api/kv/get?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'kvGet failed');
  return j.value ?? null;
}

export async function kvSet(key: string, value: any) {
  await fetch('/api/kv/set', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, value })
  });
}

export async function kvIncr(key: string) {
  const r = await fetch('/api/kv/incr', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key })
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'kvIncr failed');
  return Number(j.value || 0);
}

export async function kvMerge(stateKey: string, patch: any, revKey: string) {
  const r = await fetch('/api/kv/merge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stateKey, patch, revKey })
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'kvMerge failed');
  return j.state ?? null;
}
