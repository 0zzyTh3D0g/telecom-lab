import { createContext, useContext } from 'react'
import type { AcademicLevel, TrackLevel, AcademicYear, Group, Profile, StaffRole, Subject, Track, Workspace } from './client'

export type ContextSelection={yearId:string;trackId?:string;subjectId:string;groupId:string}
export const WorkspaceContext = createContext<{ profile: Profile | null; subjects: Subject[]; workspace: Workspace | null; years:AcademicYear[];tracks:Track[];levels:AcademicLevel[];trackLevels:TrackLevel[];groups:Group[];selection:ContextSelection;selectContext:(value:ContextSelection)=>void }>({ profile:null,subjects:[],workspace:null,years:[],tracks:[],levels:[],trackLevels:[],groups:[],selection:{yearId:'',trackId:'',subjectId:'',groupId:''},selectContext:()=>{} })
export const useWorkspace = () => useContext(WorkspaceContext)
export const canManage = (role?: StaffRole) => role === 'owner' || role === 'manager'
export const canAuthor = (role?: StaffRole) => canManage(role) || role === 'editor'
export const canReview = (role?: StaffRole) => canManage(role) || role === 'reviewer'
export const isStaff = (role?: StaffRole) => Boolean(role && role !== 'member')
export const roleLabel: Record<StaffRole,string> = { owner:'Owner',manager:'Manager',editor:'Editor',reviewer:'Reviewer',member:'Member' }
export const dataChanged = () => window.dispatchEvent(new Event('telecom:data-changed'))
