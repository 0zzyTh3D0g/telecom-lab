import { expect,test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { mockWorkspace } from './product-fixture'

function tinyPdf(text:string) {
 const stream=text?`BT /F1 12 Tf 50 750 Td (${text.replace(/[()\\]/g,'\\$&')}) Tj ET`:''
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
 let result='%PDF-1.4\n';const offsets=[0]
 objects.forEach((o,i)=>{offsets.push(result.length);result+=`${i+1} 0 obj\n${o}\nendobj\n`})
 const xref=result.length;result+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
 return Buffer.from(result)
}

test('extracts textual PDF locally, confirms selected excerpt with page provenance, and explains scans',async({page})=>{
 const f=await mockWorkspace(page),posts:string[]=[]
 page.on('request',r=>{if(r.method()==='POST')posts.push(r.url())})
 await page.goto('/#/planning');await page.getByRole('button',{name:'Fonti',exact:true}).click()
 const initial=posts.length
 await page.getByLabel('Carica PDF testuale').setInputFiles({name:'programma.pdf',mimeType:'application/pdf',buffer:tinyPdf('Studiare frequenza periodo e segnali: T = 1/f.')})
 await expect(page.getByText(/1 pagine · 0 selezionate/)).toBeVisible()
 expect(posts.length).toBe(initial)
 await page.getByText('Pagina 1 ·',{exact:false}).click()
 await page.getByLabel('Includi pagina 1').check()
 await page.getByLabel('Testo / estratto pagina 1').fill('Studiare frequenza periodo: T = 1/f.')
 await page.getByRole('button',{name:'Conferma testo selezionato',exact:true}).click()
 await expect(page.getByLabel('Testo della fonte')).toHaveValue('Pagina 1\nStudiare frequenza periodo: T = 1/f.')
 await page.getByLabel('Titolo',{exact:true}).fill('Programma da PDF')
 await page.getByRole('button',{name:'Salva fonte',exact:true}).click()
 expect((f.tables.curriculum_sources[0] as any).metadata.pages[0].page_number).toBe(1)
 for(const width of [320,375,768,1024,1440]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true)}
 await page.screenshot({path:'test-results/p32-pdf-source.png',fullPage:true})
 await page.getByLabel('Carica PDF testuale').setInputFiles({name:'scansione.pdf',mimeType:'application/pdf',buffer:tinyPdf('')})
 await expect(page.getByText('Il documento sembra essere composto prevalentemente da immagini/scansioni.',{exact:false})).toBeVisible()
 await expect(page.getByRole('button',{name:'Conferma testo selezionato',exact:true})).toBeDisabled()
})

