import { useEffect, useState } from "react";
import { BookCopy, Copy } from "lucide-react";
import { db, errorMessage } from "../../backend/client";
import { canAuthor, useWorkspace } from "../../backend/workspace";
import { validateLesson } from "../../domain/validate";
import { blockSchema, assignmentDraftSchema } from "../../domain/schema";
import { moduleSchema } from "../../domain/curriculum";
import { validateSimulationConfig } from "../simulations/registry";

type Item = {
  id: string;
  kind: string;
  title: string;
  document: Record<string, unknown>;
  provenance: string | null;
  updated_at: string;
};
const kinds = {
  content: "Lezione TelecomContent",
  module: "Modulo di contenuti",
  exercise: "Esercizio",
  assignmentTemplate: "Template compito",
  simulationConfig: "Configurazione simulatore",
  plot: "Grafico",
  curriculumTemplate: "Template modulo curriculum",
};
function validateItem(kind: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Il documento deve essere un oggetto JSON.");
  const doc = value as Record<string, unknown>;
  if (kind === "content") {
    const result = validateLesson(doc);
    if (!result.lesson) throw new Error(result.errors.join("\n"));
    return result.lesson as unknown as Record<string, unknown>;
  }
  if (kind === "curriculumTemplate")
    return moduleSchema.parse(doc) as unknown as Record<string, unknown>;
  if (kind === "assignmentTemplate")
    return assignmentDraftSchema.parse(doc) as unknown as Record<
      string,
      unknown
    >;
  if (kind === "module") {
    if (!Array.isArray(doc.blocks))
      throw new Error("Un modulo deve avere un array blocks.");
    doc.blocks.forEach((b) => blockSchema.parse(b));
  }
  if (kind === "exercise" || kind === "plot") {
    const block = blockSchema.parse(doc);
    if (kind === "plot" && !block.type.endsWith("Plot"))
      throw new Error("Scegli un blocco grafico.");
    if (
      kind === "exercise" &&
      ![
        "exercise",
        "practiceQuestion",
        "guidedExercise",
        "parametricExercise",
        "exerciseGroup",
      ].includes(block.type)
    )
      throw new Error("Scegli un blocco esercizio.");
  }
  if (kind === "simulationConfig") {
    const errors = validateSimulationConfig(
      String(doc.simulationId),
      (doc.config as Record<string, unknown>) || {},
    );
    if (errors.length) throw new Error(errors.join("\n"));
  }
  return doc;
}
export default function PersonalLibrary({ ownerId }: { ownerId: string }) {
  const { subjects, workspace, profile } = useWorkspace();
  const [items, setItems] = useState<Item[]>([]),
    [kind, setKind] = useState("content"),
    [title, setTitle] = useState(""),
    [json, setJson] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState<Item | null>(null),
    [subjectId, setSubjectId] = useState(subjects[0]?.id || ""),
    [slug, setSlug] = useState(""),
    [contents, setContents] = useState<{ id: string; title: string }[]>([]),
    [contentId, setContentId] = useState("");
  useEffect(() => {
    if (!db) return;
    let active = true;
    db.from("personal_library_items")
      .select("*")
      .order("updated_at", { ascending: false })
      .range(page * 25, page * 25 + 24)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setMessage(errorMessage(error));
        else setItems(data || []);
      });
    return () => {
      active = false;
    };
  }, [page, revision]);
  useEffect(() => {
    if (!db || !canAuthor(profile?.role)) return;
    let active = true;
    db.from("content_items")
      .select("id,title")
      .order("title")
      .limit(100)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setMessage(errorMessage(error));
        else setContents(data || []);
      });
    return () => {
      active = false;
    };
  }, [workspace?.id, profile?.role]);
  const run = async (fn: () => Promise<void>) => {
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
  return (
    <div className="tool-page">
      <div className="page-heading">
        <span className="eyebrow">ACCOUNT / SPAZIO PERSONALE</span>
        <h1>Libreria personale</h1>
        <p>
          Materiali privati riutilizzabili. Ogni copia in un istituto diventa
          indipendente; risposte, account e attività non vengono copiati.
        </p>
        <a className="button subtle" href="#/personal/planning">
          Curriculum personale
        </a>
      </div>
      {message && (
        <p role="status" className="management-message">
          {message}
        </p>
      )}
      <div className="planner-columns">
        <section className="panel management-panel">
          <h2>I miei materiali</h2>
          {items.map((item) => (
            <article className="library-item" key={item.id}>
              <BookCopy size={20} />
              <div>
                <strong>{item.title}</strong>
                <small>
                  {kinds[item.kind as keyof typeof kinds]} ·{" "}
                  {new Date(item.updated_at).toLocaleDateString("it-IT")}
                </small>
                <small>
                  {item.provenance
                    ? "Provenienza conservata"
                    : "Materiale personale"}
                </small>
              </div>
              <button
                className="button subtle"
                onClick={() => {
                  setSelected(item);
                  setTitle(item.title);
                  setKind(item.kind);
                  setJson(JSON.stringify(item.document, null, 2));
                  setSlug(
                    typeof item.document.slug === "string"
                      ? `${item.document.slug}-copia`
                      : "",
                  );
                }}
              >
                Apri
              </button>
            </article>
          ))}
          {!items.length && (
            <p className="empty-search">
              La libreria è vuota. Aggiungi un materiale o salva una copia
              dall’istituto.
            </p>
          )}
          <div className="management-actions">
            <button
              className="button subtle"
              disabled={!page}
              onClick={() => setPage((n) => n - 1)}
            >
              Precedenti
            </button>
            <button
              className="button subtle"
              disabled={items.length < 25}
              onClick={() => setPage((n) => n + 1)}
            >
              Successivi
            </button>
          </div>
          {canAuthor(profile?.role) && (
            <>
              <h3>Copia una lezione dall’istituto</h3>
              <label>
                Contenuto
                <select
                  value={contentId}
                  onChange={(e) => setContentId(e.target.value)}
                >
                  <option value="">Seleziona</option>
                  {contents.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button subtle"
                disabled={!contentId || busy}
                onClick={() =>
                  run(async () => {
                    const { data, error } = await db!
                      .from("content_versions")
                      .select("document")
                      .eq("content_id", contentId)
                      .order("version", { ascending: false })
                      .limit(1);
                    if (error) throw error;
                    if (!data?.[0])
                      throw new Error("Versione non disponibile.");
                    const doc = validateItem("content", data[0].document);
                    const saved = await db!
                      .from("personal_library_items")
                      .insert({
                        owner_id: ownerId,
                        kind: "content",
                        title: doc.title,
                        document: doc,
                        provenance: `${workspace?.id}:${contentId}`,
                      });
                    if (saved.error) throw saved.error;
                    setMessage(
                      "Snapshot privato salvato. Nessun dato personale copiato.",
                    );
                  })
                }
              >
                Salva nella libreria personale
              </button>
            </>
          )}
        </section>
        <section className="panel management-panel">
          <h2>{selected ? "Materiale personale" : "Nuovo materiale"}</h2>
          <label>
            Tipo
            <select
              disabled={Boolean(selected)}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {Object.entries(kinds).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Titolo
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Documento JSON
            <textarea
              className="source-area"
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
          </label>
          <div className="management-actions">
            <button
              className="button primary"
              disabled={busy || !title.trim() || !json.trim()}
              onClick={() =>
                run(async () => {
                  if (json.length > 1000000)
                    throw new Error("Documento troppo grande.");
                  const document = validateItem(kind, JSON.parse(json));
                  const result = selected
                    ? await db!
                        .from("personal_library_items")
                        .update({
                          title,
                          document,
                          updated_at: new Date().toISOString(),
                        })
                        .eq("id", selected.id)
                    : await db!
                        .from("personal_library_items")
                        .insert({ owner_id: ownerId, kind, title, document });
                  if (result.error) throw result.error;
                  setMessage("Materiale personale salvato.");
                })
              }
            >
              Valida e salva
            </button>
            <button
              className="button subtle"
              onClick={() => {
                setSelected(null);
                setJson("");
                setTitle("");
              }}
            >
              Nuovo
            </button>
            <button
              className="button subtle"
              disabled={!json}
              onClick={() => navigator.clipboard.writeText(json)}
            >
              <Copy size={15} />
              Copia JSON
            </button>
          </div>
          {selected && (
            <>
              <button
                className="button subtle"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const { error } = await db!
                      .from("personal_library_items")
                      .delete()
                      .eq("id", selected.id);
                    if (error) throw error;
                    setSelected(null);
                    setTitle("");
                    setJson("");
                    setMessage(
                      "Materiale eliminato. Le copie negli istituti restano indipendenti.",
                    );
                  })
                }
              >
                Elimina materiale personale
              </button>
              {kind === "content" && (
                <section className="fork-panel">
                  <h3>Usa in {workspace?.name || "un istituto"}</h3>
                  <p>
                    Seleziona l’istituto nel cambio contesto. La copia viene
                    salvata come bozza, versione 1.
                  </p>
                  <label>
                    Materia destinazione
                    <select
                      value={subjectId}
                      onChange={(e) => setSubjectId(e.target.value)}
                    >
                      <option value="">Seleziona</option>
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
                    Slug della nuova copia
                    <input
                      value={slug}
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      onChange={(e) => setSlug(e.target.value)}
                    />
                  </label>
                  <button
                    className="button primary"
                    disabled={
                      !canAuthor(profile?.role) ||
                      !subjectId ||
                      !/^([a-z0-9]+-)*[a-z0-9]+$/.test(slug) ||
                      busy
                    }
                    onClick={() =>
                      run(async () => {
                        const { error } = await db!.rpc(
                          "fork_personal_content",
                          {
                            item_id: selected.id,
                            subject_id: subjectId,
                            new_slug: slug,
                          },
                        );
                        if (error) throw error;
                        setMessage("Copia indipendente creata come bozza.");
                      })
                    }
                  >
                    Crea copia contestuale
                  </button>
                </section>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
