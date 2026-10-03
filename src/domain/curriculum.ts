import { z } from "zod";
import { isSimulationId } from "../features/simulations/registry";

const text = z.string().max(10000),
  short = z.string().trim().min(1).max(200),
  id = z.string().min(1).max(100);
export const progressLabels = {
  not_started: "Non iniziato",
  in_progress: "In corso",
  treated: "Trattato",
  skipped: "Saltato",
  deferred: "Rinviato",
} as const;
export const curriculumSourceSchema = z.object({
  title: short,
  issuer: text.default(""),
  discipline: text.default(""),
  track: text.default(""),
  articulation: text.default(""),
  level: text.default(""),
  documentYear: text.default(""),
  documentVersion: text.default(""),
  documentDate: z.union([z.iso.date(), z.literal("")]).default(""),
  url: z
    .union([z.url().refine((v) => /^https?:\/\//.test(v)), z.literal("")])
    .default(""),
  sourceType: z.enum(["official", "manual"]).default("manual"),
  text: z.string().max(200000).default(""),
  notes: text.default(""),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CurriculumSource = z.infer<typeof curriculumSourceSchema> & {
  id: string;
  workspace_id: string | null;
  subject_id: string | null;
  owner_id: string;
};
const topicSchema = z.object({
  id,
  title: short,
  progress: z
    .enum(["not_started", "in_progress", "treated", "skipped", "deferred"])
    .default("not_started"),
  actualMaterial: text.default(""),
  notes: text.default(""),
});
export const moduleSchema = z.object({
  id,
  title: short,
  rationale: text.default(""),
  origins: z
    .array(
      z.object({
        sourceId: z.uuid(),
        excerpt: text,
        interpretation: text.default(""),
      }),
    )
    .max(100)
    .default([]),
  prerequisites: z.array(text).max(100).default([]),
  objectives: z.array(text).max(100).default([]),
  topics: z.array(topicSchema).max(200),
  durationHours: z.number().finite().min(0).max(2000),
  activities: z.array(text).max(100).default([]),
  plots: z.array(text).max(100).default([]),
  simulators: z.array(text).max(100).default([]),
  notes: text.default(""),
  startMonth: z.number().int().min(1).max(12),
  endMonth: z.number().int().min(1).max(12),
  excluded: z.boolean().default(false),
});
export const curriculumPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: short,
    context: z.object({
      workspaceId: z.uuid().nullable(),
      academicYearId: z.uuid().nullable(),
      trackId: z.uuid().nullable(),
      subjectId: z.uuid().nullable(),
      level: z.string().max(100),
    }),
    hours: z.object({
      weekly: z.number().finite().min(0).max(60),
      weeks: z.number().int().min(1).max(60),
      assessmentPercent: z.number().finite().min(0).max(100),
      assessmentHours: z.number().finite().min(0).max(2000),
      recoveryHours: z.number().finite().min(0).max(2000),
      activityHours: z.number().finite().min(0).max(2000),
      excludedPeriods: z
        .array(
          z.object({
            start: z.iso.date(),
            end: z.iso.date(),
            note: text.default(""),
          }),
        )
        .max(100)
        .default([]),
    }),
    sourceIds: z.array(z.uuid()).max(100),
    modules: z.array(moduleSchema).max(100),
    notes: text.default(""),
    status: z.enum(["draft", "proposed", "approved", "archived"]),
    version: z.number().int().min(1),
    generationWarnings: z.array(text).max(100).default([]),
  })
  .superRefine((plan, ctx) => {
    const ids = new Set<string>();
    for (const module of plan.modules) {
      for (const item of [module, ...module.topics]) {
        if (ids.has(item.id))
          ctx.addIssue({ code: "custom", message: `ID duplicato: ${item.id}` });
        ids.add(item.id);
      }
      for (const origin of module.origins)
        if (!plan.sourceIds.includes(origin.sourceId))
          ctx.addIssue({
            code: "custom",
            message: `Fonte non referenziata: ${origin.sourceId}`,
          });
    }
    for (const period of plan.hours.excludedPeriods)
      if (period.end < period.start)
        ctx.addIssue({ code: "custom", message: "Periodo escluso invertito" });
    const values = [
      plan.context.academicYearId,
      plan.context.trackId,
      plan.context.subjectId,
    ];
    if (
      plan.context.workspaceId ? values.some((v) => !v) : values.some(Boolean)
    )
      ctx.addIssue({
        code: "custom",
        message: "Contesto incompleto o incompatibile con lo spazio personale",
      });
  });
export type CurriculumPlan = z.infer<typeof curriculumPlanSchema>;
export type PlanRow = {
  id: string;
  title: string;
  document: CurriculumPlan;
  version: number;
  status: CurriculumPlan["status"];
  academic_year_id: string | null;
  subject_id: string | null;
};
export function estimateHours(
  plan: CurriculumPlan,
  range?: { start: string; end: string },
) {
  const h = plan.hours,
    nominal = h.weekly * h.weeks;
  const days = new Set<number>();
  for (const p of h.excludedPeriods) {
    const start = Math.max(
        Date.parse(p.start),
        range ? Date.parse(range.start) : -Infinity,
      ),
      end = Math.min(
        Date.parse(p.end),
        range ? Date.parse(range.end) : Infinity,
      );
    for (let day = start; day <= end; day += 86400000) days.add(day);
  }
  const excluded = Math.min(nominal, (days.size / 7) * h.weekly),
    assessment =
      h.assessmentHours > 0
        ? h.assessmentHours
        : (nominal * h.assessmentPercent) / 100;
  const plannable = Math.max(
      0,
      nominal - excluded - assessment - h.recoveryHours - h.activityHours,
    ),
    planned = plan.modules
      .filter((m) => !m.excluded)
      .reduce((n, m) => n + m.durationHours, 0);
  return {
    nominal,
    excluded,
    assessment,
    plannable,
    planned,
    remaining: plannable - planned,
  };
}
export function planWarnings(
  plan: CurriculumPlan,
  sources: CurriculumSource[],
) {
  const warnings = [...plan.generationWarnings];
  if (!plan.sourceIds.length)
    warnings.push("Nessuna fonte: piano basato solo su indicazioni manuali.");
  for (const sid of plan.sourceIds)
    if (!sources.some((s) => s.id === sid))
      warnings.push("Una fonte non è disponibile nel contesto corrente.");
  for (const m of plan.modules) {
    if (!m.origins.length)
      warnings.push(`${m.title}: origine nella fonte non indicata.`);
    for (const origin of m.origins) {
      const s = sources.find((s) => s.id === origin.sourceId);
      if (s && origin.excerpt && !s.text.includes(origin.excerpt))
        warnings.push(
          `${m.title}: l’estratto non coincide con il testo fornito; verificare.`,
        );
    }
    for (const simulator of m.simulators)
      if (!isSimulationId(simulator))
        warnings.push(`${m.title}: simulatore non disponibile (${simulator}).`);
  }
  if (estimateHours(plan).remaining < 0)
    warnings.push("Le ore proposte superano la stima pianificabile.");
  return warnings;
}
export function duplicatePlan(
  plan: CurriculumPlan,
  academicYearId: string | null,
): CurriculumPlan {
  return {
    ...structuredClone(plan),
    context: { ...plan.context, academicYearId },
    title: `${plan.title} · copia`,
    status: "draft",
    version: 1,
    modules: plan.modules.map((m) => ({
      ...structuredClone(m),
      topics: m.topics.map((t) => ({
        ...t,
        progress: "not_started",
        actualMaterial: "",
      })),
    })),
  };
}
export function emptyPlan(context: CurriculumPlan["context"]): CurriculumPlan {
  return {
    schemaVersion: 1,
    title: "Nuovo piano proposto",
    context,
    hours: {
      weekly: 3,
      weeks: 33,
      assessmentPercent: 15,
      assessmentHours: 0,
      recoveryHours: 6,
      activityHours: 3,
      excludedPeriods: [],
    },
    sourceIds: [],
    modules: [],
    notes: "",
    status: "draft",
    version: 1,
    generationWarnings: [],
  };
}
export const curriculumJsonContract = {
  schemaVersion: 1,
  title: "Piano proposto",
  context: {
    workspaceId: "UUID o null",
    academicYearId: "UUID o null",
    trackId: "UUID o null",
    subjectId: "UUID o null",
    level: "codice configurato",
  },
  hours: {
    weekly: 3,
    weeks: 33,
    assessmentPercent: 15,
    assessmentHours: 0,
    recoveryHours: 6,
    activityHours: 3,
    excludedPeriods: [
      { start: "2026-12-23", end: "2027-01-06", note: "Indicazione locale" },
    ],
  },
  sourceIds: ["UUID delle fonti fornite"],
  modules: [
    {
      id: "modulo-1",
      title: "Titolo",
      rationale: "Proposta organizzativa",
      origins: [
        {
          sourceId: "UUID",
          excerpt: "Estratto letterale",
          interpretation: "Interpretazione distinta",
        },
      ],
      prerequisites: [],
      objectives: [],
      topics: [
        {
          id: "argomento-1",
          title: "Argomento",
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
  ],
  notes: "",
  status: "proposed",
  version: 1,
  generationWarnings: [],
};
// Include confirmed extracts once; retain original page text in stored provenance.
function promptSource(source:CurriculumSource) {const {metadata,...rest}=source;return {...rest,metadata:{...metadata,pages:undefined},selectedPageNumbers:metadata.selected_page_numbers}}
export function curriculumPrompt(
  plan: CurriculumPlan,
  sources: CurriculumSource[],
) {
  return `Crea esclusivamente un CurriculumPlan v1 JSON modificabile per il contesto fornito. Non inventare prescrizioni normative. Distingui sempre ciò che è esplicitamente presente nella fonte da ciò che costituisce una proposta organizzativa. Il piano risultante deve essere una proposta modificabile, non una dichiarazione di obbligatorietà. Non chiamarlo programma ministeriale o programma ufficiale. Il tipo "official" è una dichiarazione dell’autore della fonte, non una verifica automatica. Usa soltanto gli ID fonti e contesto forniti. Gli estratti devono essere letterali; le interpretazioni stanno nel campo interpretation; rationale descrive la proposta. Segnala lacune e integrazioni in generationWarnings. Nessun argomento è già trattato: progress=not_started, actualMaterial vuoto. Le ore sono stime e il budget deve essere rispettato. Nessuna pubblicazione automatica.\nCONTESTO E VINCOLI\n${JSON.stringify({ ...plan, modules: [] }, null, 2)}\nFONTI\n${JSON.stringify(
    sources.filter((s) => plan.sourceIds.includes(s.id)).map(promptSource),
    null,
    2,
  )}\nSTRUTTURA OBBLIGATORIA\n${JSON.stringify(curriculumJsonContract, null, 2)}`;
}
export function preparationPrompt(
  plan: CurriculumPlan,
  module: CurriculumPlan["modules"][number],
  sources: CurriculumSource[],
  knowledge: string,
  familiarity: string,
  limits: string,
) {
  return `PREPARAZIONE PERSONALE · NON PUBBLICABILE\nDevi prima preparare la persona che dovrà presentare l’argomento. Spiega in modo rigoroso ma comprensibile. Distingui ciò che deriva dalle fonti fornite dalle integrazioni esplicative. Segnala ciò che richiede verifica. Non trasformare automaticamente questa preparazione in materiale destinato ai membri. Non dichiarare nuove prescrizioni normative. Produci spiegazione, prerequisiti necessari, concetti difficili, errori frequenti, collegamenti, esercizi personali, domande di verifica e fonti da verificare. Il materiale realmente trattato dovrà essere dichiarato separatamente nel Prompt Builder.\nCONTESTO ${JSON.stringify(plan.context)}\nMODULO ${JSON.stringify(module)}\nFONTI ${JSON.stringify(sources.filter((s) => plan.sourceIds.includes(s.id)).map(promptSource))}\nCONOSCENZE DISPONIBILI ${knowledge}\nFAMILIARITÀ ${familiarity}\nLIMITI ${limits}`;
}
