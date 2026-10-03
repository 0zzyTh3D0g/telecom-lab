import { createClient } from 'npm:@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
function injectedKey(name: string, fallback: string) {
  const keys = Deno.env.get(name)
  if (keys) { const parsed = JSON.parse(keys) as Record<string, string>; const key = parsed.default || Object.values(parsed)[0]; if (key) return key }
  const legacy = Deno.env.get(fallback)
  if (!legacy) throw new Error(`Missing ${name}`)
  return legacy
}
const anonKey = injectedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
const serviceKey = injectedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
export const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
export function cors(request: Request) {
  const origin = request.headers.get('origin') || ''
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(v => v.trim())
  return { 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-workspace-id', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
}
export function json(request: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: cors(request) }) }
export async function caller(request: Request, accountOnly = false) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /i, '')
  if (!token) return null
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return null
  const { data: profile } = await admin.from('profiles').select('id,disabled,must_change_password').eq('id', data.user.id).single()
  if (!profile) return null
  if (accountOnly) return {...profile,workspace_id:'',role:''}
  const wid = request.headers.get('x-workspace-id')
  if (!wid || !/^[0-9a-f-]{36}$/i.test(wid)) return null
  const [{data:membership},{data:workspace}] = await Promise.all([
    admin.from('workspace_memberships').select('workspace_id,role,disabled').eq('workspace_id',wid).eq('user_id',profile.id).maybeSingle(),
    admin.from('workspaces').select('id').eq('id',wid).is('archived_at',null).maybeSingle(),
  ])
  if(!membership || !workspace) return null
  return {...profile,...membership,disabled:profile.disabled||membership.disabled}
}
export function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')
}
export function usernameBase(first: string, last: string) {
  return (first + last).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 34)
}
export function internalEmail(username: string) { return `${username}@accounts.telecomlab.invalid` }
