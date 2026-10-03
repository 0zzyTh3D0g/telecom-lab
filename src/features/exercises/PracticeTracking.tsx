import { createContext, useContext, useState, type ReactNode } from 'react'
import { db, errorMessage, getRequestWorkspace } from '../../backend/client'

type PracticeTarget = { contentId: string; releaseId?:string|null; exerciseId: string; onError?:(message:string)=>void } | null
const PracticeContext = createContext<PracticeTarget>(null)
export const usePracticeTarget = () => useContext(PracticeContext)

export function PracticeProvider({ target, children }: { target: PracticeTarget; children: ReactNode }) {
  const [message,setMessage]=useState('')
  return <PracticeContext.Provider value={target?{...target,onError:setMessage}:null}>{children}{message&&<p role="status" className="feedback error">{message}</p>}</PracticeContext.Provider>
}

export function usePracticeRecorder() {
  const target = useContext(PracticeContext)
  return (correct: boolean | null, completed: boolean) => {
    if (!target?.releaseId || !db) return
    Promise.resolve(db.rpc('record_release_practice', {
      rid: target.releaseId, eid: target.exerciseId, was_correct: correct, is_completed: completed,
    }).setHeader('x-workspace-id',getRequestWorkspace()||'')).then(({error})=>target.onError?.(error?`Progresso non salvato: ${errorMessage(error)}`:''))
  }
}
