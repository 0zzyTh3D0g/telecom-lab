import { expect, it } from "vitest";
import {
  curriculumPlanSchema,
  emptyPlan,
  estimateHours,
  duplicatePlan,
  curriculumPrompt,
  preparationPrompt,
  planWarnings,
} from "./curriculum";

const ctx = {
  workspaceId: null,
  academicYearId: null,
  trackId: null,
  subjectId: null,
  level: "3",
};
it("rejects duplicate IDs, invalid context and malformed hours", () => {
  const p = emptyPlan(ctx);
  p.modules = [
    {
      id: "m",
      title: "M",
      rationale: "",
      origins: [],
      prerequisites: [],
      objectives: [],
      topics: [
        {
          id: "m",
          title: "T",
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
  expect(curriculumPlanSchema.safeParse(p).success).toBe(false);
  expect(
    curriculumPlanSchema.safeParse({
      ...emptyPlan(ctx),
      context: { ...ctx, subjectId: "20000000-0000-4000-8000-000000000001" },
    }).success,
  ).toBe(false);
  expect(
    curriculumPlanSchema.safeParse({
      ...emptyPlan(ctx),
      hours: { ...p.hours, weekly: Infinity },
    }).success,
  ).toBe(false);
});
it("estimates overlapping excluded periods once and gives explicit hours precedence", () => {
  const p = emptyPlan(ctx);
  p.hours = {
    weekly: 7,
    weeks: 10,
    assessmentPercent: 50,
    assessmentHours: 5,
    recoveryHours: 2,
    activityHours: 3,
    excludedPeriods: [
      { start: "2026-10-01", end: "2026-10-07", note: "" },
      { start: "2026-10-05", end: "2026-10-10", note: "" },
    ],
  };
  expect(estimateHours(p)).toMatchObject({
    nominal: 70,
    excluded: 10,
    assessment: 5,
    plannable: 50,
  });
});
it("keeps proposed preparation separate and resets actual progress in copies", () => {
  const p = emptyPlan(ctx);
  p.modules = [
    {
      id: "m",
      title: "M",
      rationale: "",
      origins: [],
      prerequisites: [],
      objectives: [],
      topics: [
        {
          id: "t",
          title: "T",
          progress: "treated",
          actualMaterial: "Materiale reale",
          notes: "",
        },
      ],
      durationHours: 8,
      activities: [],
      plots: [],
      simulators: ["unknown"],
      notes: "",
      startMonth: 9,
      endMonth: 10,
      excluded: false,
    },
  ];
  const copy = duplicatePlan(p, null);
  copy.modules[0].title = "Nuovo";
  expect(p.modules[0].title).toBe("M");
  expect(copy.modules[0].topics[0].actualMaterial).toBe("");
  expect(copy.modules[0].topics[0].progress).toBe("not_started");
  expect(curriculumPrompt(p, [])).toContain(
    "Non inventare prescrizioni normative",
  );
  expect(preparationPrompt(p, p.modules[0], [], "", "", "")).toContain(
    "NON PUBBLICABILE",
  );
  expect(planWarnings(p, []).join(" ")).toContain("simulatore non disponibile");
});
