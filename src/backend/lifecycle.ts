export type OrderedLevel={level_id:string;sort_order:number}
export function nextLevel(currentId:string,ordered:OrderedLevel[]):string|null {
 const list=[...ordered].sort((a,b)=>a.sort_order-b.sort_order),index=list.findIndex(l=>l.level_id===currentId)
 return index<0?null:list[index+1]?.level_id||null
}
