import { useEffect, useState } from "react";
import LocalPdfSource from './LocalPdfSource';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarDays,
  Copy,
  FileText,
  Plus,
  Sparkles,
} from "lucide-react";
import { db, errorMessage } from "../../backend/client";
import { canAuthor, canManage, useWorkspace } from "../../backend/workspace";
import {
  curriculumPlanSchema,
  curriculumSourceSchema,
  curriculumPrompt,
  duplicatePlan,
  emptyPlan,
  estimateHours,
  planWarnings,
  preparationPrompt,
  progressLabels,
  type CurriculumPlan,
  type CurriculumSource,
  type PlanRow,
} from "../../domain/curriculum";

const months = [
  "Gen",
  "Feb",
  "Mar",
  "Apr",
  "Mag",
  "Giu",
  "Lug",
  "Ago",
  "Set",
  "Ott",
  "Nov",
  "Dic",
];
const sourceInitial = curriculumSourceSchema.parse({ title: "Nuova fonte" });
const sourceRow = (r: Record<string, unknown>): CurriculumSource => ({
  ...curriculumSourceSchema.parse({
    title: r.title,
    issuer: r.issuer,
    discipline: r.discipline,
    track: r.track,
    articulation: r.articulation,
    level: r.level,
    documentYear: r.document_year,
    documentVersion: r.document_version,
    documentDate: r.document_date || "",
    url: r.url || "",
    sourceType: r.source_type,
    text: r.text_content,
    notes: r.notes,
    metadata: r.metadata,
  }),
  id: String(r.id),
  workspace_id: r.workspace_id as string | null,
  subject_id: r.subject_id as string | null,
  owner_id: String(r.owner_id),
});
export default function Planning({
  personal = false,
  ownerId,
}: {
  personal?: boolean;
  ownerId?: string;
}) {
  const { profile, workspace, years, tracks, subjects, groups, levels, trackLevels, selection } =
    useWorkspace();
  const year = years.find((y) => y.id === selection.yearId),
    group = groups.find((g) => g.id === selection.groupId);
  const context = {
    workspaceId: personal ? null : workspace?.id || null,
    academicYearId: personal ? null : year?.id || null,
    trackId: personal
      ? null
      : selection.trackId || group?.track_id || tracks.find((t) => !t.archived_at)?.id || null,
    subjectId: personal
      ? null
      : selection.subjectId || subjects.find((s) => !s.archived_at)?.id || null,
    level: levels.find(l=>l.id===group?.level_id)?.code || (!personal?levels[0]?.code:'') || '',
  };
  const [tab, setTab] = useState("Piano"),
    [sources, setSources] = useState<CurriculumSource[]>([]),
    [plans, setPlans] = useState<PlanRow[]>([]),
    [source, setSource] = useState(sourceInitial),
    [plan, setPlan] = useState(() => emptyPlan(context));
  const [pid, setPid] = useState<string | null>(null),
    [savedVersion, setSavedVersion] = useState(0),
    [versions, setVersions] = useState<
      { version: number; created_at: string; document: CurriculumPlan }[]
    >([]),
    [json, setJson] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [page, setPage] = useState(0),
    [imported, setImported] = useState(false);
  const [knowledge, setKnowledge] = useState(""),
    [familiarity, setFamiliarity] = useState("Prima esplorazione"),
    [limits, setLimits] = useState(""),
    [moduleId, setModuleId] = useState(""),
    [duplicateYear, setDuplicateYear] = useState("");
  const canEdit = personal || canAuthor(profile?.role),
    readonly =
      !canEdit ||
      (!personal &&
        years.find((y) => y.id === plan.context.academicYearId)?.status ===
          "archived"),
    budget = estimateHours(
      plan,
      year ? { start: year.start_date, end: year.end_date } : undefined,
    );
  const operation = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setRevision((n) => n + 1);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!db) return;
    let current = true;
    const load = async () => {
      let sq = db!
          .from("curriculum_sources")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        pq = db!
          .from("curriculum_plans")
          .select(
            "id,title,document,version,status,academic_year_id,subject_id",
          )
          .order("updated_at", { ascending: false })
          .range(page * 25, page * 25 + 24);
      if (personal) {
        sq = sq.is("workspace_id", null);
        pq = pq.is("workspace_id", null);
      } else {
        sq = sq.eq("workspace_id", workspace?.id || "");
        pq = pq.eq("workspace_id", workspace?.id || "");
        if (selection.yearId) pq = pq.eq("academic_year_id", selection.yearId);
        if (selection.subjectId) {
          sq = sq.eq("subject_id", selection.subjectId);
          pq = pq.eq("subject_id", selection.subjectId);
        }
      }
      const [s, p] = await Promise.all([sq, pq]);
      if (s.error || p.error) throw s.error || p.error;
      if (current) {
        setSources((s.data || []).map(sourceRow));
        setPlans((p.data || []) as PlanRow[]);
      }
    };
    void load().catch((e) => {
      if (current) setMessage(errorMessage(e));
    });
    return () => {
      current = false;
    };
  }, [
    workspace?.id,
    personal,
    revision,
    page,
    selection.yearId,
    selection.subjectId,
  ]);
  const loadPlan = (row: PlanRow) => {
    const parsed = curriculumPlanSchema.safeParse(row.document);
    if (!parsed.success) {
      setMessage("Piano salvato incompatibile.");
      return;
    }
    setPlan(parsed.data);
    setPid(row.id);
    setSavedVersion(row.version);
    setImported(false);
    setVersions([]);
    setMessage("");
  };
  const save = async (op = "save") => {
    if (!db) return;
    const doc = curriculumPlanSchema.parse(plan);
    const result = await db.rpc("save_curriculum_plan", {
      doc,
      plan_id: pid,
      expected_version: savedVersion,
      operation: imported && op === "save" ? "import" : op,
    });
    if (result.error) throw result.error;
    const v = pid ? savedVersion + 1 : 1;
    setPid(result.data);
    setSavedVersion(v);
    setImported(false);
    setPlan({
      ...doc,
      version: v,
      status:
        op === "approve"
          ? "approved"
          : imported
            ? "proposed"
            : doc.status === "approved"
              ? "proposed"
              : doc.status,
    });
    setMessage("Piano salvato. Cronologia conservata.");
    setVersions([]);
  };
  const updateModule = (
    index: number,
    value: Partial<CurriculumPlan["modules"][number]>,
  ) =>
    setPlan((p) => ({
      ...p,
      modules: p.modules.map((m, i) => (i === index ? { ...m, ...value } : m)),
    }));
  const move = (index: number, delta: number) =>
    setPlan((p) => {
      const modules = [...p.modules];
      [modules[index], modules[index + delta]] = [
        modules[index + delta],
        modules[index],
      ];
      return { ...p, modules };
    });
  const newPlan = () => {
    setPlan(emptyPlan(context));
    setPid(null);
    setSavedVersion(0);
    setImported(false);
    setVersions([]);
    setJson("");
    setMessage("");
  };
  const preparationModule =
    plan.modules.find((m) => m.id === moduleId) || plan.modules[0];
  const warnings = planWarnings(plan, sources);
  const content = (
    module: CurriculumPlan["modules"][number],
    topic: CurriculumPlan["modules"][number]["topics"][number],
  ) => {
    const subject = subjects.find((s) => s.id === plan.context.subjectId);
    if (!subject || personal) {
      setMessage(
        "Scegli un piano dell’istituto e una materia per creare la lezione.",
      );
      return;
    }
    sessionStorage.setItem(
      "telecom:lesson-prefill",
      JSON.stringify({
        workspaceId: workspace?.id,
        subject: subject.slug,
        subjectName: subject.name,
        levelCode: plan.context.level,
        module: module.title,
        topic: topic.title,
        title: topic.title,
        plannedSource: module.origins.map((o) => o.excerpt).join("\n"),
        objectives: module.objectives,
        source: "",
      }),
    );
    window.location.assign("#/prompt");
  };
  const prompt = curriculumPrompt(plan, sources);
  return (
    <div className="tool-page planning-page">
      <div className="page-heading">
        <span className="eyebrow">
          {personal
            ? "SPAZIO PERSONALE"
            : `${workspace?.name} / ${year?.label || "Scegli anno"}`}
        </span>
        <h1>Pianificazione</h1>
        <p>
          Le fonti stabiliscono il quadro. Il piano propone una sequenza; la
          persona decide cosa trattare.
        </p>
      </div>
      <nav className="management-tabs" aria-label="Pianificazione">
        {["Fonti", "Piano", "Prepara argomento"].map((t) => (
          <button
            className={tab === t ? "active" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t === "Fonti" ? (
              <FileText size={16} />
            ) : t === "Piano" ? (
              <CalendarDays size={16} />
            ) : (
              <BookOpen size={16} />
            )}{" "}
            {t}
          </button>
        ))}
      </nav>
      {message && (
        <p role="status" className="management-message">
          {message}
        </p>
      )}
      {tab === "Fonti" && (
        <div className="planner-columns">
          <section className="panel management-panel">
            <h2>Libreria fonti</h2>
            <p>
              Il tipo “ufficiale” è dichiarato da chi inserisce la fonte. Il
              sistema non verifica la validità normativa.
            </p>
            {sources.map((s) => (
              <article key={s.id} className="source-card">
                <span className="eyebrow">
                  {s.sourceType === "official"
                    ? "FONTE DICHIARATA UFFICIALE"
                    : "INDICAZIONE MANUALE"}
                </span>
                <h3>{s.title}</h3>
                <p>
                  {s.issuer || "Ente non indicato"} ·{" "}
                  {s.documentDate || s.documentYear || "Data non indicata"} ·{" "}
                  {s.documentVersion || "Versione non indicata"}
                </p>
                <small>
                  {s.track} · {s.discipline} · {s.articulation} · {s.level}
                </small>
                {s.url && (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    Origine della fonte
                  </a>
                )}
                <details>
                  <summary>Testo e note</summary>
                  <p className="preserve-text">{s.text}</p>
                  <p>{s.notes}</p>
                </details>
                {canEdit && (
                  <button
                    className="button subtle"
                    disabled={busy}
                    onClick={() =>
                      operation(async () => {
                        const { error } = await db!.rpc(
                          "delete_curriculum_source",
                          { source_id: s.id },
                        );
                        if (error) throw error;
                      })
                    }
                  >
                    Elimina fonte non utilizzata
                  </button>
                )}
              </article>
            ))}
            {sources.length === 100 && (
              <p>
                Prime 100 fonti. Filtra per materia per restringere la libreria.
              </p>
            )}
          </section>
          {canEdit && (
            <section className="panel management-panel">
              <h2>Aggiungi fonte</h2>
              {(
                [
                  "title",
                  "issuer",
                  "discipline",
                  "track",
                  "articulation",
                  "level",
                  "documentYear",
                  "documentVersion",
                  "documentDate",
                  "url",
                ] as const
              ).map((key, i) => (
                <label key={key}>
                  {
                    [
                      "Titolo",
                      "Ente",
                      "Disciplina",
                      "Indirizzo",
                      "Articolazione / opzione",
                      "Livello",
                      "Anno documento",
                      "Versione",
                      "Data",
                      "URL origine",
                    ][i]
                  }
                  <input
                    type={
                      key === "documentDate"
                        ? "date"
                        : key === "url"
                          ? "url"
                          : "text"
                    }
                    value={source[key]}
                    onChange={(e) =>
                      setSource({ ...source, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label>
                Provenienza
                <select
                  value={source.sourceType}
                  onChange={(e) =>
                    setSource({
                      ...source,
                      sourceType: e.target.value as "official" | "manual",
                    })
                  }
                >
                  <option value="manual">Indicazione manuale</option>
                  <option value="official">Fonte dichiarata ufficiale</option>
                </select>
              </label>
              <label>
                Testo della fonte
                <textarea
                  value={source.text}
                  onChange={(e) =>
                    setSource({ ...source, text: e.target.value })
                  }
                />
              </label>
              <label>
                Carica testo UTF-8 (.txt / .md)
                <input
                  type="file"
                  accept=".txt,.md,text/plain"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      if (file.size > 800000) {
                        setMessage(
                          "Testo troppo grande. Limite: 200.000 caratteri.",
                        );
                        return;
                      }
                      void file
                        .text()
                        .then((text) =>
                          setSource((s) => ({
                            ...s,
                            text,
                            metadata: { filename: file.name, size: file.size },
                          })),
                        );
                    }
                  }}
                />
              </label>
              <LocalPdfSource onConfirm={(text,metadata)=>setSource(s=>({...s,text,metadata:{...s.metadata,...metadata}}))}/>
              <label>
                Note
                <textarea
                  value={source.notes}
                  onChange={(e) =>
                    setSource({ ...source, notes: e.target.value })
                  }
                />
              </label>
              <button
                className="button primary"
                disabled={busy || (!personal && !context.subjectId)}
                onClick={() =>
                  operation(async () => {
                    const payload = curriculumSourceSchema.parse(source);
                    const { error } = await db!.rpc("save_curriculum_source", {
                      payload: {
                        ...payload,
                        workspaceId: context.workspaceId,
                        subjectId: context.subjectId,
                      },
                    });
                    if (error) throw error;
                    setSource(sourceInitial);
                    setMessage("Fonte salvata con provenienza e testo.");
                  })
                }
              >
                Salva fonte
              </button>
            </section>
          )}
        </div>
      )}
      {tab === "Piano" && (
        <>
          <div className="planning-toolbar">
            <label>
              Piani nel contesto
              <select
                aria-label="Piano da aprire"
                value={pid || ""}
                onChange={(e) => {
                  const row = plans.find((p) => p.id === e.target.value);
                  if (row) loadPlan(row);
                  else newPlan();
                }}
              >
                <option value="">Nuovo piano</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} · {p.status} · v{p.version}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button subtle"
              disabled={!canEdit}
              onClick={newPlan}
            >
              <Plus size={16} />
              Nuovo
            </button>
            <button
              className="button subtle"
              disabled={page === 0}
              onClick={() => setPage((n) => n - 1)}
            >
              Precedenti
            </button>
            <button
              className="button subtle"
              disabled={plans.length < 25}
              onClick={() => setPage((n) => n + 1)}
            >
              Successivi
            </button>
          </div>
          <div className="planner-columns">
            <section className="panel management-panel">
              <h2>Contesto e stima ore</h2>
              <p>
                {plan.status === "approved"
                  ? "Piano approvato"
                  : "Piano proposto · modificabile"}{" "}
                · Versione {savedVersion || 1}
                {readonly ? " · Sola lettura" : ""}
              </p>
              <fieldset disabled={readonly || busy}>
                <label>
                  Titolo del piano
                  <input
                    value={plan.title}
                    onChange={(e) =>
                      setPlan({ ...plan, title: e.target.value })
                    }
                  />
                </label>
                {!personal && (
                  <>
                    <label>
                      Materia del piano
                      <select
                        disabled={Boolean(pid)}
                        value={plan.context.subjectId || ""}
                        onChange={(e) =>
                          setPlan({
                            ...plan,
                            context: {
                              ...plan.context,
                              subjectId: e.target.value,
                            },
                          })
                        }
                      >
                        {subjects
                          .filter((s) => !s.archived_at)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Anno del piano
                      <select
                        disabled={Boolean(pid)}
                        value={plan.context.academicYearId || ""}
                        onChange={(e) =>
                          setPlan({
                            ...plan,
                            context: {
                              ...plan.context,
                              academicYearId: e.target.value,
                            },
                          })
                        }
                      >
                        <option value="">Seleziona</option>
                        {years.map((y) => (
                          <option key={y.id} value={y.id}>
                            {y.label} · {y.status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Indirizzo del piano
                      <select
                        disabled={Boolean(pid)}
                        value={plan.context.trackId || ""}
                        onChange={(e) =>
                          setPlan({
                            ...plan,
                            context: {
                              ...plan.context,
                              trackId: e.target.value,
                            },
                          })
                        }
                      >
                        <option value="">Seleziona</option>
                        {tracks
                          .filter((t) => !t.archived_at)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  </>
                )}
                <label>
                  Livello
                  {personal ? <input value={plan.context.level} onChange={e=>setPlan({...plan,context:{...plan.context,level:e.target.value}})}/> : <select value={plan.context.level} onChange={e=>setPlan({...plan,context:{...plan.context,level:e.target.value}})}><option value="">Generale</option>{trackLevels.filter(t=>t.track_id===plan.context.trackId).map(t=>{const l=levels.find(l=>l.id===t.level_id);return l&&!l.archived_at?<option key={l.id} value={l.code}>{l.label}</option>:null})}</select>}
                </label>
                {(
                  [
                    "weekly",
                    "weeks",
                    "assessmentPercent",
                    "assessmentHours",
                    "recoveryHours",
                    "activityHours",
                  ] as const
                ).map((key, i) => (
                  <label key={key}>
                    {
                      [
                        "Ore settimanali",
                        "Settimane stimate",
                        "Verifiche (%) se ore = 0",
                        "Ore verifiche (prevalgono sulla %)",
                        "Ore recupero",
                        "Ore altre attività",
                      ][i]
                    }
                    <input
                      type="number"
                      min="0"
                      value={plan.hours[key]}
                      onChange={(e) =>
                        setPlan({
                          ...plan,
                          hours: {
                            ...plan.hours,
                            [key]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
                <details>
                  <summary>Periodi esclusi</summary>
                  {plan.hours.excludedPeriods.map((p, i) => (
                    <div key={i} className="form-pair">
                      <label>
                        Da
                        <input
                          type="date"
                          value={p.start}
                          onChange={(e) =>
                            setPlan({
                              ...plan,
                              hours: {
                                ...plan.hours,
                                excludedPeriods: plan.hours.excludedPeriods.map(
                                  (v, j) =>
                                    j === i
                                      ? { ...v, start: e.target.value }
                                      : v,
                                ),
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        A
                        <input
                          type="date"
                          value={p.end}
                          onChange={(e) =>
                            setPlan({
                              ...plan,
                              hours: {
                                ...plan.hours,
                                excludedPeriods: plan.hours.excludedPeriods.map(
                                  (v, j) =>
                                    j === i ? { ...v, end: e.target.value } : v,
                                ),
                              },
                            })
                          }
                        />
                      </label>
                      <button
                        className="button subtle"
                        onClick={() =>
                          setPlan({
                            ...plan,
                            hours: {
                              ...plan.hours,
                              excludedPeriods:
                                plan.hours.excludedPeriods.filter(
                                  (_, j) => j !== i,
                                ),
                            },
                          })
                        }
                      >
                        Rimuovi periodo
                      </button>
                    </div>
                  ))}
                  <button
                    className="button subtle"
                    onClick={() =>
                      setPlan({
                        ...plan,
                        hours: {
                          ...plan.hours,
                          excludedPeriods: [
                            ...plan.hours.excludedPeriods,
                            {
                              start: year?.start_date || "2026-09-01",
                              end: year?.start_date || "2026-09-01",
                              note: "",
                            },
                          ],
                        },
                      })
                    }
                  >
                    Aggiungi periodo
                  </button>
                </details>
                <fieldset>
                  <legend>Fonti del piano</legend>
                  {sources.map((s) => (
                    <label key={s.id}>
                      <input
                        type="checkbox"
                        checked={plan.sourceIds.includes(s.id)}
                        onChange={(e) =>
                          setPlan({
                            ...plan,
                            sourceIds: e.target.checked
                              ? [...plan.sourceIds, s.id]
                              : plan.sourceIds.filter((id) => id !== s.id),
                          })
                        }
                      />
                      {s.title}
                    </label>
                  ))}
                </fieldset>
                <label>
                  Note e vincoli
                  <textarea
                    value={plan.notes}
                    onChange={(e) =>
                      setPlan({ ...plan, notes: e.target.value })
                    }
                  />
                </label>
              </fieldset>
              <div className="hour-estimate">
                <span>STIMA</span>
                <strong>{budget.plannable.toFixed(1)} h pianificabili</strong>
                <small>
                  {budget.nominal} nominali · {budget.planned} proposte ·{" "}
                  {budget.remaining.toFixed(1)} residue
                </small>
                <small>
                  Periodi sovrapposti conteggiati una volta. Ore indicative.
                </small>
              </div>
            </section>
            <section className="panel management-panel">
              <h2>Fonte → proposta → anteprima</h2>
              <p>
                Genera istruzioni, usa un chatbot esterno, poi incolla il JSON.
                Una proposta importata entra sempre come “proposed”. Non è una
                verifica semantica o normativa.
              </p>
              <details>
                <summary>Metaprompt curriculum</summary>
                <textarea
                  readOnly
                  aria-label="Metaprompt curriculum"
                  value={prompt}
                />
                <button
                  className="button subtle"
                  onClick={() => navigator.clipboard.writeText(prompt)}
                >
                  <Copy size={15} />
                  Copia metaprompt
                </button>
              </details>
              {canEdit && (
                <>
                  <label>
                    CurriculumPlan JSON
                    <textarea
                      aria-label="CurriculumPlan JSON"
                      value={json}
                      onChange={(e) => setJson(e.target.value)}
                    />
                  </label>
                  <div className="management-actions">
                    <button
                      className="button primary"
                      disabled={readonly || busy || !json.trim()}
                      onClick={() => {
                        try {
                          if (json.length > 1000000)
                            throw new Error("Piano troppo grande.");
                          const parsed = curriculumPlanSchema.parse(
                            JSON.parse(json),
                          );
                          if (
                            JSON.stringify(parsed.context) !==
                            JSON.stringify(plan.context)
                          )
                            throw new Error(
                              "Il contesto importato deve coincidere con il piano corrente.",
                            );
                          setPlan({
                            ...parsed,
                            status: "proposed",
                            version: savedVersion || 1,
                            modules: parsed.modules.map((m) => ({
                              ...m,
                              topics: m.topics.map((t) => ({
                                ...t,
                                progress: "not_started",
                                actualMaterial: "",
                              })),
                            })),
                          });
                          setImported(true);
                          setMessage(
                            "JSON valido. Anteprima proposta: verifica fonti, ore e moduli prima di salvare.",
                          );
                        } catch (e) {
                          setMessage(errorMessage(e));
                        }
                      }}
                    >
                      Valida e anteprima
                    </button>
                    <button
                      className="button subtle"
                      onClick={() => setJson(JSON.stringify(plan, null, 2))}
                    >
                      Esporta JSON modificabile
                    </button>
                  </div>
                </>
              )}{" "}
              {warnings.length > 0 && (
                <div className="generation-warning" role="note">
                  <strong>Da verificare prima dell’approvazione</strong>
                  <ul>
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p>
                Origini: estratti letterali. Interpretazione: normalizzazione
                esplicativa. Moduli e durate: proposta organizzativa.
              </p>
              <div className="management-actions">
                <button
                  className="button primary"
                  disabled={readonly || busy}
                  onClick={() => operation(() => save())}
                >
                  Salva piano
                </button>
                <button
                  className="button subtle"
                  disabled={
                    readonly ||
                    busy ||
                    (!personal && !canManage(profile?.role)) ||
                    !pid ||
                    imported
                  }
                  onClick={() => operation(() => save("approve"))}
                >
                  Approva piano
                </button>
              </div>
              {pid && (
                <details>
                  <summary
                    onClick={() => {
                      if (!versions.length)
                        void operation(async () => {
                          const { data, error } = await db!
                            .from("curriculum_plan_versions")
                            .select("version,created_at,document")
                            .eq("plan_id", pid)
                            .order("version", { ascending: false })
                            .limit(50);
                          if (error) throw error;
                          setVersions(data || []);
                        });
                    }}
                  >
                    Cronologia versioni
                  </summary>
                  {versions.map((v) => (
                    <div className="version-row" key={v.version}>
                      <span>
                        v{v.version} ·{" "}
                        {new Date(v.created_at).toLocaleString("it-IT")}
                      </span>
                      <button
                        className="button subtle"
                        disabled={readonly || busy}
                        onClick={() =>
                          operation(async () => {
                            const { error } = await db!.rpc(
                              "restore_curriculum_plan",
                              {
                                plan_id: pid,
                                source_version: v.version,
                                expected_version: savedVersion,
                              },
                            );
                            if (error) throw error;
                            setPlan({
                              ...v.document,
                              status:
                                v.document.status === "approved"
                                  ? "proposed"
                                  : v.document.status,
                              version: savedVersion + 1,
                            });
                            setSavedVersion((n) => n + 1);
                            setVersions([]);
                            setMessage(
                              "Ripristino salvato come nuova versione.",
                            );
                          })
                        }
                      >
                        Ripristina questa versione
                      </button>
                    </div>
                  ))}
                </details>
              )}
              {!personal && pid && (
                <>
                  <label>
                    Duplica per anno scolastico
                    <select
                      value={duplicateYear}
                      onChange={(e) => setDuplicateYear(e.target.value)}
                    >
                      <option value="">Scegli nuovo anno</option>
                      {years
                        .filter(
                          (y) =>
                            y.id !== plan.context.academicYearId &&
                            y.status !== "archived",
                        )
                        .map((y) => (
                          <option key={y.id} value={y.id}>
                            {y.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    className="button subtle"
                    disabled={!canEdit || !duplicateYear || busy}
                    onClick={() =>
                      operation(async () => {
                        const copy = duplicatePlan(plan, duplicateYear);
                        const { error } = await db!.rpc(
                          "save_curriculum_plan",
                          { doc: copy, operation: "save" },
                        );
                        if (error) throw error;
                        setMessage(
                          "Copia indipendente creata. Progresso e materiale trattato azzerati.",
                        );
                      })
                    }
                  >
                    Duplica piano
                  </button>
                </>
              )}
            </section>
          </div>
          <section className="curriculum-timeline">
            <div className="section-heading">
              <div>
                <span className="eyebrow">SEQUENZA SUGGERITA</span>
                <h2>Timeline annuale</h2>
              </div>
              <button
                className="button subtle"
                disabled={readonly}
                onClick={() =>
                  setPlan({
                    ...plan,
                    modules: [
                      ...plan.modules,
                      {
                        id: crypto.randomUUID(),
                        title: "Nuovo modulo",
                        rationale: "",
                        origins: [],
                        prerequisites: [],
                        objectives: [],
                        topics: [],
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
                  })
                }
              >
                <Plus size={16} />
                Aggiungi modulo
              </button>
            </div>
            {plan.modules.map((m, i) => (
              <article
                key={m.id}
                className={`timeline-module ${m.excluded ? "excluded" : ""}`}
              >
                <div className="timeline-period">
                  <strong>
                    {months[m.startMonth - 1]}–{months[m.endMonth - 1]}
                  </strong>
                  <span>{m.durationHours} h · stima</span>
                  <div>
                    <button
                      className="icon-button"
                      aria-label={`Sposta su ${m.title}`}
                      disabled={readonly || i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Sposta giù ${m.title}`}
                      disabled={readonly || i === plan.modules.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                </div>
                <div className="timeline-body">
                  <fieldset disabled={readonly}>
                    <label>
                      Titolo modulo
                      <input
                        value={m.title}
                        onChange={(e) =>
                          updateModule(i, { title: e.target.value })
                        }
                      />
                    </label>
                    <div className="form-pair">
                      <label>
                        Inizio
                        <select
                          value={m.startMonth}
                          onChange={(e) =>
                            updateModule(i, {
                              startMonth: Number(e.target.value),
                            })
                          }
                        >
                          {months.map((n, j) => (
                            <option key={n} value={j + 1}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Fine
                        <select
                          value={m.endMonth}
                          onChange={(e) =>
                            updateModule(i, {
                              endMonth: Number(e.target.value),
                            })
                          }
                        >
                          {months.map((n, j) => (
                            <option key={n} value={j + 1}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Ore modulo
                        <input
                          type="number"
                          min="0"
                          value={m.durationHours}
                          onChange={(e) =>
                            updateModule(i, {
                              durationHours: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={m.excluded}
                        onChange={(e) =>
                          updateModule(i, { excluded: e.target.checked })
                        }
                      />
                      Escludi dalla pianificazione
                    </label>
                    <label>
                      Motivazione della proposta
                      <textarea
                        value={m.rationale}
                        onChange={(e) =>
                          updateModule(i, { rationale: e.target.value })
                        }
                      />
                    </label>
                  </fieldset>
                  <details>
                    <summary>Origine nella fonte e interpretazione</summary>
                    {m.origins.length ? (
                      m.origins.map((o, j) => (
                        <div key={j}>
                          <strong>
                            {sources.find((s) => s.id === o.sourceId)?.title ||
                              "Fonte non disponibile"}
                          </strong>
                          <blockquote>{o.excerpt}</blockquote>
                          <p>
                            Interpretazione:{" "}
                            {o.interpretation || "Non indicata"}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p>
                        Origine non indicata. Verificare prima di approvare.
                      </p>
                    )}
                  </details>
                  <details>
                    <summary>Prerequisiti, obiettivi, attività e note</summary>
                    <fieldset disabled={readonly}>
                      {(
                        [
                          "prerequisites",
                          "objectives",
                          "activities",
                          "plots",
                          "simulators",
                        ] as const
                      ).map((key, j) => (
                        <label key={key}>
                          {
                            [
                              "Prerequisiti",
                              "Obiettivi suggeriti",
                              "Attività suggerite",
                              "Possibili grafici",
                              "Simulatori (ID del registry)",
                            ][j]
                          }
                          <textarea
                            value={m[key].join("\n")}
                            onChange={(e) =>
                              updateModule(i, {
                                [key]: e.target.value
                                  .split("\n")
                                  .filter(Boolean),
                              })
                            }
                          />
                        </label>
                      ))}
                      <label>
                        Note modulo
                        <textarea
                          value={m.notes}
                          onChange={(e) =>
                            updateModule(i, { notes: e.target.value })
                          }
                        />
                      </label>
                    </fieldset>
                  </details>
                  <div className="topic-list">
                    {m.topics.map((t, j) => (
                      <div key={t.id} className="topic-row">
                        <label>
                          Argomento
                          <input
                            disabled={readonly}
                            value={t.title}
                            onChange={(e) =>
                              updateModule(i, {
                                topics: m.topics.map((v, k) =>
                                  k === j ? { ...v, title: e.target.value } : v,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          Stato effettivo
                          <select
                            disabled={readonly}
                            value={t.progress}
                            onChange={(e) =>
                              updateModule(i, {
                                topics: m.topics.map((v, k) =>
                                  k === j
                                    ? {
                                        ...v,
                                        progress: e.target
                                          .value as typeof t.progress,
                                      }
                                    : v,
                                ),
                              })
                            }
                          >
                            {Object.entries(progressLabels).map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Materiale effettivamente trattato
                          <textarea
                            disabled={readonly}
                            value={t.actualMaterial}
                            onChange={(e) =>
                              updateModule(i, {
                                topics: m.topics.map((v, k) =>
                                  k === j
                                    ? { ...v, actualMaterial: e.target.value }
                                    : v,
                                ),
                              })
                            }
                          />
                        </label>
                        <button
                          className="button subtle"
                          disabled={!canEdit || personal}
                          onClick={() => content(m, t)}
                        >
                          Crea contenuto
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="management-actions">
                    <button
                      className="button subtle"
                      disabled={readonly}
                      onClick={() =>
                        updateModule(i, {
                          topics: [
                            ...m.topics,
                            {
                              id: crypto.randomUUID(),
                              title: "Nuovo argomento",
                              progress: "not_started",
                              actualMaterial: "",
                              notes: "",
                            },
                          ],
                        })
                      }
                    >
                      Aggiungi argomento
                    </button>
                    <button
                      className="button subtle"
                      onClick={() => {
                        setModuleId(m.id);
                        setTab("Prepara argomento");
                      }}
                    >
                      <Sparkles size={15} />
                      Prepara argomento
                    </button>
                    <button
                      className="button subtle"
                      disabled={!canEdit}
                      onClick={() =>
                        operation(async () => {
                          const { error } = await db!
                            .from("personal_library_items")
                            .insert({
                              owner_id: ownerId || profile?.id,
                              kind: "curriculumTemplate",
                              title: m.title,
                              document: {
                                ...m,
                                topics: m.topics.map((t) => ({
                                  ...t,
                                  progress: "not_started",
                                  actualMaterial: "",
                                })),
                              },
                              provenance: pid,
                            });
                          if (error) throw error;
                          setMessage(
                            "Template personale salvato senza dati di attività.",
                          );
                        })
                      }
                    >
                      Salva template personale
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {!plan.modules.length && (
              <p className="empty-search">
                Importa una proposta o aggiungi il primo modulo.
              </p>
            )}
            <p className="planning-disclaimer">
              Pianificato: {plan.modules.flatMap((m) => m.topics).length}{" "}
              argomenti · Trattato:{" "}
              {
                plan.modules
                  .flatMap((m) => m.topics)
                  .filter((t) => t.progress === "treated").length
              }
              . Questi stati descrivono la pianificazione e non valutano
              persone.
            </p>
          </section>
        </>
      )}
      {tab === "Prepara argomento" && (
        <section className="panel management-panel">
          <h2>Preparazione personale</h2>
          <p>
            Questo output aiuta a comprendere un argomento. Non è TelecomContent
            e non viene pubblicato.
          </p>
          <label>
            Modulo da preparare
            <select
              value={preparationModule?.id || ""}
              onChange={(e) => setModuleId(e.target.value)}
            >
              {plan.modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Conoscenze già disponibili
            <textarea
              value={knowledge}
              onChange={(e) => setKnowledge(e.target.value)}
            />
          </label>
          <label>
            Familiarità
            <select
              value={familiarity}
              onChange={(e) => setFamiliarity(e.target.value)}
            >
              <option>Prima esplorazione</option>
              <option>Conoscenza parziale</option>
              <option>Consolidamento</option>
            </select>
          </label>
          <label>
            Limiti e indicazioni
            <textarea
              value={limits}
              onChange={(e) => setLimits(e.target.value)}
            />
          </label>
          {preparationModule ? (
            <>
              <textarea
                className="preparation-output"
                readOnly
                aria-label="Metaprompt preparazione"
                value={preparationPrompt(
                  plan,
                  preparationModule,
                  sources,
                  knowledge,
                  familiarity,
                  limits,
                )}
              />
              <button
                className="button primary"
                onClick={() =>
                  navigator.clipboard.writeText(
                    preparationPrompt(
                      plan,
                      preparationModule,
                      sources,
                      knowledge,
                      familiarity,
                      limits,
                    ),
                  )
                }
              >
                Copia preparazione
              </button>
            </>
          ) : (
            <p>Aggiungi o apri un modulo nel piano.</p>
          )}
        </section>
      )}
    </div>
  );
}
