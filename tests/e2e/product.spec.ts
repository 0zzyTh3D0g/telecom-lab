import { expect, test } from '@playwright/test'
import { mockWorkspace } from './product-fixture'

test('P3 product surfaces: responsive layout, navigation and reduced motion',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  const {contents,assignment}=await mockWorkspace(page)
  await page.setViewportSize({width:1440,height:1000})
  await page.goto('/#/')
  await expect(page.locator('.subject-card')).toHaveCount(2)
  await page.screenshot({path:'test-results/p3-home-desktop.png',fullPage:true})
  const routes=[['/','La teoria prende'],['/search','Ricerca contenuti'],[`/lesson/${contents[0].slug}`,contents[0].title],[`/assignment/${assignment.id}`,assignment.title],['/prompt','Genera istruzioni'],['/import','Importa contenuto'],['/about','Progettare con intenzione.']]
  for(const [route,title] of routes){
    await page.goto(`/#${route}`)
    await expect(page.getByRole('heading',{name:new RegExp(title)}).first()).toBeVisible()
    if(route.startsWith('/lesson/')){
      await expect(page.locator('.simulation-shell')).toBeVisible()
      await expect(page.locator('.plot-block')).toBeVisible()
      await expect(page.locator('.katex-error')).toHaveCount(0)
    }
    for(const width of [320,375,768,1024,1440]){
      await page.setViewportSize({width,height:900})
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),{message:`Overflow ${route} at ${width}px`}).toBe(true)
    }
    if(route.startsWith('/lesson/'))await page.screenshot({path:'test-results/p3-lesson.png',fullPage:true})
  }
  await page.goto('/#/manage')
  for(const tab of ['Dashboard','Contenuti','Materie','Struttura','Compiti','Utenti','Gruppi','Attività','Correzioni','Staff','Impostazioni']){
    await page.getByRole('button',{name:tab,exact:true}).click()
    if(tab==='Contenuti'){await page.locator('.access-tree select').selectOption({label:'Gruppo laboratorio'});await page.locator('.access-module>summary').first().click()}
    if(tab==='Attività'){await page.getByLabel('Seleziona contenuto').selectOption({label:contents[0].title});await expect(page.locator('.activity-table tbody tr')).toHaveCount(2)}
    if(tab==='Correzioni')await expect(page.locator('.review-card')).toHaveCount(1)
    for(const width of [320,375,768,1024,1440]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),{message:`Overflow management ${tab} ${width}`}).toBe(true)}
    if(['Contenuti','Attività','Correzioni','Staff'].includes(tab)){await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo({top:0,behavior:'instant'})});await page.screenshot({path:`test-results/p3-${tab.toLowerCase()}.png`,fullPage:true})}
  }
  await page.goto('/#/about');await page.screenshot({path:'test-results/p3-brand.png',fullPage:true})
  await page.setViewportSize({width:375,height:900});await page.goto('/#/');await expect(page.locator('.subject-card')).toHaveCount(2)
  await page.screenshot({path:'test-results/p3-home-mobile.png',fullPage:true})
  const menu=page.getByRole('button',{name:'Apri navigazione'});await menu.click();await expect(page.locator('.sidebar-wrap')).toHaveClass(/open/)
  await page.keyboard.press('Escape');await expect(menu).toBeFocused()
  await page.emulateMedia({reducedMotion:'reduce'})
  expect(await page.locator('.route-enter').evaluate(e=>getComputedStyle(e).animationName)).toBe('none')
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Tema: light. Cambia tema'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.screenshot({path:'test-results/p3-home-dark.png',fullPage:true})
  expect(errors).toEqual([])
})

test('brand kit renders all standalone vector variants',async({page})=>{
  await page.setViewportSize({width:1440,height:1050})
  await page.goto('/brand/index.html')
  await expect(page.locator('.sample img')).toHaveCount(9)
  expect(await page.locator('.sample img').evaluateAll(images=>images.every(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0))).toBe(true)
  await page.screenshot({path:'test-results/p3-brand-board.png',fullPage:true})
})

test('reviewer sees the review workflow and editor sees authoring tools',async({browser})=>{
  for(const role of ['reviewer','editor']){
    const context=await browser.newContext();const page=await context.newPage();await mockWorkspace(page,role)
    await page.goto('/#/manage');await expect(page.getByRole('heading',{name:'Area gestione'})).toBeVisible()
    await expect(page.getByRole('button',{name:'Staff',exact:true})).toHaveCount(0)
    await expect(page.getByRole('button',{name:'Utenti',exact:true})).toHaveCount(0)
    if(role==='reviewer'){await expect(page.locator('.review-card')).toHaveCount(1);await expect(page.getByRole('button',{name:'Contenuti',exact:true})).toHaveCount(0)}
    else{await expect(page.getByRole('button',{name:'Contenuti',exact:true})).toBeVisible();await expect(page.locator('.access-tree')).toHaveCount(0)}
    await context.close()
  }
})
