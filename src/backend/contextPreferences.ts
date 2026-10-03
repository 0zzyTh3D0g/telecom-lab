import type {ContextSelection} from "./workspace";
function validContext(value:unknown):value is RecentContext{return Boolean(value&&typeof value==='object'&&['workspaceId','yearId','subjectId','groupId'].every(key=>typeof (value as Record<string,unknown>)[key]==='string')&&((value as Record<string,unknown>).trackId===undefined||typeof (value as Record<string,unknown>).trackId==='string'))}
export type RecentContext = ContextSelection & { workspaceId: string };
export function readPreferences(uid: string): {
  last?: RecentContext;
  recent: RecentContext[];
} {
  try {
    const value = JSON.parse(
      localStorage.getItem(`telecom:contexts:${uid}`) || "{}",
    );
    return {
      last: validContext(value.last)?value.last:undefined,
      recent: Array.isArray(value.recent) ? value.recent.filter(validContext).slice(0, 8) : [],
    };
  } catch {
    return { recent: [] };
  }
}
export function savePreference(uid: string, value: RecentContext) {
  const old = readPreferences(uid);
  const recent = [
    value,
    ...old.recent.filter((v) => JSON.stringify(v) !== JSON.stringify(value)),
  ].slice(0, 8);
  try {
    localStorage.setItem(
      `telecom:contexts:${uid}`,
      JSON.stringify({ last: value, recent }),
    );
  } catch {
    /* Optional UX storage. */
  }
}