test('browser wizard applies a 20-account annual rollover against real PostgreSQL/RLS and keeps release v1 when draft v2 is saved',async({page})=>{
 test.setTimeout(120000)
 page.setDefaultTimeout(15000)
 const f=await mockWorkspace(page),pg=new PGlite(),source=f.yid
 const uuid=(n:number)=>`35000000-0000-4000-8000-${String(n).padStart(12,'0')}`
 const one=async<T,>(sql:string,args:unknown[]=[])=> (await pg.query<{v:T}>(sql,args)).rows[0].v
 try {
 await pg.exec("create role authenticated;create role anon;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated,anon,service_role")
 for(const name of ['202609300001_phase2.sql','202609300002_phase21_hardening.sql'])await pg.exec(readFileSync(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8').replace('create extension if not exists pgcrypto;',''))
 for(const [i,uid] of [f.uid,...Array.from({length:20},(_,i)=>uuid(i+1))].entries()){
 await pg.query('insert into auth.users values($1,$2)',[uid,`u${i}@invalid`]);await pg.query("insert into public.profiles(id,username,first_name,last_name,role,must_change_password) values($1,$2,'Nome','Cognome',$3,false)",[uid,i?'member'+String(i).padStart(2,'0'):f.profile.username,i?'member':'manager']) }
 for(const name of ['202610010003_phase3_workspace.sql','202610010004_phase31_context_curriculum.sql','202610010005_phase32_academic_lifecycle.sql','202610010006_phase32_activity_reports.sql','202610010007_phase32_integrity_guards.sql'])await pg.exec(readFileSync(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'))
 await pg.query('update public.academic_years set id=$1 where workspace_id=$2',[source,f.wid])
 await pg.exec(`select set_config('request.jwt.claim.sub','${f.uid}',false);set role authenticated`);await pg.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-workspace-id':f.wid})])
 const track=await one<string>('select id v from public.tracks'),sid=f.subjects[0].id
 const l4=await one<string>("select public.save_level(null,'4','Quarto livello',1) v"),l5=await one<string>("select public.save_level(null,'5','Quinto livello',2) v")
 await pg.query('select public.set_track_levels($1,array[$2,$3]::uuid[])',[track,l4,l5])
 const year2=await one<string>("select public.save_academic_year(null,'2027/2028','2027-09-01','2028-08-31','upcoming') v")
 const addGroup=(name:string,level:string,year=source,tid=track)=>one<string>('insert into public.groups(workspace_id,academic_year_id,track_id,name,level_id) values($1,$2,$3,$4,$5) returning id v',[f.wid,year,tid,name,level])
 const g4a=await addGroup('4A',l4),g4b=await addGroup('4B',l4),g5=await addGroup('5A',l5,year2),repeat=await addGroup('4B',l4,year2),split=await addGroup('5B',l5,year2)
 const track2=await one<string>("select public.save_track('Altro percorso','',array[$1]::uuid[]) v",[sid]);await pg.query('select public.set_track_levels($1,array[$2,$3]::uuid[])',[track2,l4,l5]);const changed=await addGroup('5C',l5,year2,track2)
 for(let i=0;i<20;i++)await pg.query('select public.set_member_group($1,$2)',[uuid(i+1),i<10?g4a:g4b])
 await pg.query('select public.save_subject_offering($1,$2,$3,null)',[source,track,sid])
 const document={schemaVersion:3,id:'release-test',slug:'release-test',subject:'telecomunicazioni',levelCode:'4',title:'Versione uno',summary:'Test storico',module:'Segnali',topic:'Test',tags:['test'],order:0,blocks:[{type:'paragraph',text:'Materiale v1'}],assignments:[]}
 const content=await one<{contentId:string}>('select public.save_content_document($1,null) v',[document]);await pg.query('select public.save_group_access($1,$2,true,true,true,true,true)',[content.contentId,g4a]);const release=await one<string>('select public.publish_content_release($1,$2,1) v',[content.contentId,g4a])
 await pg.query('select public.save_content_document($1,$2)',[{...document,title:'Versione due',blocks:[{type:'paragraph',text:'Materiale v2'}]},content.contentId])
 expect(await one<number>('select content_version v from public.content_releases where id=$1',[release])).toBe(1)
 const tables=new Set(['academic_years','tracks','academic_levels','track_levels','groups','enrollments','subject_offerings','content_releases'])
 const rpcArgs:Record<string,string[]>={prepare_rollover:['source_year','destination_year'],rollover_preview:['bid'],save_rollover_choices:['bid','choices','expected_revision'],apply_rollover:['bid','expected_revision'],cancel_rollover:['bid'],save_academic_year:['year_id','year_label','start_on','end_on','year_status'],activate_academic_year:['yid','archive_previous']}
 // Real RPCs execute as authenticated owner, never as the database/service owner.
 // Auth transport remains a UI fixture: this does not claim live Supabase Auth verification.
 await page.route('**/rest/v1/**',async route=>{
 const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').at(-1)!
 if(url.pathname.includes('/rpc/')&&rpcArgs[name]){
 const body=req.postDataJSON(),args=rpcArgs[name].map(k=>body[k]);try{const value=await one(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) v`,args);await route.fulfill({json:value})}catch(e){await route.fulfill({status:400,json:{message:(e as Error).message}})}return }
 if(tables.has(name)&&req.method()==='GET'){
 let sql=`select * from public.${name}`,args:unknown[]=[],filters:string[]=[]
 for(const [key,value] of url.searchParams)if(/^[a-z_]+$/.test(key)&&value.startsWith('eq.')){args.push(value.slice(3));filters.push(`${key}=$${args.length}`)}
 if(filters.length)sql+=' where '+filters.join(' and ')
 const rows=(await pg.query(sql,args)).rows.map((r:any)=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v instanceof Date&&['start_date','end_date','started_at','ended_at'].includes(k)?v.toISOString().slice(0,10):v])));await route.fulfill({json:rows});return }
 await route.fallback()
 })
 await page.goto('/#/manage');await page.getByRole('button',{name:'Struttura',exact:true}).click()
 const wizard=page.locator('.rollover')
 await wizard.getByRole('button',{name:'Scegli destinazione',exact:true}).click();await wizard.getByRole('combobox',{name:'Anno destinazione',exact:true}).selectOption(year2)
 await wizard.getByRole('button',{name:'Prepara struttura',exact:true}).click();await wizard.getByRole('button',{name:'Mappatura gruppi',exact:true}).click();await wizard.getByRole('button',{name:'Genera proposte e bozza',exact:true}).click()
 await expect(wizard.locator('.rollover-entry')).toHaveCount(20)
 for(let i=1;i<=20;i++){
 const username='member'+String(i).padStart(2,'0'),decision=i<=14?'advance':i<=16?'repeat':i===17?'change_group':i===18?'change_track':i===19?'complete':'exit'
 await wizard.getByRole('combobox',{name:`Esito di ${username}`,exact:true}).selectOption(decision)
 if(i<=18)await wizard.getByRole('combobox',{name:`Destinazione di ${username}`,exact:true}).selectOption(i<=14?g5:i<=16?repeat:i===17?split:changed)
 }
 await wizard.getByRole('button',{name:'Verifica eccezioni',exact:true}).click();await wizard.getByRole('button',{name:'Anteprima completa',exact:true}).click()
 await expect(wizard.getByRole('heading',{name:'Anteprima · 20 persone'})).toBeVisible();await expect(wizard.locator('.feedback.error')).toHaveCount(0)
 for(const width of [320,375,768,1024,1440]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true)}
 await page.screenshot({path:'test-results/p32-rollover-preview.png',fullPage:true})
 await wizard.getByRole('button',{name:'Conferma finale',exact:true}).click();await wizard.getByLabel('Confermo esiti e destinazioni.',{exact:false}).check();await wizard.getByRole('button',{name:'Applica passaggio anno',exact:true}).click()
 await expect(wizard.getByRole('heading',{name:'Passaggio completato',exact:true})).toBeVisible()
 expect(await one<number>("select count(*)::int v from public.enrollments where academic_year_id=$1 and status='active'",[year2])).toBe(18)
 expect(await one<number>("select count(*)::int v from public.enrollments where academic_year_id=$1 and status<>'active'",[source])).toBe(20)
 expect(await one<number>('select count(*)::int v from public.profiles')).toBe(21)
 expect(await one<number>('select content_version v from public.content_releases where id=$1',[release])).toBe(1)
 await page.screenshot({path:'test-results/p32-rollover-report.png',fullPage:true})
 }finally{await pg.close()}
})
