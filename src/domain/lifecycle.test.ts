import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8').replace('create extension if not exists pgcrypto;', '')
const uuid = (n: number) => `32000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const wid = '10000000-0000-4000-8000-000000000001', sid = '20000000-0000-4000-8000-000000000001'

it('upgrades populated P3.1 without loss; enforces temporal cohorts, pinned releases, teaching scopes and an atomic 20-account rollover', async () => {
 const pg = new PGlite(), owner=uuid(1),reviewer=uuid(2),editor=uuid(3),members=Array.from({length:20},(_,i)=>uuid(i+10))
 const one = async <T>(sql:string,args:unknown[]=[]) => (await pg.query<{v:T}>(sql,args)).rows[0].v
 const assume = async(uid:string,workspace=wid) => { await pg.exec(`reset role;select set_config('request.jwt.claim.sub','${uid}',false);set role authenticated`);await pg.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-workspace-id':workspace})]) }
 const doc = (title='Fourier v3',subject='telecomunicazioni',level='4') => ({schemaVersion:3,id:'fourier',slug:'introduzione',subject,title,summary:'Serie',levelCode:level,module:'Segnali',topic:'Fourier',order:0,tags:['Fourier'],blocks:[{type:'paragraph',text:title},{type:'practiceQuestion',id:'p1',title:'Periodo',prompt:'Calcola',difficulty:'base',answer:{kind:'number',value:1},solution:'Uno'}],assignments:[]})
 try {
 await pg.exec("create role authenticated;create role anon;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$")
 await pg.exec('grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role')
 for(const name of ['202609300001_phase2.sql','202609300002_phase21_hardening.sql']) await pg.exec(migration(name))
 for(const [i,uid] of [owner,reviewer,editor,...members].entries()) {
 await pg.query('insert into auth.users values($1,$2)',[uid,`u${i}@invalid`]);await pg.query("insert into public.profiles(id,username,first_name,last_name,role,must_change_password) values($1,$2,'Nome','Cognome',$3,false)",[uid,`user${String(i).padStart(3,'0')}`,i===0?'manager':'member']) }
 for(const name of ['202610010003_phase3_workspace.sql','202610010004_phase31_context_curriculum.sql']) await pg.exec(migration(name))
 await assume(owner)
 const y1=await one<string>('select id v from public.academic_years'),tid=await one<string>('select id v from public.tracks')
 // Populated P3.1 contains both legacy levels, with real history before upgrade.
 const g4a=await one<string>("insert into public.groups(workspace_id,name,level) values($1,'4A',4) returning id v",[wid]),g4b=await one<string>("insert into public.groups(workspace_id,name,level) values($1,'4B',4) returning id v",[wid])
 const g3a=await one<string>("insert into public.groups(workspace_id,name,level) values($1,'3A',3) returning id v",[wid])
 for(const [i,uid] of members.entries()) await pg.query('select public.set_member_group($1,$2)',[uid,i===19?g3a:i<10?g4a:g4b])
 await pg.query("select public.set_staff_role($1,'reviewer',array[$2]::uuid[])",[reviewer,sid]);await pg.query("select public.set_staff_role($1,'editor',array[$2]::uuid[])",[editor,sid])
 let cid=''
 for(let v=1;v<=3;v++) { const legacy={...doc(`Fourier v${v}`),schemaVersion:2,year:4} as Record<string,unknown>;delete legacy.levelCode;const result=await one<{contentId:string;version:number}>('select public.save_content_document($1,$2) v',[legacy,cid||null]);cid=result.contentId }
 await pg.query("update public.content_items set status='published' where id=$1",[cid])
 for(const gid of [g4a,g4b]) await pg.query('select public.save_group_access($1,$2,true,true,true,true,true)',[cid,gid])
 const legacy3={...doc('Livello tre'),id:'livello-tre',slug:'livello-tre',schemaVersion:2,year:3} as Record<string,unknown>;delete legacy3.levelCode
 const cid3=(await one<{contentId:string}>('select public.save_content_document($1,null) v',[legacy3])).contentId
 await pg.query("update public.content_items set status='published' where id=$1",[cid3]);await pg.query('select public.save_group_access($1,$2,true,true,true,true,true)',[cid3,g3a])
 const payload={contentId:cid,groupId:g4a,maxAttempts:3,solutionRelease:'after_submission',draft:{id:'a1',title:'Compito',description:'',questions:[{id:'open',type:'shortOpen',prompt:'Spiega',difficulty:'base',points:1},{id:'closed',type:'trueFalse',prompt:'Vero?',difficulty:'base',points:1}],privateKeys:{open:{answer:null,rubric:'Chiarezza'},closed:{answer:true}}}}
 const aid=await one<string>('select public.create_assignment_bundle($1) v',[payload]);await pg.query("update public.assignments set status='published' where id=$1",[aid])
 const qid=await one<string>("select id v from public.questions where assignment_id=$1 and kind='shortOpen'",[aid])
 await assume(members[0]);await pg.query('select public.record_lesson_open($1)',[cid]);await pg.query("select public.record_practice_progress($1,'p1',true,true)",[cid]);await pg.query("select public.submit_assignment_answer($1,'\"Risposta storica\"')",[qid])
 await assume(owner)
 const widB=await one<string>("select public.create_workspace('Nautico B') v");await assume(owner,widB);const sidB=await one<string>("select public.save_subject(null,'fisica','Fisica','','blue') v")
 await pg.query("select public.attach_workspace_account('user003')");await pg.query("select public.save_academic_year(null,'2026/2027','2026-09-01','2027-08-31','active')")
 await assume(owner)
 const countsBefore=await one<Record<string,number>>("select jsonb_build_object('profiles',(select count(*) from public.profiles),'versions',(select count(*) from public.content_versions),'attempts',(select count(*) from public.attempts),'activity',(select count(*) from public.lesson_activity),'practice',(select count(*) from public.practice_progress),'reviews',(select count(*) from public.reviews),'memberships',(select count(*) from public.group_memberships)) v")
 await pg.exec('reset role');await pg.query('insert into public.group_memberships(group_id,user_id) values($1,$2)',[g4b,members[0]])
 await expect(pg.exec(migration('202610010005_phase32_academic_lifecycle.sql'))).rejects.toThrow('migration_ambiguous_enrollments')
 await pg.query('delete from public.group_memberships where group_id=$1 and user_id=$2',[g4b,members[0]])
 await pg.exec(migration('202610010005_phase32_academic_lifecycle.sql'));await pg.exec(migration('202610010006_phase32_activity_reports.sql'));await pg.exec(migration('202610010007_phase32_integrity_guards.sql'))
 const countsAfter=await one<Record<string,number>>("select jsonb_build_object('profiles',(select count(*) from public.profiles),'versions',(select count(*) from public.content_versions),'attempts',(select count(*) from public.attempts),'activity',(select count(*) from public.lesson_activity),'practice',(select count(*) from public.practice_progress),'reviews',(select count(*) from public.reviews),'memberships',(select count(*) from public.group_memberships)) v")
 expect(countsAfter).toEqual(countsBefore);expect(await one<number>('select count(*)::int v from public.enrollments')).toBe(20)
 await assume(owner)
 const l3=await one<string>("select id v from public.academic_levels where code='3'");expect(l3).toBeTruthy()
 const l4=await one<string>("select id v from public.academic_levels where code='4'"),l5=await one<string>("select public.save_level(null,'5','Quinto livello',2) v"),lBase=await one<string>("select public.save_level(null,'base','Base',0) v")
 await pg.query('select public.set_track_levels($1,$2::uuid[])',[tid,[lBase,l3,l4,l5]])
 const y2=await one<string>("select public.save_academic_year(null,'2027/2028','2027-09-01','2028-08-31','upcoming') v")
 const nextGroup=async(name:string,lid:string,track=tid) => one<string>('insert into public.groups(workspace_id,academic_year_id,track_id,name,level_id) values($1,$2,$3,$4,$5) returning id v',[wid,y2,track,name,lid])
 const g5=await nextGroup('5A',l5),repeatGroup=await nextGroup('4B',l4),g5b=await nextGroup('5B',l5)
 const t2=await one<string>("select public.save_track('Altro indirizzo','',array[$1]::uuid[]) v",[sid]);await pg.query('select public.set_track_levels($1,$2::uuid[])',[t2,[l4,l5]])
 const changedTrack=await nextGroup('5C',l5,t2)
 await pg.query('select public.change_enrollment($1,$2,current_date)',[members[19],g4b])
 // Teacher assignment is separate from authoring; reviewer denied until explicitly scoped.
 await assume(reviewer);expect(await one<number>('select count(*)::int v from public.attempts')).toBe(0)
 await assume(owner);await pg.query('select public.set_teaching_assignment($1,$2,$3,true)',[reviewer,sid,g3a]);await assume(reviewer);expect(await one<number>('select count(*)::int v from public.attempts')).toBe(0)
 await assume(owner);await pg.query('select public.set_teaching_assignment($1,$2,$3,true)',[reviewer,sid,g4a])
 await assume(reviewer);expect(await one<number>('select count(*)::int v from public.attempts')).toBe(0)
 // P3.1 answers with unknown cohort remain manager-only. New submissions record
 // the actual enrollment, so later group changes never broaden reviewer access.
 await assume(members[0]);await pg.query("select public.submit_assignment_answer($1,'\"Risposta P3.2\"')",[qid])
 await assume(reviewer);expect(await one<number>('select count(*)::int v from public.attempts')).toBe(1)
 expect(await one<boolean>('select app_private.can_read_group($1) v',[g4b])).toBe(false)
 await assume(editor);expect(await one<number>('select count(*)::int v from public.attempts')).toBe(0)
 await assume(members[0]);let catalog=await one<{id:string;title:string;release_id:string;content_version:number}[]>('select public.catalog_page() v')
 expect(catalog[0].title).toBe('Fourier v3');expect(catalog[0].content_version).toBe(3)
 const release3=catalog[0].release_id
 // Actual records of other members make hostile SELECT checks meaningful.
 await assume(members[1]);await pg.query('select public.record_release_open($1)',[release3]);await pg.query("select public.record_release_practice($1,'p1',true,true)",[release3])
 await assume(members[2]);await pg.query("select public.submit_assignment_answer($1,'\"Solo compito\"')",[qid]);await assume(members[0])
 expect(await one<number>('select count(*)::int v from public.attempts where user_id<>auth.uid()')).toBe(0)
 await pg.query('select public.record_release_open($1)',[release3]);await pg.query("select public.record_release_practice($1,'p1',true,true)",[release3])
 await expect(pg.query('select public.record_release_activity($1,120)',[release3])).rejects.toThrow()
 expect(await one<number>('select count(*)::int v from public.content_items')).toBe(0)
 expect(await one<number>('select count(*)::int v from public.content_resources')).toBe(0)
 expect(await one<number>('select count(*)::int v from public.private_answer_keys')).toBe(0)
 expect(await one<unknown[]>("select public.search_catalog('Livello tre') v")).toEqual([])
 expect(await one<unknown>("select public.resolve_lesson('livello-tre','telecomunicazioni') v")).toBeNull()
 expect(await one<string>("select public.resolve_lesson('introduzione','telecomunicazioni')->>'title' v")).toBe('Fourier v3')
 expect(await one<unknown[]>("select public.search_catalog('Fourier') v")).toHaveLength(1)
 expect(await one<number>('select count(*)::int v from public.enrollments where user_id<>auth.uid()')).toBe(0)
 expect(await one<number>('select count(*)::int v from public.teaching_assignments')).toBe(0)
 expect(await one<number>('select count(*)::int v from public.lesson_release_activity where user_id<>auth.uid()')).toBe(0)
 await expect(pg.query("insert into public.attempts(question_id,user_id,attempt_number,answer) values($1,$2,9,'{}')",[qid,members[0]])).rejects.toThrow()
 await expect(pg.query('insert into public.lesson_release_activity(user_id,release_id,active_seconds) values($1,$2,99999)',[members[0],release3])).rejects.toThrow()
 await expect(pg.query("update public.content_items set title='Ostile'")).rejects.toThrow()
 expect((await pg.query("update public.reviews set feedback='Ostile'")).affectedRows).toBe(0)
 await expect(pg.query("select public.register_created_accounts($1,$2,'[]')",[owner,wid])).rejects.toThrow()
 // Disabled and first-password accounts cannot use catalogs, search or releases.
 for(const flag of ['disabled','must_change_password']){
 await pg.exec('reset role');await pg.query(`update public.profiles set ${flag}=true where id=$1`,[members[0]]);await assume(members[0])
 expect(await one<unknown[]>('select public.catalog_page() v')).toEqual([]);await expect(pg.query('select public.record_release_open($1)',[release3])).rejects.toThrow()
 await pg.exec('reset role');await pg.query(`update public.profiles set ${flag}=false where id=$1`,[members[0]]);await assume(members[0])}
 for(const table of ['academic_levels','track_levels','enrollments','subject_offerings','teaching_assignments','rollover_batches','rollover_entries','content_releases','lesson_release_activity','practice_release_progress']) await expect(pg.query(`delete from public.${table}`)).rejects.toThrow()
 await expect(pg.query('select public.apply_rollover($1,1)',[uuid(999)])).rejects.toThrow()
 await expect(pg.query('select public.change_enrollment($1,$2,current_date)',[members[1],g4a])).rejects.toThrow()
 await assume(owner);const saved=await one<{version:number}>('select public.save_content_document($1,$2) v',[{...doc('Fourier v4'),slug:'introduzione-bozza'},cid]);expect(saved.version).toBe(4)
 await assume(members[0]);catalog=await one('select public.catalog_page() v');expect(catalog[0].title).toBe('Fourier v3');expect((catalog[0]as unknown as {slug:string}).slug).toBe('introduzione');expect(await one<string>("select public.resolve_lesson('introduzione','telecomunicazioni')->>'title' v")).toBe('Fourier v3')
 await assume(owner);const release4=await one<string>('select public.publish_content_release($1,$2,4) v',[cid,g4a])
 await assume(members[0]);catalog=await one('select public.catalog_page() v');expect(catalog[0].title).toBe('Fourier v4')
 expect(await one<number>('select count(*)::int v from public.practice_release_progress where release_id=$1',[release3])).toBe(1)
 await expect(pg.query("select public.record_release_practice($1,'p1',true,true)",[release3])).rejects.toThrow()
 // Same slug and portable ID may coexist in another subject.
 await assume(owner);await one<string>("select public.save_subject(null,'matematica','Matematica','','blue') v")
 expect((await one<{version:number}>('select public.save_content_document($1,null) v',[doc('Introduzione','matematica')])).version).toBe(1)
 // Assignment snapshot cannot be edited even by its author.
 await pg.exec('reset role');await expect(pg.query("update public.questions set prompt='Alterata' where id=$1",[qid])).rejects.toThrow('published_assignment_snapshot_immutable')
 await assume(owner)
 // Mid-year move closes old enrollment and immediately switches group access.
 const oldE=await one<string>('select id v from public.enrollments where user_id=$1 and status=\'active\'',[members[0]])
 await pg.query('select public.change_enrollment($1,$2,current_date)',[members[0],g4b])
 expect(await one<string>('select status v from public.enrollments where id=$1',[oldE])).toBe('transferred')
 await assume(members[0]);expect(await one<boolean>('select app_private.active_enrollment(auth.uid(),$1) v',[g4a])).toBe(false)
 await expect(pg.query('select public.record_release_open($1)',[release4])).rejects.toThrow()
 await assume(owner)
 const batch=await one<string>('select public.prepare_rollover($1,$2) v',[y1,y2])
 type Preview={revision:number;total:number;errors:string[];rows:{enrollmentId:string;userId:string}[];counts:Record<string,number>;status:string}
 let preview=await one<Preview>('select public.rollover_preview($1) v',[batch]);expect(preview.total).toBe(20)
 await expect(pg.query('select public.apply_rollover($1,$2)',[batch,preview.revision])).rejects.toThrow('rollover_preview_has_errors')
 expect(await one<number>('select count(*)::int v from public.enrollments where academic_year_id=$1',[y2])).toBe(0)
 for(const [i,r] of preview.rows.entries()) {
 const decision=i<14?'advance':i<16?'repeat':i===16?'change_group':i===17?'change_track':i===18?'complete':'exit'
 const target=i<14?g5:i<16?repeatGroup:i===16?g5b:i===17?changedTrack:null
 preview.revision=await one<number>('select public.save_rollover_entry($1,$2,$3,$4,$5) v',[batch,r.enrollmentId,decision,target,preview.revision]) }
 preview=await one<Preview>('select public.rollover_preview($1) v',[batch]);expect(preview.errors).toEqual([])
 expect(preview.counts).toEqual({advance:14,repeat:2,change_group:1,change_track:1,complete:1,exit:1})
 const result=await one('select public.apply_rollover($1,$2) v',[batch,preview.revision]);expect(await one('select public.apply_rollover($1,$2) v',[batch,preview.revision])).toEqual(result)
 expect(await one<number>('select count(*)::int v from public.enrollments where academic_year_id=$1',[y2])).toBe(18)
 expect(await one<number>('select count(*)::int v from public.enrollments where academic_year_id=$1 and status=\'active\'',[y1])).toBe(0)
 expect(await one<number>('select count(*)::int v from public.enrollments where academic_year_id=$1 and outcome=\'repeat\'',[y1])).toBe(2)
 // No grants or releases are created for destination groups.
 expect(await one<number>('select count(*)::int v from public.content_releases where academic_year_id=$1',[y2])).toBe(0)
 expect(await one<number>('select count(*)::int v from public.profiles')).toBe(countsBefore.profiles)
 await assume(owner,widB);expect(await one<number>('select count(*)::int v from public.workspace_memberships')).toBe(2);expect(await one<string>('select name v from public.subjects where id=$1',[sidB])).toBe('Fisica')
 await expect(pg.query('select public.rollover_preview($1)',[batch])).rejects.toThrow()
 await assume(owner)
 // Safe rollback before operational use retains cancelled destination history.
 await pg.query('select public.cancel_rollover($1)',[batch]);expect(await one<number>("select count(*)::int v from public.enrollments where academic_year_id=$1 and status='active'",[y1])).toBe(20)
 const batch2=await one<string>('select public.prepare_rollover($1,$2) v',[y1,y2]);preview=await one<Preview>('select public.rollover_preview($1) v',[batch2])
 for(const r of preview.rows) preview.revision=await one<number>('select public.save_rollover_entry($1,$2,\'advance\',$3,$4) v',[batch2,r.enrollmentId,g5,preview.revision])
 await pg.query('select public.apply_rollover($1,$2)',[batch2,preview.revision])
 await pg.query("select public.change_enrollment($1,$2,'2027-09-01')",[members[1],g5b]);await expect(pg.query('select public.cancel_rollover($1)',[batch2])).rejects.toThrow('rollover_requires_manual_correction')
 await pg.query('select public.save_subject_offering($1,$2,$3,null)',[y2,tid,sid]);await pg.query('select public.publish_content_release($1,$2,4)',[cid,g5])
 await expect(pg.query('select public.cancel_rollover($1)',[batch2])).rejects.toThrow('rollover_requires_manual_correction')
 await expect(pg.query('select public.activate_academic_year($1,false)',[y2])).rejects.toThrow('archive_previous_confirmation_required')
 await pg.query('select public.activate_academic_year($1,true)',[y2])
 const y3=await one<string>("select public.save_academic_year(null,'2028/2029','2028-09-01','2029-08-31','upcoming') v")
 const lastBatch=await one<string>('select public.prepare_rollover($1,$2) v',[y2,y3]);const lastPreview=await one<Preview>('select public.rollover_preview($1) v',[lastBatch]);expect(lastPreview.counts.complete).toBe(20)
 expect(await one<number>('select count(*)::int v from public.enrollments where academic_year_id=$1',[y3])).toBe(0)
 const state=await one<{reason:string}[]>('select public.group_release_state($1,array[$2]::uuid[]) v',[g5,cid]);expect(state[0].reason).toBe('Periodo anno non corrente')
 await assume(members[0]);expect(await one<unknown[]>('select public.catalog_page() v')).toEqual([]);await expect(pg.query("select public.submit_assignment_answer($1,'\"Nuovo\"')",[qid])).rejects.toThrow();await assume(owner)

 await expect(pg.query('select public.change_enrollment($1,$2,current_date)',[members[1],g4a])).rejects.toThrow('academic_year_archived')
 await expect(pg.query('select public.save_group_access($1,$2,true,true,true,true,true)',[cid,g4a])).rejects.toThrow('academic_year_archived')
 expect((await one<unknown[]>('select public.enrollment_history($1,null,0) v',[members[0]])).length).toBeGreaterThan(2)
 await assume(reviewer);expect(await one<number>('select count(*)::int v from public.attempts')).toBe(2)
 await expect(pg.query("update public.reviews set feedback='Modificato' where attempt_id=(select id from public.attempts limit 1)")).rejects.toThrow('academic_year_archived')
 await assume(owner);const onlyAttemptHistory=await one<{contentId:string;assignmentAttempts:number}[]>("select public.management_activity_page('account',$1,null,0) v",[members[2]]);expect(onlyAttemptHistory.some(r=>r.contentId===cid&&r.assignmentAttempts===1)).toBe(true)
 const recent=await one<{label:string}[]>('select public.resolve_recent_contexts($1) v',[[{workspaceId:widB,yearId:'',trackId:'',subjectId:sidB,groupId:''},{workspaceId:uuid(999),yearId:'',trackId:'',subjectId:'',groupId:''}]])
 expect(recent).toHaveLength(1);expect(recent[0].label).toContain('Nautico B');expect(await one<string>('select app_private.current_workspace() v')).toBe(wid)

 // Versioned backup: complete dry run and restore on a fresh recovery database.
 await assume(owner)
 const lib=await one<string>("insert into public.personal_library_items(owner_id,kind,title,document) values($1,'content','Materiale personale',$2) returning id v",[owner,doc()])
 await pg.exec('reset role');await pg.query('update public.content_items set source_library_id=$1 where id=$2',[lib,cid]);await assume(owner)
 const sourceId=await one<string>('select public.save_curriculum_source($1) v',[{workspaceId:wid,subjectId:sid,title:'Programma',text:'Segnali e Fourier',metadata:{pages:[{page_number:12,page_text:'Segnali e Fourier'}]}}])
 await pg.exec('reset role')
 const planDoc={schemaVersion:1,title:'Storico programma',context:{workspaceId:wid,academicYearId:y1,trackId:tid,subjectId:sid,level:'4'},sourceIds:[sourceId],modules:[]}
 const planId=await one<string>("insert into public.curriculum_plans(owner_id,workspace_id,academic_year_id,track_id,subject_id,title,status,document) values($1,$2,$3,$4,$5,'Storico programma','archived',$6) returning id v",[owner,wid,y1,tid,sid,planDoc])
 await pg.query('insert into public.curriculum_plan_versions(plan_id,version,document,created_by) values($1,1,$2,$3)',[planId,planDoc,owner])
 await assume(owner)
 const sections=['academic_levels','track_levels','academic_years','tracks','track_subjects','staff_subjects','subjects','subject_offerings','groups','group_memberships','enrollments','rollover_batches','rollover_entries','teaching_assignments','content_items','content_versions','content_resources','content_releases','module_access','content_access','resource_access','assignments','assignment_targets','questions','private_answer_keys','attempts','reviews','lesson_activity','practice_progress','lesson_release_activity','practice_release_progress','curriculum_sources','curriculum_plans','curriculum_plan_versions','personal_library_items','audit_log']
 const backup:Record<string,unknown>={format:'telecomlab-backup-v6',schemaVersion:6,workspaceId:wid}
 for(const table of sections)backup[table]=await one(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') v from public.${table} t`)
 await expect(pg.query('select public.restore_lifecycle_backup($1,true)',[backup])).rejects.toThrow('backup_destination_not_empty')
 const recovery=new PGlite()
 try {
 await recovery.exec("create role authenticated;create role anon;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated,anon,service_role")
 for(const name of ['202609300001_phase2.sql','202609300002_phase21_hardening.sql'])await recovery.exec(migration(name))
 for(const [i,uid]of [owner,reviewer,editor,...members].entries()){await recovery.query('insert into auth.users values($1,$2)',[uid,`u${i}@invalid`]);await recovery.query("insert into public.profiles(id,username,first_name,last_name,role,must_change_password) values($1,$2,'Nome','Cognome',$3,false)",[uid,`user${String(i).padStart(3,'0')}`,i===0?'manager':'member'])}
 for(const name of ['202610010003_phase3_workspace.sql','202610010004_phase31_context_curriculum.sql'])await recovery.exec(migration(name))
 await recovery.query("insert into public.academic_years(workspace_id,label,start_date,end_date,status) values($1,'Conflitto','2030-09-01','2031-08-31','active')",[wid])
 await expect(recovery.exec(migration('202610010005_phase32_academic_lifecycle.sql'))).rejects.toThrow('migration_multiple_active_years')
 await recovery.query("delete from public.academic_years where label='Conflitto'")
 for(const name of ['202610010005_phase32_academic_lifecycle.sql','202610010006_phase32_activity_reports.sql','202610010007_phase32_integrity_guards.sql'])await recovery.exec(migration(name))
 await recovery.exec(`select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated`);await recovery.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-workspace-id':wid})])
 await recovery.query("select public.set_staff_role($1,'reviewer',array[$2]::uuid[])",[reviewer,sid]);await recovery.query("select public.set_staff_role($1,'editor',array[$2]::uuid[])",[editor,sid])
 const validated=(await recovery.query<{v:{dryRun:boolean}}>('select public.restore_lifecycle_backup($1,true) v',[backup])).rows[0].v
 expect(validated.dryRun).toBe(true)
 expect((await recovery.query<{n:number}>('select count(*)::int n from public.content_items')).rows[0].n).toBe(0)
 expect((await recovery.query<{n:number}>('select count(*)::int n from public.academic_years')).rows[0].n).toBe(1)
 const bad=structuredClone(backup);(bad.content_items as Record<string,unknown>[])[0].unknown_field='reject'
 await expect(recovery.query('select public.restore_lifecycle_backup($1,false)',[bad])).rejects.toThrow('backup_unknown_column')
 expect((await recovery.query<{n:number}>('select count(*)::int n from public.academic_levels')).rows[0].n).toBe(0)
 await recovery.query('select public.restore_lifecycle_backup($1,false)',[backup])
 for(const table of ['content_versions','enrollments','attempts','reviews','content_releases','curriculum_sources','curriculum_plans','personal_library_items'])expect((await recovery.query<{n:number}>(`select count(*)::int n from public.${table}`)).rows[0].n).toBe((backup[table]as unknown[]).length)
 expect((await recovery.query<{n:number}>('select count(*)::int n from public.profiles')).rows[0].n).toBe(23)
 }finally{await recovery.close()}

 // Service registration is atomic even when the second account has an invalid group.
 await pg.exec('reset role');await pg.query("insert into auth.users values($1,'new1@invalid'),($2,'new2@invalid')",[uuid(600),uuid(601)])
 await pg.exec("select set_config('request.jwt.claim.sub','',false);set role service_role")
 const registrations=[{id:uuid(600),username:'newaccountone',firstName:'Nuovo',lastName:'Uno',groupId:g5},{id:uuid(601),username:'newaccounttwo',firstName:'Nuovo',lastName:'Due',groupId:uuid(999)}]
 await expect(pg.query('select public.register_created_accounts($1,$2,$3)',[owner,wid,registrations])).rejects.toThrow('invalid_group')
 await pg.exec('reset role');expect(await one<number>('select count(*)::int v from public.profiles where id=any($1::uuid[])',[[uuid(600),uuid(601)]])).toBe(0)
 await assume(owner,widB)
 const bMembership=await one<unknown>('select to_jsonb(m) v from public.workspace_memberships m where workspace_id=$1 and user_id=$2',[widB,members[0]])
 await assume(owner);await pg.query('select public.leave_workspace_account($1)',[members[0]]);await assume(owner,widB)
 expect(await one<unknown>('select to_jsonb(m) v from public.workspace_memberships m where workspace_id=$1 and user_id=$2',[widB,members[0]])).toEqual(bMembership)
 await assume(owner);expect(await one<boolean>('select disabled v from public.profiles where id=$1',[members[0]])).toBe(false)
 await pg.query("select public.set_staff_role($1,'member','{}')",[reviewer]);await assume(reviewer)
 expect(await one<number>('select count(*)::int v from public.attempts')).toBe(0)
 await pg.exec('reset role;set role anon');await expect(pg.query('select public.catalog_page()')).rejects.toThrow()
 await pg.exec('reset role');expect(await one<number>("select count(*)::int v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef")).toBe(0)
 expect(await one<number>("select count(*)::int v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.prosecdef and not ('search_path=\"\"'=any(p.proconfig))")).toBe(0)
 } finally { await pg.close() }
},120000)
