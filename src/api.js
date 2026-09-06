export const apiEndpoint = (baseUrl, path) => `${baseUrl.replace(/\/$/, '')}${path}`

export async function request(path, options = {}, auth = '', baseUrl = '') {
  const headers = new Headers(options.headers || {})
  if (auth) headers.set('Authorization', `Basic ${btoa(auth)}`)
  const res = await fetch(apiEndpoint(baseUrl, path), { ...options, headers })
  if (!res.ok) {
    const error = new Error(`${res.status} ${res.statusText || 'Request failed'}`)
    error.status = res.status
    throw error
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}
