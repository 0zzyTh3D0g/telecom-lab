export type PdfPageText={page_number:number;page_text:string}
export type Extraction={filename:string;size:number;pages:PdfPageText[]}

export async function extractLocalPdf(file:File):Promise<Extraction> {
 if(file.size>20_000_000)throw new Error('PDF troppo grande. Limite locale: 20 MB.')
 const pdfjs=await import('pdfjs-dist'),worker=await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
 pdfjs.GlobalWorkerOptions.workerSrc=worker.default
 const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:true})
 try {
 const doc=await task.promise;if(doc.numPages>300)throw new Error('PDF con più di 300 pagine: dividi il documento prima di importarlo.')
 const pages:PdfPageText[]=[];let total=0
 for(let n=1;n<=doc.numPages;n++) {
 const page=await doc.getPage(n),content=await page.getTextContent()
 const text=content.items.map(item=>'str' in item?item.str+('hasEOL' in item&&item.hasEOL?'\n':' '):'').join('').trim()
 total+=text.length;if(total>2_000_000)throw new Error('Testo estratto troppo grande: usa un PDF con meno pagine.')
 pages.push({page_number:n,page_text:text});page.cleanup()
 }
 return {filename:file.name,size:file.size,pages}
 }finally{await task.destroy()}
}

