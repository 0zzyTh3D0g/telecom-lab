import { admin, caller, cors, json } from '../_shared/security.ts'

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors(request) })
  if (request.method !== 'POST') return json(request, { error: 'method_not_allowed' }, 405)
  const actor = await caller(request, true)
  if (!actor || actor.disabled) return json(request, { error: 'access_denied' }, 403)
  try {
    const { password } = await request.json()
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) return json(request, { error: 'password_length' }, 400)
    const { error } = await admin.auth.admin.updateUserById(actor.id, { password })
    if (error) return json(request, { error: error.message }, 400)
    const { error: profileError } = await admin.from('profiles').update({ must_change_password: false }).eq('id', actor.id)
    if (profileError) return json(request, { error: profileError.message }, 400)
    return json(request, { ok: true })
  } catch { return json(request, { error: 'invalid_request' }, 400) }
})
