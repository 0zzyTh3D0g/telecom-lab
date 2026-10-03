import { admin, caller, cors, internalEmail, json, randomPassword, usernameBase } from '../_shared/security.ts'

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors(request) })
  if (request.method !== 'POST') return json(request, { error: 'method_not_allowed' }, 405)
  const actor = await caller(request)
  if (!actor || !['owner','manager'].includes(actor.role) || actor.disabled || actor.must_change_password) return json(request, { error: 'access_denied' }, 403)
  const memberTarget = async (id: string) => {
    const { data, error } = await admin.from('workspace_memberships').select('role').eq('user_id',id).eq('workspace_id',actor.workspace_id).single()
    if (error || !data || (actor.role !== 'owner' && data.role !== 'member')) throw new Error('account_target_denied')
  }
  const singleInstitution = async(id:string)=>{
    const {data,error}=await admin.from('workspace_memberships').select('workspace_id,role').eq('user_id',id)
    if(error||!data||data.length!==1||data[0].workspace_id!==actor.workspace_id)throw new Error('shared_account_requires_global_operator')
  }
  try {
    const input = await request.json()
    if (input.action === 'create') {
      const accounts = Array.isArray(input.accounts) ? input.accounts : [input.account]
      if (!accounts.length || accounts.length > 100) return json(request, { error: 'invalid_batch_size' }, 400)
      const created: { username: string; password: string; firstName: string; lastName: string }[] = []
      const ids: string[] = []
      const records: {id:string;username:string;firstName:string;lastName:string;groupId:string|null}[]=[]
      const pendingUsernames=new Set<string>()
      const rollback = async () => { for (const id of ids) await admin.auth.admin.deleteUser(id) }
      for (const item of accounts) {
        const firstName = String(item?.firstName || '').trim().slice(0, 80)
        const lastName = String(item?.lastName || '').trim().slice(0, 80)
        const base = usernameBase(firstName, lastName)
        if (!firstName || !lastName || base.length < 3) { await rollback(); return json(request, { error: 'invalid_name' }, 400) }
        let username = base
        for (let suffix = 1; suffix < 1000; suffix++) {
          const candidate = suffix === 1 ? base : `${base}${suffix}`
          const { data } = await admin.from('profiles').select('id').eq('username', candidate).maybeSingle()
          if (!data&&!pendingUsernames.has(candidate)) { username = candidate;pendingUsernames.add(candidate); break }
        }
        const password = randomPassword()
        const { data: user, error: authError } = await admin.auth.admin.createUser({ email: internalEmail(username), password, email_confirm: true })
        if (authError || !user.user) { await rollback(); return json(request, { error: authError?.message || 'account_creation_failed' }, 400) }
        ids.push(user.user.id)
        records.push({id:user.user.id,username,firstName,lastName,groupId:item.groupId||null})
        created.push({ username, password, firstName, lastName })
      }
      const {error:registerError}=await admin.rpc('register_created_accounts',{actor:actor.id,wid:actor.workspace_id,accounts:records})
      if(registerError){await rollback();return json(request,{error:registerError.message},400)}
      return json(request, { created })
    }
    if (input.action === 'reset' && typeof input.userId === 'string') {
      await memberTarget(input.userId)
      await singleInstitution(input.userId)
      const password = randomPassword()
      const { error: flagError } = await admin.from('profiles').update({ must_change_password: true }).eq('id', input.userId)
      if (flagError) return json(request, { error: flagError.message }, 400)
      const { error } = await admin.auth.admin.updateUserById(input.userId, { password })
      if (error) return json(request, { error: error.message }, 400)
      await admin.from('audit_log').insert({ workspace_id:actor.workspace_id, actor_id: actor.id, action: 'password_reset', target_id: input.userId })
      return json(request, { password })
    }
    if (input.action === 'disable' && typeof input.userId === 'string' && input.userId !== actor.id) {
      await memberTarget(input.userId)
      const { error } = await admin.from('workspace_memberships').update({ disabled: Boolean(input.disabled) }).eq('user_id', input.userId).eq('workspace_id',actor.workspace_id)
      if (error) return json(request, { error: error.message }, 400)
      await admin.from('audit_log').insert({ workspace_id:actor.workspace_id, actor_id: actor.id, action: input.disabled ? 'account_disabled' : 'account_enabled', target_id: input.userId })
      return json(request, { ok: true })
    }
    if (input.action === 'delete' && typeof input.userId === 'string' && input.userId !== actor.id) {
      await memberTarget(input.userId)
      await singleInstitution(input.userId)
      const {count,error:historyError}=await admin.from('enrollments').select('id',{count:'exact',head:true}).eq('user_id',input.userId)
      const history=await Promise.all(['attempts','lesson_activity','practice_progress','lesson_release_activity','practice_release_progress'].map(table=>admin.from(table).select('user_id',{count:'exact',head:true}).eq('user_id',input.userId as string)))
      const authored=await Promise.all([['content_versions','created_by'],['curriculum_plan_versions','created_by'],['curriculum_sources','owner_id'],['curriculum_plans','owner_id'],['personal_library_items','owner_id'],['reviews','reviewer_id']].map(([table,column])=>admin.from(table).select(column,{count:'exact',head:true}).eq(column,input.userId as string)))
      if(historyError||count||history.some(r=>r.error||r.count)||authored.some(r=>r.error||r.count)) return json(request,{error:'historical_account_requires_retention_workflow'},400)
      const { error } = await admin.auth.admin.deleteUser(input.userId)
      if (error) return json(request, { error: error.message }, 400)
      await admin.from('audit_log').insert({ workspace_id:actor.workspace_id, actor_id: actor.id, action: 'account_deleted', target_id: input.userId })
      return json(request, { ok: true })
    }
    return json(request, { error: 'invalid_action' }, 400)
  } catch (error) { return json(request, { error: error instanceof Error ? error.message : 'invalid_request' }, 400) }
})
