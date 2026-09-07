const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

export const highlightYaml = (source) => String(source).split('\n').map((line) => {
  const escaped = escapeHtml(line)
  const commentIndex = escaped.indexOf('#')
  const content = commentIndex >= 0 ? escaped.slice(0, commentIndex) : escaped
  const comment = commentIndex >= 0 ? `<span class="yaml-token-comment">${escaped.slice(commentIndex)}</span>` : ''
  const highlighted = content.replace(/^(\s*)([-?]?\s*[\w.-]+)(:)/, '$1<span class="yaml-token-key">$2</span>$3').replace(/(:\s*)(["']?[^\s,}\]]+["']?)(\s*)$/, '$1<span class="yaml-token-value">$2</span>$3')
  return `${highlighted}${comment}`
}).join('\n')
