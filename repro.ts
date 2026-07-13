import './load-env'
process.env.DATABASE_URL = (process.env.DATABASE_URL||'').replace('schema=dev&search_path=dev,public','schema=public&search_path=public')
import { searchFacts } from './src/text-explorer/search'
import { plan } from './src/lib/planner'
import { clearHistory, clearDraft } from './src/lib/planner/history'
const SEP = '8207e690-2a68-4b49-8055-4305d249fcb4'
const PHONE='15550130001'
const user={phone:PHONE,name:'Sam',isAdmin:false,needsName:false,optedOut:false}
async function main(){
  clearHistory(PHONE);clearDraft(PHONE)
  // replay the exact screenshot conversation, threading history
  const msgs = [
    'when are alumni reunions',
    'fucj u give me the full info',
    'where are alumni reunions',
    'give me links',
    'yeah',
    'whats ur name',
    "bruh fuck u u didn't give me my links",
    "u didn't give me my links",
  ]
  let hist: string | null = null
  for (const m of msgs) {
    const r = await plan({ phone: PHONE, message: m, user, conversationHistoryJson: hist, sendAnnouncement: async()=>15, searchContent: async(q:string)=>searchFacts(q,8,SEP) })
    hist = r.newConversationHistoryJson
    console.log(`\nUSER: ${m}`)
    console.log(`BOT [${r.classification.action}]: ${r.response.replace(/\n/g,' | ')}`)
  }
}
main().catch(e=>console.error('FATAL',(e.message||'').substring(0,300)))
