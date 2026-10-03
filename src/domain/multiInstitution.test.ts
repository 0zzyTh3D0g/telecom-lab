import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { emptyPlan, duplicatePlan } from "./curriculum";

it("enforces tenant roles, private ownership, transactional plans, forks and historical cohorts in PostgreSQL", async () => {
  const pg = new PGlite(),
    ids = Array.from(
      { length: 9 },
      (_, i) => `31000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    );
  const [owner, member, outsider, editor, reviewer] = ids,
    wid = "10000000-0000-4000-8000-000000000001",
    sid = "20000000-0000-4000-8000-000000000001";
  const assume = async (uid: string, workspaceId: string) => {
    await pg.exec(
      `reset role; select set_config('request.jwt.claim.sub','${uid}',false);set role authenticated;`,
    );
    await pg.query("select set_config('request.headers',$1,false)", [
      JSON.stringify({ "x-workspace-id": workspaceId }),
    ]);
  };
  const one = async <T>(sql: string, args: unknown[] = []) =>
    (await pg.query<{ v: T }>(sql, args)).rows[0].v;
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
    for (let i = 0; i < 5; i++) {
      await pg.query("insert into auth.users values($1,$2)", [
        ids[i],
        `user${i}@invalid`,
      ]);
      await pg.query(
        "insert into public.profiles(id,username,first_name,last_name,role,must_change_password) values($1,$2,'Nome','Cognome',$3,false)",
        [ids[i], `user${i}`, i === 0 ? "manager" : "member"],
      );
    }
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
    expect(
      (
        await pg.query(
          "select column_name from information_schema.columns where table_name='profiles' and column_name in ('role','workspace_id')",
        )
      ).rows,
    ).toHaveLength(0);
    await assume(owner, wid);
    const year = await one<string>("select id v from public.academic_years"),
      track = await one<string>("select id v from public.tracks");
    await pg.query(
      "select public.set_staff_role($1,'editor',array[$2]::uuid[])",
      [editor, sid],
    );
    await pg.query(
      "select public.set_staff_role($1,'reviewer',array[$2]::uuid[])",
      [reviewer, sid],
    );
    const widB = await one<string>(
      "select public.create_workspace('Istituto B') v",
    );
    await assume(owner, widB);
    const sidB = await one<string>(
      "select public.save_subject(null,'fisica','Fisica','','blue') v",
    );
    await one<string>(
      "select public.save_academic_year(null,'2026/2027','2026-09-01','2027-08-31','active') v",
    );
    await pg.query(
      "select public.save_track('Percorso B','',array[$1]::uuid[])",
      [sidB],
    );
    await pg.query("select public.attach_workspace_account('user1')");
    await pg.query("select public.attach_workspace_account('user3')");
    await pg.query(
      "select public.set_staff_role($1,'reviewer',array[$2]::uuid[])",
      [editor, sidB],
    );
    const gidB = await one<string>(
      "insert into public.groups(workspace_id,name,level) values($1,'3B',3) returning id v",
      [widB],
    );
    const doc = (subject: string) => ({
      schemaVersion: 2,
      id: "same-id",
      slug: "same-slug",
      subject,
      title: "Lezione",
      summary: "Test",
      year: 3,
      module: "Base",
      topic: "Test",
      tags: [],
      order: 0,
      blocks: [{ type: "paragraph", text: "Materiale" }],
      assignments: [],
    });
    const cB = await one<{ contentId: string }>(
      "select public.save_content_document($1::jsonb) v",
      [JSON.stringify(doc("fisica"))],
    );
    await pg.query("select public.set_member_group($1,$2)", [member, gidB]);
    await pg.query(
      "update public.content_items set status='published' where id=$1",
      [cB.contentId],
    );
    await pg.query(
      "select public.save_group_access($1,$2,true,true,true,true,true)",
      [cB.contentId, gidB],
    );
    await assume(owner, wid);
    const cA = await one<{ contentId: string }>(
      "select public.save_content_document($1::jsonb) v",
      [JSON.stringify(doc("telecomunicazioni"))],
    );
    expect(cA.contentId).not.toBe(cB.contentId);
    const gidA = await one<string>(
      "insert into public.groups(workspace_id,name,level) values($1,'3A',3) returning id v",
      [wid],
    );
    await pg.query("select public.set_member_group($1,$2)", [member, gidA]);
    await pg.query(
      "update public.content_items set status='published' where id=$1",
      [cA.contentId],
    );
    await pg.query(
      "select public.save_group_access($1,$2,true,true,true,true,true)",
      [cA.contentId, gidA],
    );
    const createAssignment=async(contentId:string,groupId:string)=>{
      const draft={title:'Compito di contesto',questions:[{id:'open',type:'shortOpen',prompt:'Descrivi il modello',difficulty:'base',points:1,hints:[]}],privateKeys:{open:{answer:null,solution:'Privata',rubric:'Motivazione coerente'}}};
      const aid=await one<string>('select public.create_assignment_bundle($1::jsonb) v',[JSON.stringify({draft,groupId,contentId,maxAttempts:2,solutionRelease:'manual'})]);
      await pg.query("update public.assignments set status='published' where id=$1",[aid]);
      return one<string>('select id v from public.questions where assignment_id=$1',[aid]);
    };
    const qA=await createAssignment(cA.contentId,gidA);
    await assume(owner,widB);const qB=await createAssignment(cB.contentId,gidB);
    await assume(member, wid);
    const aA=await one<{attemptId:string}>('select public.submit_assignment_answer($1,$2::jsonb,0) v',[qA,JSON.stringify('Risposta A')]);
    expect(
      (await pg.query("select id from public.content_items")).rows,
    ).toEqual([{ id: cA.contentId }]);
    await pg.query("select public.record_lesson_open($1)", [cA.contentId]);
    await expect(
      pg.query("select public.record_lesson_open($1)", [cB.contentId]),
    ).rejects.toThrow();
    expect(
      (await pg.query("select * from public.curriculum_plans")).rows,
    ).toHaveLength(0);
    await assume(member, widB);
    const aB=await one<{attemptId:string}>('select public.submit_assignment_answer($1,$2::jsonb,0) v',[qB,JSON.stringify('Risposta B')]);
    expect((await pg.query('select id from public.attempts')).rows).toEqual([{id:aB.attemptId}]);
    expect((await pg.query('select attempt_id from public.reviews')).rows).toEqual([{attempt_id:aB.attemptId}]);
    await expect(pg.query('select public.submit_assignment_answer($1,$2::jsonb,0)',[qA,JSON.stringify('Intrusione')])).rejects.toThrow();
    expect((await pg.query('select * from public.private_answer_keys')).rows).toHaveLength(0);
    await expect(pg.query('insert into public.attempts(question_id,user_id,attempt_number,answer) values($1,$2,1,\'"falso"\')',[qB,member])).rejects.toThrow();
    await expect(pg.query('insert into public.lesson_activity(user_id,content_id) values($1,$2)',[member,cA.contentId])).rejects.toThrow();
    expect((await pg.query("update public.content_items set status='draft' where id=$1 returning id",[cB.contentId])).rows).toHaveLength(0);
    expect((await pg.query("update public.reviews set feedback='falso' where attempt_id=$1 returning attempt_id",[aB.attemptId])).rows).toHaveLength(0);
    await assume(member,wid);expect((await pg.query('select id from public.attempts')).rows).toEqual([{id:aA.attemptId}]);
    await assume(member,widB);
    await pg.query("select public.record_lesson_open($1)", [cB.contentId]);
    expect(
      (await pg.query("select content_id from public.lesson_activity")).rows,
    ).toEqual([{ content_id: cB.contentId }]);
    expect(
      (await pg.query("select group_id from public.group_memberships")).rows,
    ).toEqual([{ group_id: gidB }]);
    await assume(outsider, widB);
    for (const table of [
      "subjects",
      "groups",
      "curriculum_sources",
      "curriculum_plans",
      "lesson_activity",
      "attempts",
      "reviews",
      "content_items",
    ])
      expect(
        (await pg.query(`select * from public.${table}`)).rows,
      ).toHaveLength(0);
    await expect(
      pg.query("select public.management_group_activity($1)", [gidB]),
    ).rejects.toThrow();
    await assume(owner, wid);
    const personal = await one<string>(
      "insert into public.personal_library_items(owner_id,kind,title,document) values($1,'content','Privata',$2::jsonb) returning id v",
      [owner, JSON.stringify(doc("telecomunicazioni"))],
    );
    await assume(outsider, wid);
    expect(
      (await pg.query("select * from public.personal_library_items")).rows,
    ).toHaveLength(0);
    await expect(
      pg.query(
        "insert into public.personal_library_items(owner_id,kind,title,document) values($1,'content','Falso','{}')",
        [owner],
      ),
    ).rejects.toThrow();
    await assume(owner, wid);
    const forkA = await one<{ contentId: string }>(
      "select public.fork_personal_content($1,$2,'fork-a') v",
      [personal, sid],
    );
    await assume(owner, widB);
    const forkB = await one<{ contentId: string }>(
      "select public.fork_personal_content($1,$2,'fork-b') v",
      [personal, sidB],
    );
    await pg.query(
      "update public.personal_library_items set document=$1::jsonb where id=$2",
      [
        JSON.stringify({ ...doc("telecomunicazioni"), title: "Cambiata" }),
        personal,
      ],
    );
    expect(
      await one<string>(
        "select title v from public.content_items where id=$1",
        [forkB.contentId],
      ),
    ).toBe("Lezione");
    await assume(owner, wid);
    expect(
      await one<string>(
        "select title v from public.content_items where id=$1",
        [forkA.contentId],
      ),
    ).toBe("Lezione");
    const sourceId = await one<string>(
      "select public.save_curriculum_source($1::jsonb) v",
      [
        JSON.stringify({
          workspaceId: wid,
          subjectId: sid,
          title: "Fonte",
          issuer: "Ente",
          sourceType: "official",
          text: "Fonte reale",
        }),
      ],
    );
    const plan = emptyPlan({
      workspaceId: wid,
      academicYearId: year,
      trackId: track,
      subjectId: sid,
      level: "3",
    });
    plan.sourceIds = [sourceId];
    plan.status = "approved";
    plan.modules = [
      {
        id: "m",
        title: "Modulo",
        rationale: "Proposta",
        origins: [
          {
            sourceId,
            excerpt: "Fonte reale",
            interpretation: "Normalizzazione",
          },
        ],
        prerequisites: [],
        objectives: [],
        topics: [
          {
            id: "t",
            title: "Tema",
            progress: "not_started",
            actualMaterial: "",
            notes: "",
          },
        ],
        durationHours: 8,
        activities: [],
        plots: [],
        simulators: [],
        notes: "",
        startMonth: 9,
        endMonth: 10,
        excluded: false,
      },
    ];
    const pid = await one<string>(
      "select public.save_curriculum_plan($1::jsonb,null,0,'import') v",
      [JSON.stringify(plan)],
    );
    expect(
      await one<string>(
        "select status v from public.curriculum_plans where id=$1",
        [pid],
      ),
    ).toBe("proposed");
    await pg.query(
      "select public.save_curriculum_plan($1::jsonb,$2,1,'approve')",
      [JSON.stringify(plan), pid],
    );
    expect(
      await one<string>(
        "select status v from public.curriculum_plans where id=$1",
        [pid],
      ),
    ).toBe("approved");
    await expect(
      pg.query("select public.save_curriculum_plan($1::jsonb,$2,1,'save')", [
        JSON.stringify(plan),
        pid,
      ]),
    ).rejects.toThrow(/version_conflict/);
    await pg.query("select public.restore_curriculum_plan($1,1,2)", [pid]);
    expect(
      await one<number>(
        "select version v from public.curriculum_plans where id=$1",
        [pid],
      ),
    ).toBe(3);
    expect(
      (
        await pg.query(
          "select * from public.curriculum_plan_versions where plan_id=$1",
          [pid],
        )
      ).rows,
    ).toHaveLength(3);
    await expect(
      pg.query("select public.delete_curriculum_source($1)", [sourceId]),
    ).rejects.toThrow(/source_used/);
    await assume(editor, wid);
    await pg.query(
      "select public.save_curriculum_plan($1::jsonb,$2,3,'save')",
      [JSON.stringify(plan), pid],
    );
    await expect(
      pg.query("select public.save_curriculum_plan($1::jsonb,$2,4,'approve')", [
        JSON.stringify(plan),
        pid,
      ]),
    ).rejects.toThrow(/approval/);
    await assume(editor, widB);
    await expect(
      pg.query("select public.save_curriculum_plan($1::jsonb)", [
        JSON.stringify(plan),
      ]),
    ).rejects.toThrow();
    await expect(
      pg.query("select public.save_content_document($1::jsonb)", [
        JSON.stringify({
          ...doc("fisica"),
          id: "forbidden",
          slug: "forbidden",
        }),
      ]),
    ).rejects.toThrow();
    expect(
      (await pg.query("select * from public.curriculum_plans")).rows,
    ).toHaveLength(0);
    await assume(reviewer, wid);
    expect(
      (await pg.query("select * from public.curriculum_plans")).rows,
    ).toHaveLength(1);
    await expect(
      pg.query("select public.save_curriculum_plan($1::jsonb,$2,4)", [
        JSON.stringify(plan),
        pid,
      ]),
    ).rejects.toThrow();
    await assume(owner, wid);
    const newYear = await one<string>(
      "select public.save_academic_year(null,'2027/2028','2027-09-01','2028-08-31','upcoming') v",
    );
    const copy = duplicatePlan(plan, newYear);
    await pg.query("select public.save_curriculum_plan($1::jsonb)", [
      JSON.stringify(copy),
    ]);
    await pg.query(
      "select public.save_academic_year($1,'2026/2027','2026-09-01','2027-08-31','archived')",
      [year],
    );
    await expect(
      pg.query("select public.save_curriculum_plan($1::jsonb,$2,4)", [
        JSON.stringify(plan),
        pid,
      ]),
    ).rejects.toThrow(/context_unavailable/);
    expect(
      (await pg.query("select * from public.curriculum_plans")).rows,
    ).toHaveLength(2);
    const analytics = await one<{ contentId: string }[]>(
      "select public.management_account_activity($1) v",
      [member],
    );
    expect(analytics.some((a) => a.contentId === cA.contentId)).toBe(true);
    expect(analytics.some((a) => a.contentId === cB.contentId)).toBe(false);
    await pg.query("select public.delete_member_activity($1)", [member]);
    await assume(member, widB);
    expect(
      (await pg.query("select * from public.lesson_activity")).rows,
    ).toHaveLength(1);
    expect((await pg.query('select id from public.attempts')).rows).toEqual([{id:aB.attemptId}]);
    await assume(member, wid);
    expect(
      (await pg.query("select * from public.content_items")).rows,
    ).toHaveLength(0);
    await assume(owner, widB);
    await pg.exec("reset role");
    await pg.query(
      "update public.workspace_memberships set disabled=true where user_id=$1 and workspace_id=$2",
      [member, widB],
    );
    await assume(member, widB);
    expect((await pg.query("select * from public.groups")).rows).toHaveLength(
      0,
    );
    await assume(owner, wid);
    await expect(
      pg.query("select public.set_staff_role($1,'member')", [owner]),
    ).rejects.toThrow(/last_owner/);
    await pg.exec('reset role');await pg.query('update public.workspaces set archived_at=now() where id=$1',[widB]);
    await assume(owner,widB);expect((await pg.query('select * from public.subjects')).rows).toHaveLength(0);
    await expect(pg.query('select public.management_account_activity($1)',[member])).rejects.toThrow();
    await pg.exec('reset role');await pg.query('update public.profiles set must_change_password=true where id=$1',[owner]);
    await assume(owner,wid);expect((await pg.query('select * from public.curriculum_plans')).rows).toHaveLength(0);
    await expect(pg.query('select public.restore_curriculum_plan($1,1,4)',[pid])).rejects.toThrow();
    await pg.exec("reset role");
    expect(
      (
        await pg.query(
          "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef",
        )
      ).rows,
    ).toHaveLength(0);
    await pg.exec("set role anon");
    await expect(pg.query("select public.my_workspaces()")).rejects.toThrow();
  } finally {
    await pg.close();
  }
}, 30000);
