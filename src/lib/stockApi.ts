export async function updateProduct(token: string | null | undefined, productPayload: Record<string, unknown>) {
  const res = await fetch('/api/portal/products', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
    body: JSON.stringify(productPayload),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}
export async function updateStock(token: string | null | undefined, stockPayload: Record<string, unknown>) {
  const res = await fetch('/api/portal/stock', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
    body: JSON.stringify(stockPayload),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}
export async function deleteProduct(token: string | null | undefined, id: string) {
  const res = await fetch('/api/portal/products', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
    body: JSON.stringify({ id }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}
