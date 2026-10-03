import { useEffect, useState } from 'react'
import { db, errorMessage, type ContentItem } from './client'

export function useCatalog(workspaceId:string,subjectId:string,revision:number,ready:boolean) {
 const key=`${workspaceId}:${subjectId}:${revision}:${ready}`
 const [request,setRequest]=useState({key,page:0})
 const [result,setResult]=useState({key:'',page:-1,items:[] as ContentItem[],more:false,error:''})
 const page=request.key===key?request.page:0
 useEffect(()=>{
  if(!db||!ready)return
  let valid=true
  Promise.resolve(db.rpc('catalog_page',{page_number:page,subject_id_filter:subjectId||null}).setHeader('x-workspace-id',workspaceId)).then(({data,error:issue})=>{
   if(!valid)return
   const rows=(data||[]) as ContentItem[]
   setResult(old=>({key,page,items:issue?(old.key===key?old.items:[]):page===0?rows:[...(old.key===key?old.items:[]),...rows],more:!issue&&rows.length===100,error:issue?errorMessage(issue):''}))
  })
  return()=>{valid=false}
 },[key,workspaceId,subjectId,ready,page])
 const current=ready&&result.key===key,loading=ready&&(!current||result.page!==page)
 return {items:current?result.items:[],more:current&&result.more,loading,error:current?result.error:'',next:()=>{if(!loading)setRequest({key,page:page+1})}}
}
