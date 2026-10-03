import { useCallback, useEffect, useMemo, useState } from "react";
import {
  db,
  errorMessage,
  loadProfile,
  setRequestWorkspace,
  getRequestWorkspace,
  type Account,
  type Institution,
  type Profile,
} from "./client";
import {
  readPreferences,
  savePreference,
  type RecentContext,
} from "./contextPreferences";
import type { ContextSelection } from "./workspace";

export function useInstitutions() {
  const [account, setAccount] = useState<Account | null>(null),
    [institutions, setInstitutions] = useState<Institution[]>([]),
    [activeId, setActiveId] = useState(""),
    [selection, setSelection] = useState<ContextSelection>({
      yearId: "",trackId:"",
      subjectId: "",
      groupId: "",
    });
  const [loading, setLoading] = useState(Boolean(db)),
    [error, setError] = useState(""),
    [recent, setRecent] = useState<RecentContext[]>([]);
  const refresh = useCallback(async () => {
    if (!db) return;
    try {
      const { data, error: authIssue } = await db.auth.getUser();
      if (authIssue) throw authIssue;
      if (!data.user) {
        setAccount(null);
        setInstitutions([]);
        setActiveId("");
        setRequestWorkspace(null);
        return;
      }
      const next = await loadProfile(data.user.id);
      setAccount((v) =>
        JSON.stringify(v) === JSON.stringify(next) ? v : next,
      );
      const result = await db.rpc("my_workspaces");
      if (result.error) throw result.error;
      const allowed = (result.data || []) as Institution[];
      setInstitutions(allowed);
      const prefs = readPreferences(next.id);
      setRecent(prefs.recent);
      {
        const current=getRequestWorkspace();
        const candidate = current || prefs.last?.workspaceId || "";
        const chosen =
          allowed.find(
            (w) => w.id === candidate && !w.disabled && !w.archived_at,
          ) || allowed.find((w) => !w.disabled && !w.archived_at);
        setRequestWorkspace(chosen?.id || null);
        if (!current && prefs.last && chosen?.id === prefs.last.workspaceId)
          setSelection({
            yearId: prefs.last.yearId || "",trackId:prefs.last.trackId||"",
            subjectId: prefs.last.subjectId || "",
            groupId: prefs.last.groupId || "",
          });
        setActiveId(chosen?.id || "");
      }
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!db) return;
    void refresh();
    const { data } = db.auth.onAuthStateChange(() => setTimeout(refresh, 0));
    return () => data.subscription.unsubscribe();
  }, [refresh]);
  const active = institutions.find(
    (w) => w.id === activeId && !w.disabled && !w.archived_at,
  );
  const profile: Profile | null = useMemo(()=>
    account && active
      ? {
          ...account,
          workspace_id: active.id,
          role: active.role,
          disabled: account.disabled || active.disabled,
        }
      : null,[account,active]);
  const change = useCallback(
    (id: string, value?: ContextSelection) => {
      if (
        !institutions.some((w) => w.id === id && !w.disabled && !w.archived_at)
      ) {
        setError("Istituto non autorizzato o archiviato.");
        return;
      }
      setRequestWorkspace(id);
      setActiveId(id);
      setSelection(value || { yearId: "",trackId:"", subjectId: "", groupId: "" });
      window.location.hash = "/";
    },
    [institutions],
  );
  const select = useCallback(
    (value: ContextSelection) => {
      setSelection(value);
      if (account && activeId) {
        savePreference(account.id, { ...value, workspaceId: activeId });
        setRecent(readPreferences(account.id).recent);
      }
    },
    [account, activeId],
  );
  const logout = async () => {
    await db?.auth.signOut();
    setRequestWorkspace(null);
    setAccount(null);
    setInstitutions([]);
    setActiveId("");
    window.location.hash = "/";
  };
  return {
    account,
    profile,
    institutions,
    activeId,
    selection,
    select,
    change,
    recent,
    loading,
    error,
    setError,
    refresh,
    logout,
  };
}
