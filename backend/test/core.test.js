import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createApp} from '../src/app.js';
import {filters,money,isoDate,invoiceData,paymentData} from '../src/validation.js';
import {readUpload,normalizeRows,mappingFor} from '../src/imports.js';
import {csvBuffer,excelBuffer,pdfBuffer,safeCell} from '../src/exports.js';
const id='00000000-0000-4000-8000-000000000001';
test('Financial input rejects fractions of a cent, negatives, unsafe values and invalid dates',()=>{
 assert.equal(money('1,500.20',{positive:true}),'1500.20');assert.equal(money('0001.2'),'1.20');
 for(const v of ['0','-10','0.001','1000000000000','NaN','1e6'])assert.throws(()=>money(v,{positive:true}));
 for(const d of ['2026-02-30','01/02/2026','2026-2-01'])assert.throws(()=>isoDate(d));
 assert.throws(()=>invoiceData({customer_id:id,amount:'10',invoice_date:'2026-01-05',due_date:'2026-01-01'}));
 assert.throws(()=>paymentData({amount:'10',payment_date:'2026-01-01',method:'invalid',idempotency_key:id}));
});
test('Combined filters validate ranges and reject unsupported parameters',()=>{
 const f=filters({search:'Acme',payment_status:'partial',due_status:'overdue',amount_min:'50',amount_max:'100',date_from:'2026-01-01',date_to:'2026-02-01'});assert.equal(f.amount_min,'50.00');assert.equal(f.due_status,'overdue');
 assert.throws(()=>filters({amount_min:'100',amount_max:'50'}));assert.throws(()=>filters({date_from:'2026-02-01',date_to:'2026-01-01'}));assert.throws(()=>filters({limit:'999999'}));
 assert.throws(()=>filters({due_status:'bad'}));assert.throws(()=>filters({customer_id:'x'}));
});
test('CSV imports preserve source invoice numbers and mapped columns',async()=>{
 const file={originalname:'input.csv',buffer:Buffer.from('Name,Invoice Number,Date,Due Date,Amount\nAcme,00001,2026-01-01,2026-02-01,"1,000.00"\n')};
 const parsed=await readUpload(file);const normalized=normalizeRows(parsed,mappingFor(parsed.columns));assert.equal(normalized[0].invoice_number,'00001');assert.equal(normalized[0].amount,'1000.00');
 await assert.rejects(readUpload({originalname:'bad.csv',buffer:Buffer.from('Name,Name\na,b')}),/unique/);
 await assert.rejects(readUpload({originalname:'bad.csv',buffer:Buffer.from('Name,Amount\na,1,2')}),/CSV/);
});
test('Excel imports read typed dates and reject unevaluated formulas',async()=>{
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Invoices');sheet.addRow(['customer_name','invoice_number','invoice_date','due_date','amount']);sheet.addRow(['Acme','00001',new Date('2026-01-01'),new Date('2026-02-01'),100]);
 const parsed=await readUpload({originalname:'input.xlsx',buffer:Buffer.from(await book.xlsx.writeBuffer())});assert.equal(parsed.records[0].invoice_date,'2026-01-01');assert.equal(parsed.records[0].invoice_number,'00001');
 sheet.getCell('E2').value={formula:'50+50',result:100};await assert.rejects(readUpload({originalname:'formula.xlsx',buffer:Buffer.from(await book.xlsx.writeBuffer())}),/Replace spreadsheet formulas/);
});
const report={id,kind:'invoices',created_at:'2026-10-01T12:00:00Z',as_of_date:'2026-10-01',filters:{customer_id:id,payment_status:'partial',due_status:'overdue'},summary:{count:1,invoiced:100,collected:30,outstanding:70},rows:[{internal_number:'INV-10-2026-00001',external_number:'ORIGINAL-001',customer_name:'=HYPERLINK("bad")',customer_code:'ACME',invoice_date:'2026-01-01',due_date:'2026-01-10',amount:100,paid_amount:30,balance:70,payment_status:'partial',due_status:'overdue',overdue_days:200,operation_status:'open'}]};
test('CSV and Excel exports use snapshot rows and include exact applied criteria',async()=>{
 const csv=csvBuffer(report).toString();assert(csv.includes('ORIGINAL-001'));assert(csv.includes('customer_id'));assert(csv.includes('partial'));assert(csv.includes('70'));assert(csv.includes("'=HYPERLINK"));
 const book=new ExcelJS.Workbook();await book.xlsx.load(await excelBuffer(report));assert.equal(book.getWorksheet('Report').rowCount,2);assert.equal(book.getWorksheet('Report').getCell('I2').value,70);assert.equal(book.getWorksheet('Parameters').getCell('B2').value,'KES');assert.equal(book.getWorksheet('Report').getCell('D2').type,ExcelJS.ValueType.String);
 assert.equal(safeCell('@SUM(1)'),"'@SUM(1)");
});
test('PDF exports produce complete downloadable documents',async()=>{const bytes=await pdfBuffer(report);assert.equal(bytes.subarray(0,4).toString(),'%PDF');assert(bytes.length>1000);});
test('API rejects missing authentication and does not expose privileged keys',async()=>{
 const app=createApp({supabaseUrl:'https://test.supabase.co',supabaseKey:'public-key',allowedOrigins:[]});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}`;
 try{const res=await fetch(`${url}/api/dashboard`);assert.equal(res.status,401);assert.equal((await res.json()).error,'Sign in to continue');const cfg=await fetch(`${url}/api/config`);assert.equal((await cfg.json()).supabaseKey,'public-key');const health=await fetch(`${url}/health`);assert.equal(health.status,200);assert(!health.headers.has('x-powered-by'));}finally{await new Promise(r=>server.close(r));}
});

function fakeClient(role='owner',calls=[]){
 return ()=>({auth:{getUser:async()=>({data:{user:{id,email:'staff@test.invalid'}}})},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:role?{role,mc_organizations:{currency:'KES'}}:null})}),rpc:async(name,args)=>{calls.push({name,args});return {data:name==='mc_get_report'?report:name==='mc_preview_import'?{id,preview:[]}:{id,rows:[],summary:{count:0}}};}});
}
async function withServer(role,fn){const calls=[];const app=createApp({supabaseUrl:'https://test.supabase.co',supabaseKey:'public-key',allowedOrigins:[]},{clientFactory:fakeClient(role,calls)});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{return await fn(`http://127.0.0.1:${server.address().port}`,calls);}finally{await new Promise(r=>server.close(r));}}
const authHeaders={Authorization:'Bearer valid-test-token','X-Organization-Id':id};
test('API enforces viewer and inactive membership restrictions',async()=>{
 await withServer('viewer',async(url,calls)=>{const r=await fetch(`${url}/api/customers`,{method:'POST',headers:{...authHeaders,'Content-Type':'application/json'},body:JSON.stringify({name:'Forbidden'})});assert.equal(r.status,403);assert.equal(calls.length,0);});
 await withServer(null,async url=>{const r=await fetch(`${url}/api/dashboard`,{headers:authHeaders});assert.equal(r.status,403);});
});
test('API report application and downloads carry the exact authorized snapshot',async()=>{
 await withServer('owner',async(url,calls)=>{
 const selected={customer_id:id,payment_status:'partial',due_status:'overdue',amount_min:'50',amount_max:'100'};
 const applied=await fetch(`${url}/api/reports/apply`,{method:'POST',headers:{...authHeaders,'Content-Type':'application/json'},body:JSON.stringify({kind:'invoices',filters:selected})});assert.equal(applied.status,200);assert.deepEqual(calls[0],{name:'mc_apply_report',args:{p_org:id,p_kind:'invoices',p_filters:{...selected,amount_min:'50.00',amount_max:'100.00'}}});
 const downloaded=await fetch(`${url}/api/reports/${id}/export?format=csv`,{headers:authHeaders});assert.equal(downloaded.status,200);assert((await downloaded.text()).includes('ORIGINAL-001'));assert.deepEqual(calls[1],{name:'mc_get_report',args:{p_org:id,p_report:id,p_export:true}});
 const invalid=await fetch(`${url}/api/reports/apply`,{method:'POST',headers:{...authHeaders,'Content-Type':'application/json'},body:JSON.stringify({kind:'invoices',filters:{amount_min:100,amount_max:1}})});assert.equal(invalid.status,400);assert.equal(calls.length,2);
 });
});
test('Multipart imports validate, map and send canonical rows to the database',async()=>{
 await withServer('collector',async(url,calls)=>{
 const csv='Name,Invoice Number,Date,Due Date,Amount\nAcme,00001,2026-01-01,2026-02-01,100.00\n';
 const inspect=new FormData();inspect.append('file',new Blob([csv],{type:'text/csv'}),'invoice.csv');const r=await fetch(`${url}/api/imports/inspect`,{method:'POST',headers:authHeaders,body:inspect});assert.equal(r.status,200);const parsed=await r.json();assert.equal(parsed.mapping.invoice_number,'Invoice Number');
 const preview=new FormData();preview.append('file',new Blob([csv],{type:'text/csv'}),'invoice.csv');preview.append('mapping',JSON.stringify(parsed.mapping));const p=await fetch(`${url}/api/imports/preview`,{method:'POST',headers:authHeaders,body:preview});assert.equal(p.status,200);assert.equal(calls[0].name,'mc_preview_import');assert.equal(calls[0].args.p_rows[0].invoice_number,'00001');assert.equal(calls[0].args.p_rows[0].amount,'100.00');
 });
});

test('Overview API validates combined filters and passes authorized cohort criteria',async()=>{
 await withServer('viewer',async(url,calls)=>{
 const criteria={customer_id:id,date_from:'2026-01-01',date_to:'2026-03-31',amount_min:'50',due_status:'overdue'};
 const result=await fetch(`${url}/api/dashboard`,{method:'POST',headers:{...authHeaders,'Content-Type':'application/json'},body:JSON.stringify({filters:criteria})});assert.equal(result.status,200);
 assert.deepEqual(calls[0],{name:'mc_dashboard_filtered',args:{p_org:id,p_filters:{...criteria,amount_min:'50.00'}}});
 const bad=await fetch(`${url}/api/dashboard`,{method:'POST',headers:{...authHeaders,'Content-Type':'application/json'},body:JSON.stringify({filters:{amount_min:'10',amount_max:'1'}})});assert.equal(bad.status,400);assert.equal(calls.length,1);
 });
});
