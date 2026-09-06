export const apiEndpoint = (baseUrl, path) => `${baseUrl.replace(/\/$/, '')}${path}`

async function requestBody(path, options = {}, auth = '', baseUrl = '', parse = (text) => text ? JSON.parse(text) : null) {
  const headers = new Headers(options.headers || {})
  if (auth) headers.set('Authorization', `Basic ${btoa(auth)}`)
  const res = await fetch(apiEndpoint(baseUrl, path), { ...options, headers })
  if (!res.ok) {
    const error = new Error(`${res.status} ${res.statusText || 'Request failed'}`)
    error.status = res.status
    throw error
  }
  const text = await res.text()
  return parse(text)
}

export const request = (path, options = {}, auth = '', baseUrl = '') => requestBody(path, options, auth, baseUrl)
export const requestText = (path, options = {}, auth = '', baseUrl = '') => requestBody(path, options, auth, baseUrl, (text) => text)
