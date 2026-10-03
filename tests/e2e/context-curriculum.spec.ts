import { expect, test } from "@playwright/test";
import { mockWorkspace } from "./product-fixture";
import { emptyPlan } from "../../src/domain/curriculum";

test("switches institutions and role without logout, remembers contexts and denies foreign links", async ({
  page,
}) => {
  const f = await mockWorkspace(page, "owner", true);
  await page.goto("/#/");
  await expect(page.locator(".subject-card")).toHaveCount(2);
  await page.getByLabel("Materia attiva").selectOption(f.subjects[0].id);
  await page
    .getByLabel("Gruppo attivo")
    .selectOption({ label: "Gruppo laboratorio" });
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Istituto Nautico reviewer", exact: true })
    .click();
  await expect(page.locator(".context-trigger")).toHaveText(/Istituto Nautico/);
  await expect(page.locator(".topbar-role")).toHaveText("Reviewer");
  await expect(
    page.locator(".side-link", { hasText: "Prompt Builder" }),
  ).toHaveCount(0);
  await expect(page.locator(".subject-card")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".context-trigger")).toHaveText(/Istituto Nautico/);
  await page.getByRole("button", { name: /Istituto Nautico/ }).click();
  await page.screenshot({path:"test-results/p31-context-desktop.png"});
  await page.setViewportSize({width:375,height:900});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
  await page.screenshot({path:"test-results/p31-context-mobile.png"});
  await page.setViewportSize({width:1280,height:900});
  await page
    .getByRole("button", { name: "Telecom/lab owner", exact: true })
    .click();
  await page.goto("/#/search");
  await page.getByRole("textbox", { name: "Cerca contenuti" }).focus();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/#/planning?workspace=99999999-0000-4000-8000-000000000001");
  await expect(page.getByRole("alert")).toContainText("non autorizzato");
  await page.evaluate(
    ({ uid }) =>
      localStorage.setItem(
        `telecom:contexts:${uid}`,
        JSON.stringify({
          last: { workspaceId: "revoked" },
          recent: [{ workspaceId: "revoked" }],
        }),
      ),
    f,
  );
  await page.goto("/#/");
  await page.reload();
  await expect(page.locator(".context-trigger")).toHaveText(/Telecom\/lab/);
});

test("curriculum source, proposed import, timeline, versioning, approval, duplication and publishing contract", async ({
  page,
}) => {
  const f = await mockWorkspace(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#/planning");
  await expect(
    page.getByRole("heading", { name: "Pianificazione", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fonti", exact: true }).click();
  await page.getByLabel("Titolo", { exact: true }).fill("Fonte tecnica");
  await page.getByLabel("Ente", { exact: true }).fill("Ente di riferimento");
  await page
    .getByLabel("Testo della fonte")
    .fill("Analizzare segnali periodici e relazioni fra frequenza e periodo.");
  await page.getByRole("button", { name: "Salva fonte", exact: true }).click();
  await expect(page.locator(".source-card h3")).toHaveText("Fonte tecnica");
  const source = f.tables.curriculum_sources[0] as { id: string };
  await page.getByRole("button", { name: "Piano", exact: true }).click();
  const plan = emptyPlan({
    workspaceId: f.wid,
    academicYearId: f.yid,
    trackId: f.tid,
    subjectId: f.subjects[0].id,
    level: "3",
  });
  plan.title = "Piano segnali";
  plan.status = "approved";
  plan.sourceIds = [source.id];
  plan.modules = [
    {
      id: "m1",
      title: "Fondamenti",
      rationale: "Sequenza proposta",
      origins: [
        {
          sourceId: source.id,
          excerpt: "Analizzare segnali periodici",
          interpretation: "Prima parte del percorso",
        },
      ],
      prerequisites: [],
      objectives: ["Leggere un segnale"],
      topics: [
        {
          id: "t1",
          title: "Periodicità",
          progress: "not_started",
          actualMaterial: "",
          notes: "",
        },
      ],
      durationHours: 8,
      activities: ["Misure"],
      plots: [],
      simulators: ["signal-sine"],
      notes: "",
      startMonth: 9,
      endMonth: 10,
      excluded: false,
    },
    {
      id: "m2",
      title: "Applicazioni",
      rationale: "Proposta",
      origins: [],
      prerequisites: [],
      objectives: [],
      topics: [],
      durationHours: 6,
      activities: [],
      plots: [],
      simulators: [],
      notes: "",
      startMonth: 11,
      endMonth: 11,
      excluded: false,
    },
  ];
  await page.getByLabel("CurriculumPlan JSON").fill(JSON.stringify(plan));
  await page.getByRole("button", { name: "Valida e anteprima" }).click();
  await expect(page.locator(".timeline-module")).toHaveCount(2);
  await page.getByRole("button", { name: "Sposta su Applicazioni" }).click();
  await expect(page.getByLabel("Titolo modulo").first()).toHaveValue(
    "Applicazioni",
  );
  await page.getByRole("button", { name: "Salva piano", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("salvato");
  expect((f.tables.curriculum_plans[0] as { status: string }).status).toBe(
    "proposed",
  );
  await page
    .getByRole("button", { name: "Approva piano", exact: true })
    .click();
  await expect
    .poll(() => (f.tables.curriculum_plans[0] as { status: string }).status)
    .toBe("approved");
  await page.getByText("Cronologia versioni", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Ripristina questa versione" }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Ripristina questa versione" })
    .last()
    .click();
  await expect
    .poll(() => (f.tables.curriculum_plans[0] as { version: number }).version)
    .toBe(3);
  await page
    .getByLabel("Duplica per anno scolastico")
    .selectOption({ label: "2027/2028" });
  await page
    .getByRole("button", { name: "Duplica piano", exact: true })
    .click();
  await expect.poll(() => f.tables.curriculum_plans.length).toBe(2);
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 2,
          ),
        { message: `Planner overflow ${width}` },
      )
      .toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo({top:0,behavior:"instant"})});
  await page.screenshot({
    path: "test-results/p31-planner-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Prepara argomento", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Metaprompt preparazione")).toContainText(
    "NON PUBBLICABILE",
  );
  await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo({top:0,behavior:"instant"})});
  await page.screenshot({
    path: "test-results/p31-preparation.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Piano", exact: true }).click();
  await page
    .getByRole("button", { name: "Crea contenuto", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Genera istruzioni", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Materiale trattato")).toHaveValue("");
  await expect(page.getByLabel("Argomento", { exact: true })).toHaveValue(
    "Periodicità",
  );
  await expect(page.locator(".planned-contract")).toContainText(
    "Analizzare segnali periodici",
  );
  await expect(
    page.getByRole("button", { name: "Copia istruzioni" }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("personal library keeps snapshots private in its workflow and offers contextual copy", async ({
  page,
}) => {
  const f = await mockWorkspace(page);
  await page.goto("/#/personal");
  await page
    .getByRole("combobox", { name: "Contenuto", exact: true })
    .selectOption(f.contents[0].id);
  await page
    .getByRole("button", { name: "Salva nella libreria personale" })
    .click();
  await expect(page.locator(".library-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Apri", exact: true }).click();
  await expect(page.getByLabel("Documento JSON")).toContainText(
    f.contents[0].title,
  );
  await expect(
    page.getByRole("button", { name: "Crea copia contestuale" }),
  ).toBeEnabled();
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
      )
      .toBe(true);
  }
  await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo({top:0,behavior:"instant"})});
  await page.screenshot({
    path: "test-results/p31-personal-library.png",
    fullPage: true,
  });
});
