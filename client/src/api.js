const API = '/api/v1';
export async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...options.headers }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message || 'Something went wrong.'); error.code = data.error?.code; error.status = response.status; throw error; }
  return data;
}
