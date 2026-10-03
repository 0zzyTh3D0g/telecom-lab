import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import {emptyPlan} from './curriculum';

it("migrates existing identity into memberships and denies an untrusted context", async () => {
  const pg = new PGlite();
  const uid = "30000000-0000-4000-8000-000000000001",
    wid = "10000000-0000-4000-8000-000000000001";
  try {
    await pg.exec(
      "create role authenticated; create role anon; create role service_role; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
    );
    for (const name of [
      "202609300001_phase2.sql",
      "202609300002_phase21_hardening.sql",
    ])
      await pg.exec(
        readFileSync(
          new URL(`../../supabase/migrations/${name}`, import.meta.url),
          "utf8",
        ).replace("create extension if not exists pgcrypto;", ""),
      );
    await pg.query("insert into auth.users values($1,'owner@invalid')", [uid]);
    await pg.query(
      "insert into public.profiles(id,username,first_name,last_name,role,must_change_password) values($1,'owner','Owner','Test','manager',false)",
      [uid],
    );
    for (const name of [
      "202610010003_phase3_workspace.sql",
      "202610010004_phase31_context_curriculum.sql",
    ])
      await pg.exec(
        readFileSync(
          new URL(`../../supabase/migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
    await pg.exec(
      `select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated`,
    );
    expect((await pg.query("select * from public.subjects")).rows).toHaveLength(
      0,
    );
    await pg.query("select set_config('request.headers',$1,false)", [
      JSON.stringify({ "x-workspace-id": wid }),
    ]);
    expect((await pg.query("select * from public.subjects")).rows).toHaveLength(
      1,
    );
    expect(
      (
        await pg.query<{ v: { role: string }[] }>(
          "select public.my_workspaces() v",
        )
      ).rows[0].v[0].role,
    ).toBe("owner");
    const newWid = (
      await pg.query<{ id: string }>(
        "select public.create_workspace('Istituto B') id",
      )
    ).rows[0].id;
    await pg.query("select set_config('request.headers',$1,false)", [
      JSON.stringify({ "x-workspace-id": newWid }),
    ]);
    const sid = (
      await pg.query<{ id: string }>(
        "select public.save_subject(null,'fisica','Fisica','','blue') id",
      )
    ).rows[0].id;
    expect((await pg.query("select name from public.subjects")).rows).toEqual([
      { name: "Fisica" },
    ]);
    await pg.query(
      "select public.save_academic_year(null,'2027/2028','2027-09-01','2028-08-31','active')",
    );
    await pg.query(
      "select public.save_track('Indirizzo B','',array[$1]::uuid[])",
      [sid],
    );
    const trackId=(await pg.query<{id:string}>('select id from public.tracks')).rows[0].id;
    await pg.query("select public.update_track($1,'Indirizzo aggiornato','Descrizione',array[$2]::uuid[])",[trackId,sid]);
    expect((await pg.query<{name:string}>('select name from public.tracks')).rows[0].name).toBe('Indirizzo aggiornato');
    await pg.query(
      "insert into public.groups(workspace_id,name,level) values($1,'3A',3)",
      [newWid],
    );
    await pg.query("select set_config('request.headers',$1,false)", [
      JSON.stringify({
        "x-workspace-id": "99999999-0000-4000-8000-000000000001",
      }),
    ]);
    expect((await pg.query("select * from public.groups")).rows).toHaveLength(
      0,
    );
    await expect(
      pg.query("select public.save_subject(null,'leak','Leak','','blue')"),
    ).rejects.toThrow(/access_denied/);
    const sourceId=(await pg.query<{v:string}>('select public.save_curriculum_source($1::jsonb) v',[JSON.stringify({workspaceId:null,subjectId:null,title:'Fonte personale',text:'Fonte privata'})])).rows[0].v;
    const personal=emptyPlan({workspaceId:null,academicYearId:null,trackId:null,subjectId:null,level:'3'});personal.sourceIds=[sourceId];
    const planId=(await pg.query<{v:string}>('select public.save_curriculum_plan($1::jsonb,null,0,\'import\') v',[JSON.stringify(personal)])).rows[0].v;
    expect((await pg.query('select id from public.curriculum_plans')).rows).toEqual([{id:planId}]);
    await pg.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-workspace-id':newWid})]);
    const yearRows=(await pg.query<{id:string}>('select * from public.academic_years')).rows,trackRows=(await pg.query<{id:string}>('select * from public.tracks')).rows;
    const backup={format:'telecomlab-backup-v5',schemaVersion:5,academic_years:yearRows,tracks:trackRows,subjects:[],groups:[{id:'33000000-0000-4000-8000-000000000001',name:'Rollback test',level:3,academic_year_id:yearRows[0].id,track_id:trackRows[0].id}],content_items:[],content_versions:[],content_resources:[{content_id:'33000000-0000-4000-8000-000000000002',kind:'theory',blocks:[],search_text:''}],module_access:[],content_access:[],resource_access:[]};
    await expect(pg.query('select public.restore_configuration_backup($1::jsonb)',[JSON.stringify(backup)])).rejects.toThrow();
    expect((await pg.query("select id from public.groups where name='Rollback test'")).rows).toHaveLength(0);
    await pg.exec('reset role');const other='32000000-0000-4000-8000-000000000001';await pg.query("insert into auth.users values($1,'other@invalid')",[other]);await pg.query("insert into public.profiles(id,username,first_name,last_name,must_change_password) values($1,'other','Other','Test',false)",[other]);await pg.exec(`select set_config('request.jwt.claim.sub','${other}',false);set role authenticated;`);
    expect((await pg.query('select * from public.curriculum_sources')).rows).toHaveLength(0);
    expect((await pg.query('select * from public.curriculum_plans')).rows).toHaveLength(0);
    expect((await pg.query('select * from public.curriculum_plan_versions')).rows).toHaveLength(0);
    await expect(pg.query('select public.save_curriculum_plan($1::jsonb)',[JSON.stringify(personal)])).rejects.toThrow(/source_access_denied/);
  } finally {
    await pg.close();
  }
}, 30000);
