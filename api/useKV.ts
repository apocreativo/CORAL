export async function kvGet(key) {
  const r = await fetch(`/api/kv/get?key=${encodeURIComponent(key)}`);
  const j = await r.json();
  return j.value ?? null;
}

export async function kvSet(key, value) {
  await fetch("/api/kv/set", { method:"POST", body:JSON.stringify({ key, value }), headers:{ "content-type": "application/json" }});
}

export async function kvIncr(key) {
  const r = await fetch("/api/kv/incr", { method:"POST", body: JSON.stringify({ key }), headers:{ "content-type": "application/json" }});
  const j = await r.json();
  return Number(j.value||0);
}

export async function kvMerge(stateKey, patch, revKey) {
  const r = await fetch("/api/kv/merge", { method:"POST", body: JSON.stringify({ stateKey, patch, revKey }), headers:{ "content-type": "application/json" }});
  const j = await r.json();
  return j.state ?? null;
}
