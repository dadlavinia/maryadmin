import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
let db;
const U={owner:'00000000-0000-4000-8000-000000000001',collector:'00000000-0000-4000-8000-000000000002',viewer:'00000000-0000-4000-8000-000000000003',other:'00000000-0000-4000-8000-000000000004',admin:'00000000-0000-4000-8000-000000000005',inactive:'00000000-0000-4000-8000-000000000006',new:'00000000-0000-4000-8000-000000000007'};
let org,org2,customer,invoice,paid,report;
const rpc=async(user,name,args)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[U[user]]);const placeholders=args.map((_,i)=>`$${i+1}`).join(',');return (await tx.query(`select public.${name}(${placeholders}) result`,args)).rows[0].result;});
const data={invoice_date:'2026-01-01',due_date:'2026-01-10',amount:'100.00',external_number:'ACME-001',notes:'Original note'};
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 await db.exec(await fs.readFile(new URL('../database/001_schema.sql',import.meta.url),'utf8'));
 await db.exec(await fs.readFile(new URL('../database/004_filtered_overview.sql',import.meta.url),'utf8'));
 for(const [k,id]of Object.entries(U))await db.query('insert into auth.users values($1,$2)',[id,`${k}@test.invalid`]);
 org=(await db.query("insert into public.mc_organizations(name) values('Test') returning id")).rows[0].id;
 org2=(await db.query("insert into public.mc_organizations(name) values('Other') returning id")).rows[0].id;
 for(const k of ['owner','collector','viewer','admin','inactive'])await db.query('insert into public.mc_members values($1,$2,$3,$4)',[org,U[k],k==='inactive'?'collector':k,k!=='inactive']);
 await db.query("insert into public.mc_members values($1,$2,'owner',true)",[org2,U.other]);
});
after(async()=>{await db.close();});
test('Schema, indexes and grants deny anonymous access and direct writes',async()=>{
 const rows=(await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and relname like 'mc_%'")).rows;assert.equal(rows.length,9);assert(rows.every(r=>r.relrowsecurity));
 for(const r of rows){const privileges=(await db.query("select has_table_privilege('anon',$1,'select') anon,has_table_privilege('authenticated',$1,'insert,update,delete') write",[`public.${r.relname}`])).rows[0];assert.equal(privileges.anon,false);assert.equal(privileges.write,false);}
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.exec('select * from public.mc_invoices');}),/permission denied/);
 const privateGrant=(await db.query("select has_function_privilege('authenticated','mc_private.mc_next_number(uuid)','EXECUTE') ok")).rows[0].ok;assert.equal(privateGrant,false);
});
test('Manual customer and invoice creation generate annual series with current Nairobi month',async()=>{
 customer=await rpc('owner','mc_save_customer',[org,{name:'Acme',customer_code:'ACME',email:'test@invalid'}]);
 invoice=await rpc('owner','mc_save_invoice',[org,{...data,customer_id:customer.id,request_id:'20000000-0000-4000-8000-000000000001'}]);
 const now=(await db.query("select to_char(mc_private.mc_today(),'MM-YYYY') period")).rows[0].period;
 assert.equal(invoice.internal_number,`INV-${now}-00001`);
 const repeated=await rpc('owner','mc_save_invoice',[org,{...data,customer_id:customer.id,request_id:'20000000-0000-4000-8000-000000000001'}]);assert.equal(repeated.id,invoice.id);
 const generated=(await db.query('select last_serial from public.mc_invoice_counters where org_id=$1',[org])).rows[0].last_serial;assert.equal(generated,1);
});
test('Invoice numbers are unique per customer and originals remain searchable',async()=>{
 await assert.rejects(rpc('owner','mc_save_invoice',[org,{...data,customer_id:customer.id}]),/unique constraint/);
 const c=await rpc('owner','mc_save_customer',[org,{name:'Different customer',customer_code:'OTHER'}]);
 const i=await rpc('owner','mc_save_invoice',[org,{...data,customer_id:c.id}]);assert.notEqual(i.internal_number,invoice.internal_number);
 const result=await rpc('viewer','mc_query_invoices',[org,{search:'ACME-001'}]);assert.equal(result.rows.length,2);
});
test('Partial payments are atomic, idempotent and remain overdue',async()=>{
 paid=await rpc('collector','mc_record_payment',[org,invoice.id,{amount:'30.00',payment_date:'2026-01-02',method:'mpesa',reference:'REF',idempotency_key:'10000000-0000-4000-8000-000000000001'}]);
 const repeated=await rpc('collector','mc_record_payment',[org,invoice.id,{amount:'30.00',payment_date:'2026-01-02',method:'mpesa',reference:'REF',idempotency_key:'10000000-0000-4000-8000-000000000001'}]);assert.equal(repeated.id,paid.id);
 const r=await rpc('owner','mc_query_invoices',[org,{customer_id:customer.id}]);assert.equal(r.rows[0].paid_amount,30);assert.equal(r.rows[0].balance,70);assert.equal(r.rows[0].payment_status,'partial');assert.equal(r.rows[0].due_status,'overdue');
 await assert.rejects(rpc('owner','mc_record_payment',[org,invoice.id,{amount:'71.00',payment_date:'2026-01-02',method:'cash',idempotency_key:'10000000-0000-4000-8000-000000000002'}]),/outstanding balance/);
 await assert.rejects(rpc('owner','mc_record_payment',[org,invoice.id,{amount:'30.001',payment_date:'2026-01-02',method:'cash',idempotency_key:'10000000-0000-4000-8000-000000000002'}]),/outstanding balance/);
});
test('Stale edits and reductions below collections are rejected',async()=>{
 await assert.rejects(rpc('owner','mc_save_invoice',[org,{...data,customer_id:customer.id},invoice.id,1]),/Record changed/);
 await assert.rejects(rpc('owner','mc_save_invoice',[org,{...data,customer_id:customer.id,amount:'20.00'},invoice.id,2]),/lower than collections/);
});
test('Combined filters and snapshots freeze exact results and parameters',async()=>{
 const filters={customer_id:customer.id,payment_status:'partial',due_status:'overdue',amount_min:'90.00',amount_max:'110.00',date_from:'2026-01-01',date_to:'2026-01-31'};
 report=await rpc('viewer','mc_apply_report',[org,'invoices',filters]);assert.equal(report.rows.length,1);assert.equal(report.rows[0].id,invoice.id);assert.equal(report.summary.outstanding,70);assert.deepEqual(report.filters,filters);
 await rpc('collector','mc_record_payment',[org,invoice.id,{amount:'70.00',payment_date:'2026-01-03',method:'bank',idempotency_key:'10000000-0000-4000-8000-000000000003'}]);
 const frozen=await rpc('viewer','mc_get_report',[org,report.id,true]);assert.equal(frozen.rows[0].balance,70);
 const live=await rpc('owner','mc_query_invoices',[org,{customer_id:customer.id}]);assert.equal(live.rows[0].payment_status,'paid');assert.equal(live.rows[0].due_status,'settled');assert.equal(live.rows[0].balance,0);
 await assert.rejects(rpc('owner','mc_get_report',[org,report.id]),/expired or unavailable/);
});
test('Role and organization boundaries hold for RPCs and direct RLS reads',async()=>{
 await assert.rejects(rpc('viewer','mc_save_customer',[org,{name:'Forbidden'}]),/Access denied/);
 await assert.rejects(rpc('other','mc_query_invoices',[org,{}]),/Access denied/);
 await assert.rejects(rpc('inactive','mc_query_invoices',[org,{}]),/Access denied/);
 await assert.rejects(rpc('collector','mc_reverse_payment',[org,paid.id,'Wrong reference']),/Access denied/);
 const result=await db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[U.other]);return tx.query('select * from public.mc_invoice_register');});assert.equal(result.rows.length,0);
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[U.owner]);return tx.exec('update public.mc_invoices set paid_amount=0');}),/permission denied/);
});
test('Reversal restores balance and preserves the payment and audit trail',async()=>{
 await rpc('admin','mc_reverse_payment',[org,paid.id,'Incorrect reference']);
 const r=await rpc('owner','mc_query_invoices',[org,{customer_id:customer.id}]);assert.equal(r.rows[0].paid_amount,70);assert.equal(r.rows[0].balance,30);
 await assert.rejects(rpc('admin','mc_reverse_payment',[org,paid.id,'Again']),/already reversed/);
 const history=await rpc('owner','mc_apply_report',[org,'history',{customer_id:customer.id,action:'payment_reversed'}]);assert.equal(history.rows.length,1);assert.equal(history.rows[0].after_data.reversal_reason,'Incorrect reference');
});
const rows=()=>[{customer_name:'Imported',customer_code:'IMP',invoice_number:'FILE-1',invoice_date:'2026-02-01',due_date:'2026-02-28',amount:'250.00'},{customer_name:'Imported',customer_code:'IMP',invoice_number:'FILE-2',invoice_date:'2026-02-01',due_date:'2026-02-28',amount:'500.00'}];
test('Imports append to the same register and re-imports update without resetting payments',async()=>{
 const batch=await rpc('collector','mc_preview_import',[org,'invoices.csv',rows()]);assert.equal(batch.preview.length,2);assert(batch.preview.every(x=>x.errors.length===0));
 const result=await rpc('collector','mc_commit_import',[org,batch.id]);assert.equal(result.inserted,2);assert.equal(result.updated,0);
 assert.deepEqual(await rpc('collector','mc_commit_import',[org,batch.id]),result);
 const inv=(await rpc('owner','mc_query_invoices',[org,{search:'FILE-1'}])).rows[0];
 await rpc('owner','mc_record_payment',[org,inv.id,{amount:'50.00',payment_date:'2026-02-02',method:'cash',idempotency_key:'10000000-0000-4000-8000-000000000004'}]);
 const next=await rpc('collector','mc_preview_import',[org,'again.csv',[{...rows()[0],amount:'300.00'}]]);const update=await rpc('collector','mc_commit_import',[org,next.id]);assert.equal(update.updated,1);
 const after=(await rpc('owner','mc_query_invoices',[org,{search:'FILE-1'}])).rows[0];assert.equal(after.id,inv.id);assert.equal(after.internal_number,inv.internal_number);assert.equal(after.paid_amount,50);assert.equal(after.balance,250);
});
test('Invalid and duplicate rows block the entire import without partial inserts',async()=>{
 const source=[rows()[0],{...rows()[0]}, {...rows()[1],invoice_number:'INVALID',amount:'-1',due_date:'2026-02-30'}];
 const b=await rpc('owner','mc_preview_import',[org,'bad.csv',source]);assert(b.preview[1].errors.includes('Duplicate invoice in this file'));assert(b.preview[2].errors.length>=2);
 const before=(await rpc('owner','mc_query_invoices',[org,{}])).summary.count;
 await assert.rejects(rpc('owner','mc_commit_import',[org,b.id]),/Correct rejected rows/);
 assert.equal((await rpc('owner','mc_query_invoices',[org,{}])).summary.count,before);
 const inconsistent=await rpc('owner','mc_preview_import',[org,'bad-names.csv',[{...rows()[0],customer_code:'NEW',customer_name:'One'},{...rows()[1],customer_code:'NEW',customer_name:'Two'}]]);assert(inconsistent.preview[1].errors.length>0);
});
test('A stale import preview cannot overwrite an intervening edit or collection',async()=>{
 const b=await rpc('owner','mc_preview_import',[org,'stale.csv',[rows()[0]]]);const inv=(await rpc('owner','mc_query_invoices',[org,{search:'FILE-1'}])).rows[0];
 await rpc('owner','mc_save_invoice',[org,{...inv,notes:'Edited'},inv.id,inv.version]);
 await assert.rejects(rpc('owner','mc_commit_import',[org,b.id]),/changed since preview/);
});
test('Team access cannot be self-escalated and admin roles are owner-controlled',async()=>{
 await assert.rejects(rpc('collector','mc_save_member',[org,'new@test.invalid','admin',true]),/Access denied/);
 await assert.rejects(rpc('admin','mc_save_member',[org,'new@test.invalid','admin',true]),/Only the owner/);
 const m=await rpc('owner','mc_save_member',[org,'new@test.invalid','viewer',true]);assert.equal(m.role,'viewer');
 await assert.rejects(rpc('owner','mc_save_member',[org,'owner@test.invalid','viewer',false]),/own access/);
});
test('Concurrent requests allocate distinct numbers and cannot over-collect',async()=>{
 const made=await Promise.all([rpc('owner','mc_save_invoice',[org,{...data,external_number:'CONCURRENT-1',customer_id:customer.id}]),rpc('owner','mc_save_invoice',[org,{...data,external_number:'CONCURRENT-2',customer_id:customer.id}])]);
 assert.notEqual(made[0].internal_number,made[1].internal_number);
 const results=await Promise.allSettled([rpc('collector','mc_record_payment',[org,made[0].id,{amount:'60.00',payment_date:'2026-01-02',method:'cash',idempotency_key:'10000000-0000-4000-8000-000000000090'}]),rpc('collector','mc_record_payment',[org,made[0].id,{amount:'60.00',payment_date:'2026-01-02',method:'cash',idempotency_key:'10000000-0000-4000-8000-000000000091'}])]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const after=(await rpc('owner','mc_query_invoices',[org,{search:'CONCURRENT-1'}])).rows[0];assert.equal(after.paid_amount,60);assert.equal(after.balance,40);
});
test('Annual serial caps at 10,000 without wrapping',async()=>{
 await db.query('update public.mc_invoice_counters set last_serial=9999 where org_id=$1',[org]);
 const last=await rpc('owner','mc_save_invoice',[org,{...data,external_number:'LAST',customer_id:customer.id}]);assert(last.internal_number.endsWith('-10000'));
 await assert.rejects(rpc('owner','mc_save_invoice',[org,{...data,external_number:'OVER-LIMIT',customer_id:customer.id}]),/check constraint/);
 assert.equal((await db.query('select last_serial from public.mc_invoice_counters where org_id=$1',[org])).rows[0].last_serial,10000);
});
test('Payment report and dashboard reconcile exactly to the active ledger',async()=>{
 const p=await rpc('owner','mc_apply_report',[org,'payments',{customer_id:customer.id,reversal_status:'active',event_from:'2026-01-01',event_to:'2026-01-31'}]);assert.equal(p.rows.length,2);assert.equal(p.summary.collected,130);assert.deepEqual(p.rows.map(row=>Number(row.amount)).sort((a,b)=>a-b),[60,70]);
 const dashboard=await rpc('owner','mc_dashboard',[org]);const sum=(await db.query('select sum(amount) total from public.mc_payments where org_id=$1 and reversed_at is null',[org])).rows[0].total;assert.equal(dashboard.summary.collected,Number(sum));assert.equal(dashboard.monthly.length,6);
 const mismatch=(await db.query('select i.id from public.mc_invoices i left join public.mc_payments p on p.invoice_id=i.id where i.org_id=$1 group by i.id having i.paid_amount<>coalesce(sum(p.amount) filter(where p.reversed_at is null),0)',[org])).rows;assert.equal(mismatch.length,0);
});

test('Filtered overview reconciles every visual to the same selected invoice cohort',async()=>{
 const filters={customer_id:customer.id,due_status:'overdue',amount_min:'90.00',amount_max:'110.00',date_from:'2026-01-01',date_to:'2026-01-31'};
 const result=await rpc('viewer','mc_dashboard_filtered',[org,filters]);
 const selected=(await rpc('viewer','mc_apply_report',[org,'invoices',filters])).rows;
 assert.deepEqual(result.filters,filters);assert.equal(result.summary.count,selected.length);
 assert.equal(result.summary.invoiced,selected.reduce((s,r)=>s+r.amount,0));
 assert.equal(result.summary.collected,selected.reduce((s,r)=>s+r.paid_amount,0));
 assert.equal(result.aging.reduce((s,r)=>s+r.amount,0),result.summary.outstanding);
 assert.equal(result.payment_mix.reduce((s,r)=>s+r.invoices,0),selected.length);
 assert.equal(result.top_customers.length,1);assert.equal(result.top_customers[0].customer_id,customer.id);
 assert.equal(result.top_customers[0].outstanding,result.summary.outstanding);
 assert(result.overdue_rows.every(r=>r.customer_id===customer.id&&r.due_status==='overdue'));
 assert.equal(result.monthly.length,1);assert.equal(result.monthly[0].period,'2026-01');
 assert.equal(result.monthly[0].invoiced,result.summary.invoiced);assert.equal(result.monthly[0].collected,result.summary.collected);
});
test('Overview empty filters, date boundaries and organization permissions are correct',async()=>{
 const empty=await rpc('viewer','mc_dashboard_filtered',[org,{search:'no-such-invoice'}]);
 assert.equal(empty.summary.count,0);assert.equal(empty.summary.outstanding,0);assert.equal(empty.aging.length,6);
 assert.equal(empty.payment_mix.length,3);assert.equal(empty.top_customers.length,0);assert.equal(empty.overdue_rows.length,0);
 const all=await rpc('owner','mc_dashboard_filtered',[org,{}]);const legacy=await rpc('owner','mc_dashboard',[org]);assert.deepEqual(all.summary,legacy.summary);
 const future=await rpc('owner','mc_dashboard_filtered',[org,{date_from:'2027-02-01'}]);assert.equal(future.monthly[0].period,'2027-02');
 const end=await rpc('owner','mc_dashboard_filtered',[org,{date_to:'2026-01-31'}]);assert.equal(end.monthly.at(-1).period,'2026-01');assert.equal(end.monthly.length,6);
 await assert.rejects(rpc('other','mc_dashboard_filtered',[org,{}]),/Access denied/);
 await assert.rejects(rpc('inactive','mc_dashboard_filtered',[org,{}]),/Access denied/);
 assert.equal((await db.query("select has_function_privilege('anon','public.mc_dashboard_filtered(uuid,jsonb)','EXECUTE') ok")).rows[0].ok,false);
});
