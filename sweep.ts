import './load-env'
process.env.DATABASE_URL = (process.env.DATABASE_URL||'').replace('schema=dev&search_path=dev,public','schema=public&search_path=public')
import { searchFacts } from './src/text-explorer/search'
import { getPrisma } from './src/lib/prisma'
const SEP = '8207e690-2a68-4b49-8055-4305d249fcb4'
async function main(){
  const prisma = await getPrisma()
  const rows: any[] = await prisma.$queryRawUnsafe(`SELECT DISTINCT subcategory FROM public."Fact" WHERE subcategory IS NOT NULL AND length(subcategory) > 2`)
  console.log(`TOPICS: ${rows.length}`)
  let pass=0; const fails: string[] = []
  for (const { subcategory } of rows) {
    const r = await searchFacts(subcategory, 8, SEP)
    const hit = r.some(x => (x.title||'').toLowerCase() === subcategory.toLowerCase())
    if (hit) pass++
    else fails.push(`${subcategory} → got [${r.slice(0,3).map(x=>x.title).join('; ')}]`)
  }
  console.log(`PASS ${pass}/${rows.length}`)
  if (fails.length) { console.log('FAILS:'); fails.forEach(f=>console.log('  ✗ '+f)) }
}
main().catch(e=>console.error('FATAL',(e.message||'').substring(0,300)))
