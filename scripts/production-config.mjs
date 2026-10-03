import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function validateProductionConfig(env) {
  const rawUrl = env.VITE_SUPABASE_URL?.trim()
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!rawUrl || !key) throw new Error('Configurare VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY nelle repository variables prima del deploy.')
  let url
  try { url = new URL(rawUrl) } catch { throw new Error('VITE_SUPABASE_URL deve essere un URL HTTPS valido.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !['', '/'].includes(url.pathname) || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('VITE_SUPABASE_URL deve indicare l’origine HTTPS del progetto production, senza credenziali, percorsi o parametri.')
  }
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return
  try {
    const parts = key.split('.')
    if (parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) {
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      if (claims.role === 'anon') return
    }
  } catch { /* Invalid public credential: use the same redacted error below. */ }
  throw new Error('Chiave frontend non consentita: usare soltanto sb_publishable o JWT anon. Mai service-role, secret key o access token.')
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    validateProductionConfig(process.env)
    console.log('Configurazione pubblica production valida; nessun valore di chiave stampato.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
