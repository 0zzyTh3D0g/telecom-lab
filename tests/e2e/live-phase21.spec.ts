import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const backendUrl = process.env.E2E_SUPABASE_URL || ''
const publicKey = process.env.E2E_SUPABASE_PUBLISHABLE_KEY || ''
const managerUsername = process.env.E2E_MANAGER_USERNAME || 'admin'
const managerPassword = process.env.E2E_MANAGER_PASSWORD || ''
const localBackend = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(backendUrl)

test('manager → member → Practice → Assignment → review → hostile backend calls', async ({ page, browser }) => {
  test.skip(!localBackend || !publicKey || !managerPassword, 'Richiede Supabase locale, migrazioni e Edge Functions attive; mai eseguire contro produzione.')
  test.setTimeout(300_000)
  const stamp = Date.now().toString(36)
  const groupName = `E2E ${stamp}`
  const moduleName = `E2E segnali ${stamp}`
  const visibleSlug = `e2e-visible-${stamp}`
  const hiddenSlug = `e2e-hidden-${stamp}`
  const assignmentTitle = `Compito E2E ${stamp}`
  const passwordAfterFirstLogin = `E2e-${stamp}-New-Password!`
  const memberNames = [{ firstName: 'Mario', lastName: 'Rossi' }, { firstName: 'Luigi', lastName: 'Bianchi' }]

  // Real backend setup, restricted to the explicitly configured local instance.
  const wid=process.env.E2E_WORKSPACE_ID||'10000000-0000-4000-8000-000000000001'
  const managerApi=createClient(backendUrl,publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{'x-workspace-id':wid}}})
  expect((await managerApi.auth.signInWithPassword({email:`${managerUsername}@accounts.telecomlab.invalid`,password:managerPassword})).error).toBeNull()
  const year=(await managerApi.from('academic_years').select('id').eq('status','active').single()).data!
  const track=(await managerApi.from('tracks').select('id').is('archived_at',null).limit(1).single()).data!
  const subject=(await managerApi.from('subjects').select('id').eq('slug','telecomunicazioni').single()).data!
  const oldLevel=(await managerApi.from('academic_levels').select('id').eq('code','3').maybeSingle()).data
  const levelId=oldLevel?.id||(await managerApi.rpc('save_level',{level_id:null,code_value:'3',label_value:'Terzo livello',order_value:3})).data
  expect(levelId).toBeTruthy()
  const configuredLevels=(await managerApi.from('track_levels').select('level_id').eq('track_id',track.id).order('sort_order')).data||[]
  expect((await managerApi.rpc('set_track_levels',{tid:track.id,level_ids:[...new Set([...configuredLevels.map(l=>l.level_id),levelId])]})).error).toBeNull()
  expect((await managerApi.rpc('save_subject_offering',{yid:year.id,tid:track.id,sid:subject.id,lid:null})).error).toBeNull()
  await test.step('FLOW A: manager crea gruppo e account', async () => {
    await page.goto('/#/login')
    await page.getByLabel('Username').fill(managerUsername)
    await page.getByLabel('Password',{ exact:true }).fill(managerPassword)
    await page.getByRole('button',{ name:'Accedi' }).click()
    await page.goto('/#/manage')
    await page.getByRole('button',{ name:'Gruppi',exact:true }).click()
    await page.getByRole('combobox',{name:'Anno scolastico',exact:true}).selectOption(year.id)
    await page.getByRole('combobox',{name:'Indirizzo',exact:true}).selectOption(track.id)
    await page.getByRole('combobox',{name:'Livello',exact:true}).selectOption(levelId)
    await page.getByLabel('Nome',{ exact:true }).fill(groupName)
    await page.getByRole('button',{ name:'Crea gruppo' }).click()
    await expect(page.getByText(groupName)).toBeVisible()
    await page.getByRole('button',{ name:'Utenti',exact:true }).click()
    await page.getByRole('combobox',{name:'Gruppo',exact:true}).selectOption({ label:groupName })
    await page.getByLabel('Creazione in massa (nome,cognome per riga)').fill(memberNames.map(person => `${person.firstName},${person.lastName}`).join('\n'))
    await page.getByRole('button',{ name:'Crea account' }).click()
    await expect(page.locator('.credential-box tbody tr')).toHaveCount(2)
  })

  const credentials = await page.locator('.credential-box tbody tr').allTextContents()
  const credentialRows = await Promise.all([0,1].map(async index => {
    const cells = page.locator('.credential-box tbody tr').nth(index).locator('td')
    return { username: (await cells.nth(1).innerText()).trim(), password: (await cells.nth(2).innerText()).trim() }
  }))
  expect(credentials.join(' ')).toContain('Mario')

  const lesson = (slug: string, title: string, module: string, includePractice: boolean) => ({
    schemaVersion:3,id:slug,slug,subject:'telecomunicazioni',title,summary:'Contenuto di collaudo locale.',levelCode:'3',module,topic:'Segnali',tags:['e2e'],order:1,
    blocks:[{type:'paragraph',text:'Il periodo è inverso della frequenza.'},...(includePractice ? [{type:'practiceQuestion',id:'practice-periodo',title:'Prova il periodo',prompt:'Qual è il periodo di 500 Hz?',difficulty:'base',answer:{kind:'number',value:0.002,tolerance:0.000001,unit:'s'},hints:[],solution:'2 ms'}] : [])],
    generationWarnings:[],assignments:includePractice ? [{id:'assignment-periodo',title:assignmentTitle,description:'Collaudo di domande chiuse e aperte.',questions:[
      {id:'closed-periodo',type:'singleChoice',prompt:'Quanto vale il periodo?',difficulty:'base',options:[{id:'two-ms',text:'2 ms'},{id:'one-ms',text:'1 ms'}],hints:[],points:1},
      {id:'open-periodo',type:'shortOpen',prompt:'Spiega il rapporto tra frequenza e periodo.',difficulty:'base',hints:[],points:1},
    ],privateKeys:{'closed-periodo':{answer:'two-ms',solution:'2 ms'},'open-periodo':{answer:null,rubric:'Descrive T = 1/f e le unità.',solution:'T = 1/f.'}}}] : [],
  })

  await test.step('FLOW A: importa, autorizza e pubblica', async () => {
    for (const doc of [lesson(visibleSlug,'Lezione visibile',moduleName,true),lesson(hiddenSlug,'Lezione riservata',`E2E altro ${stamp}`,false)]) {
      await page.goto('/#/import')
      await page.locator('#json-source').fill(JSON.stringify(doc))
      await page.getByRole('button',{ name:'Valida e mostra anteprima' }).click()
      await expect(page.getByText('Schema valido')).toBeVisible()
      await page.getByRole('button',{ name:'Salva nuova bozza' }).click()
      await expect(page.getByText(/Bozza salvata come versione 1/)).toBeVisible()
    }
    await page.goto('/#/manage')
    await page.getByRole('button',{ name:'Contenuti',exact:true }).click()
    await page.getByRole('combobox',{name:'Gruppo',exact:true}).selectOption({ label:groupName })
    await page.locator('.access-module').filter({hasText:moduleName}).locator('summary').click()
    await page.locator('.access-module').filter({hasText:moduleName}).getByRole('button',{name:'Abilita intero modulo'}).click()
    await expect(page.getByText('Modulo e risorse abilitati.')).toBeVisible()
    const distribution=page.locator('.data-list article').filter({has:page.getByText('Lezione visibile',{exact:true})}).locator('.content-releases')
    await distribution.locator('summary').click()
    await distribution.getByRole('combobox',{name:'Gruppo pubblicazione',exact:true}).selectOption({label:`${groupName} · 2026/2027`})
    await distribution.getByRole('button',{name:'Anteprima differenze'}).click()
    await distribution.getByRole('checkbox').check()
    await distribution.getByRole('button',{name:'Pubblica v1 al gruppo',exact:true}).click()
    await expect(distribution.getByText(/Pubblicazione aggiornata a v1/)).toBeVisible()
    await page.getByRole('button',{ name:'Compiti',exact:true }).click()
    await page.getByRole('combobox',{name:'Contenuto',exact:true}).selectOption({label:'Lezione visibile'})
    await page.getByRole('combobox',{name:'Gruppo',exact:true}).selectOption({label:groupName})
    await page.getByRole('button',{name:'Crea bozza compito'}).click()
    await expect(page.getByText('Compito creato come bozza. Pubblicalo dopo la revisione.')).toBeVisible()
    await page.locator('.data-list article').filter({hasText:assignmentTitle}).locator('select').first().selectOption('published')
  })

  const memberContext = await browser.newContext()
  const memberPage = await memberContext.newPage()
  await test.step('FLOW B: member vede solo la lezione autorizzata e svolge Practice', async () => {
    await memberPage.goto('/#/login')
    await memberPage.getByLabel('Username').fill(credentialRows[0].username)
    await memberPage.getByLabel('Password',{exact:true}).fill(credentialRows[0].password)
    await memberPage.getByRole('button',{name:'Accedi'}).click()
    await expect(memberPage.getByRole('heading',{name:'Imposta una nuova password'})).toBeVisible()
    await memberPage.getByLabel('Nuova password').fill(passwordAfterFirstLogin)
    await memberPage.getByLabel('Conferma').fill(passwordAfterFirstLogin)
    await memberPage.getByRole('button',{name:'Salva password'}).click()
    await memberPage.goto('/#/login')
    await expect(memberPage.getByText('Lezione visibile').first()).toBeVisible()
    await expect(memberPage.getByText('Lezione riservata')).toHaveCount(0)
    await memberPage.goto(`/#/lesson/${visibleSlug}`)
    await memberPage.getByLabel('La tua risposta').fill('2 ms')
    await memberPage.getByRole('button',{name:'Verifica'}).click()
    await expect(memberPage.getByText(/Corretto|Passo successivo|Concludi/).first()).toBeVisible()
  })

  await test.step('FLOW C: risposta chiusa, aperta e correzione', async () => {
    await memberPage.goto('/#/assignments')
    await memberPage.getByText(assignmentTitle).click()
    const cards = memberPage.locator('.assignment-list .exercise-card')
    await cards.nth(0).getByLabel('2 ms').check()
    await cards.nth(0).getByRole('button',{name:'Invia risposta'}).click()
    await expect(cards.nth(0).getByText('Risposta corretta.')).toBeVisible()
    await cards.nth(1).getByLabel('Risposta aperta').fill('Il periodo T è 1/f; con f in Hz il periodo è in secondi.')
    await cards.nth(1).getByRole('button',{name:'Invia risposta'}).click()
    await expect(cards.nth(1).getByText(/attesa di correzione/)).toBeVisible()
    await page.goto('/#/manage')
    await page.getByRole('button',{name:'Correzioni',exact:true}).click()
    const review = page.locator('.review-card').filter({hasText:assignmentTitle}).first()
    await expect(review).toBeVisible()
    await review.getByLabel('Giudizio').fill('Corretto')
    await review.getByLabel('Feedback').fill('Relazione e unità spiegate correttamente.')
    await review.getByLabel('Stato').selectOption('reviewed')
    await review.getByRole('button',{name:'Salva e successiva'}).click()
    await memberPage.reload()
    await expect(memberPage.getByText('Relazione e unità spiegate correttamente.')).toBeVisible()
  })

  await test.step('SECURITY E2E: chiamate backend ostili con JWT member', async () => {
    const api = createClient(backendUrl,publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{'x-workspace-id':process.env.E2E_WORKSPACE_ID||'10000000-0000-4000-8000-000000000001'}}})
    const { data: auth, error: loginError } = await api.auth.signInWithPassword({ email:`${credentialRows[0].username}@accounts.telecomlab.invalid`,password:passwordAfterFirstLogin })
    expect(loginError).toBeNull()
    const ownId = auth.user!.id
    const keys = await api.from('private_answer_keys').select('*')
    expect(keys.error).toBeNull(); expect(keys.data).toEqual([])
    const hidden = await api.from('content_items').select('title,slug').eq('slug',hiddenSlug)
    expect(hidden.data).toEqual([])
    const otherProfiles = await api.from('profiles').select('id').neq('id',ownId)
    expect(otherProfiles.data).toEqual([])
    const otherAttempts = await api.from('attempts').select('id').neq('user_id',ownId)
    expect(otherAttempts.data).toEqual([])
    const otherActivity = await api.from('lesson_activity').select('user_id').neq('user_id',ownId)
    expect(otherActivity.data).toEqual([])
    const altered = await api.from('content_items').update({title:'Alterata'}).eq('slug',visibleSlug).select('id')
    expect(Boolean(altered.error) || altered.data?.length === 0).toBe(true)
    const ownReview = await api.from('reviews').select('attempt_id').limit(1)
    if (ownReview.data?.[0]) {
      const edit = await api.from('reviews').update({feedback:'Falsificato'}).eq('attempt_id',ownReview.data[0].attempt_id).select('attempt_id')
      expect(edit.data).toEqual([])
    }
    const questions = await api.from('questions').select('id').limit(1)
    const forgedAttempt = await api.from('attempts').insert({question_id:questions.data![0].id,user_id:ownId,attempt_number:99,answer:'forged'})
    expect(forgedAttempt.error).not.toBeNull()
    const content = await api.rpc('resolve_lesson',{content_slug:visibleSlug,subject_slug:'telecomunicazioni'})
    expect(content.error).toBeNull();expect(content.data.release_id).toBeTruthy()
    const forgedActivity = await api.from('lesson_activity').insert({user_id:ownId,content_id:content.data!.id,active_seconds:99999})
    expect(forgedActivity.error).not.toBeNull()
    const otherEnrollments=await api.from('enrollments').select('id').neq('user_id',ownId);expect(otherEnrollments.data).toEqual([])
    const otherVersionActivity=await api.from('lesson_release_activity').select('user_id').neq('user_id',ownId);expect(otherVersionActivity.data).toEqual([])
    const newEnrollment=await api.from('enrollments').insert({user_id:ownId});expect(newEnrollment.error).not.toBeNull()
    const releaseEdit=await api.from('content_releases').update({content_version:99});expect(releaseEdit.error).not.toBeNull()
    const adminAction = await api.functions.invoke('admin-accounts',{body:{action:'create',account:{firstName:'No',lastName:'Access'}}})
    expect(adminAction.error).not.toBeNull()
  })
  await memberContext.close()
})

