const { PrismaClient } = require('@prisma/client');
async function test(url,label){
  const p = new PrismaClient({datasources:{db:{url}}});
  try {await p.$connect(); const r = await p.$queryRaw`select 1 as test`; console.log('OK', label, r);
  } catch(e){console.error('FAIL', label, e.message);} finally {await p.$disconnect().catch(()=>{});}
}
(async()=>{
  const direct = 'postgresql://postgres:Jarvis123%24jarviS@db.ypoqnmmgjjzctzgjnpkr.supabase.co:5432/postgres?sslmode=require';
  const poolerTenant = 'postgresql://postgres.ypoqnmmgjjzctzgjnpkr:Jarvis123%24jarviS@aws-0-us-west-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=1';
  const poolerPlain = 'postgresql://postgres:Jarvis123%24jarviS@aws-0-us-west-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=1';
  await test(direct, 'direct-5432');
  await test(poolerTenant, 'pooler-tenant');
  await test(poolerPlain, 'pooler-plain');
})();
