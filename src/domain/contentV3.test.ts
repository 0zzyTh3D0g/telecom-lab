import { expect,it } from 'vitest'
import { migrateV1,migrateV2,lessonSchema } from './schema'
import { validateLesson } from './validate'
import { nextLevel } from '../backend/lifecycle'
const old={schemaVersion:1,id:'a',slug:'a',title:'A',summary:'B',year:4,module:'M',topic:'T',tags:['a'],order:0,blocks:[{type:'paragraph',text:'Appunti'}]}
it('migrates v1 through v2 to portable v3 preserving blocks, keys and warnings',()=>{
 const first=migrateV1(old);expect(first.success).toBe(true);if(!first.success)return
 const second=migrateV2({...first.data,generationWarnings:['Verificare'],assignments:[{id:'a1',title:'Compito',questions:[{id:'q1',type:'trueFalse',prompt:'Vero?',difficulty:'base'}],privateKeys:{q1:{answer:true,rubric:'Spiegazione'}}}]})
 expect(second.success).toBe(true);if(!second.success)return
 expect(second.data.levelCode).toBe('4');expect(second.data.blocks).toEqual(first.data.blocks);expect(second.data.assignments[0].privateKeys.q1.rubric).toBe('Spiegazione');expect(second.data.generationWarnings).toEqual(['Verificare']);expect(second.data).not.toHaveProperty('year')
 expect(validateLesson(old).lesson?.schemaVersion).toBe(3)
})
it('supports configured labels and general resources without a numeric domain union',()=>{
 const migrated=validateLesson(old).lesson!;expect(lessonSchema.safeParse({...migrated,levelCode:'intermedio'}).success).toBe(true)
 const general={...migrated} as Record<string,unknown>;delete general.levelCode;expect(lessonSchema.safeParse(general).success).toBe(true)
 expect(nextLevel('L4',[{level_id:'Base',sort_order:2},{level_id:'L4',sort_order:4},{level_id:'L5',sort_order:9}])).toBe('L5');expect(nextLevel('L5',[{level_id:'L4',sort_order:4},{level_id:'L5',sort_order:9}])).toBeNull()
})
