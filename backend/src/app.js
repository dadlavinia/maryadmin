import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import multer from 'multer';
import {createClient} from '@supabase/supabase-js';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {AppError,requireUuid,customerData,invoiceData,paymentData,filters,version,text} from './validation.js';
import {readUpload,mappingFor,normalizeRows,rejectedRows,fields} from './imports.js';
import {csvBuffer,excelBuffer,pdfBuffer,plainCsv} from './exports.js';
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:2}});
export function createApp(config,{clientFactory=createClient}={}) {
 const app=express();app.disable('x-powered-by');
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],fontSrc:["'self'"],imgSrc:["'self'","data:"],connectSrc:["'self'",...(config.supabaseUrl?[new URL(config.supabaseUrl).origin]:[])],objectSrc:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:config.production?[]:null}}}));
 const allowed=config.allowedOrigins||[];
 app.use(cors({origin:(origin,cb)=>cb(null,!origin||allowed.includes(origin)),allowedHeaders:['Authorization','Content-Type','X-Organization-Id'],methods:['GET','POST','PUT']}));
 app.use(express.json({limit:'256kb'}));
 app.use('/api',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 app.use('/api',rateLimit({windowMs:60*1000,limit:120,standardHeaders:'draft-8',legacyHeaders:false}));
 app.get('/health',(_req,res)=>res.json({status:'ok',service:'mary-collections-api',configured:!!config.supabaseUrl&&!!config.supabaseKey}));
 app.get('/api/config',(_req,res)=>res.json({supabaseUrl:config.supabaseUrl,supabaseKey:config.supabaseKey}));
 const rpc=async(req,name,args={})=>{const {data,error}=await req.db.rpc(name,{p_org:req.org,...args});if(error)throw dbError(error);return data;};
 function dbError(e){if(e.code==='42501')return new AppError('Access denied',403);if(e.code==='23505')return new AppError('This customer code or source invoice number already exists',409);if(e.code==='40001')return new AppError(e.message,409);if(e.code==='23514'&&e.message.includes('last_serial'))return new AppError('The annual invoice limit of 10,000 has been reached',409);return new AppError(e.message||'Database request failed',400);}
 const result=(data,error)=>{if(error)throw dbError(error);return data;};
 app.use('/api',async(req,_res,next)=>{
  if(!config.supabaseUrl||!config.supabaseKey)throw new AppError('Configure Supabase in backend/.env',503);
  const token=(req.get('authorization')||'').match(/^Bearer (.+)$/)?.[1];if(!token)throw new AppError('Sign in to continue',401);
  req.db=clientFactory(config.supabaseUrl,config.supabaseKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {data,error}=await req.db.auth.getUser(token);if(error||!data?.user)throw new AppError('Session expired. Sign in again',401);
  req.user=data.user;next();
 });
 app.get('/api/session',async(req,res)=>{
  const {data,error}=await req.db.from('mc_members').select('org_id,role,mc_organizations(id,name,currency)').eq('user_id',req.user.id).eq('active',true);
  res.json({user:{id:req.user.id,email:req.user.email},memberships:result(data,error)});
 });
 app.use('/api',async(req,_res,next)=>{
  req.org=requireUuid(req.get('x-organization-id'),'organization');const {data,error}=await req.db.from('mc_members').select('role,mc_organizations(currency,name)').eq('org_id',req.org).eq('user_id',req.user.id).eq('active',true).maybeSingle();
  if(error||!data)throw new AppError('Access denied',403);req.role=data.role;req.currency=data.mc_organizations.currency;next();
 });
 const canWrite=(req,_res,next)=>{if(!['owner','admin','collector'].includes(req.role))throw new AppError('Read-only access',403);next();};
 app.get('/api/dashboard',async(req,res)=>res.json(await rpc(req,'mc_dashboard')));
 app.post('/api/dashboard',async(req,res)=>res.json(await rpc(req,'mc_dashboard_filtered',{p_filters:filters(req.body.filters)})));
 app.post('/api/invoices/query',async(req,res)=>res.json(await rpc(req,'mc_query_invoices',{p_filters:filters(req.body.filters),p_page:Number(req.body.page)||1,p_size:50})));
 app.get('/api/customers',async(req,res)=>{
  let query=req.db.from('mc_customers').select('*').order('name').limit(1000);if(req.query.search){const term=text(req.query.search,'Search',160).replace(/[%,()"\\_]/g,'');query=query.or(`name.ilike.%${term}%,customer_code.ilike.%${term}%`);};
  const {data,error}=await query;res.json(result(data,error));
 });
 app.post('/api/customers',canWrite,async(req,res)=>res.status(201).json(await rpc(req,'mc_save_customer',{p_data:customerData(req.body)})));
 app.put('/api/customers/:id',canWrite,async(req,res)=>res.json(await rpc(req,'mc_save_customer',{p_data:customerData(req.body),p_id:requireUuid(req.params.id),p_version:version(req.body.version)})));
 app.get('/api/invoices/:id',async(req,res)=>{
  const id=requireUuid(req.params.id);const {data,error}=await req.db.from('mc_invoice_register').select('*').eq('org_id',req.org).eq('id',id).maybeSingle();const invoice=result(data,error);if(!invoice)throw new AppError('Invoice not found',404);
  const {data:p,error:e}=await req.db.from('mc_payments').select('*').eq('org_id',req.org).eq('invoice_id',id).order('created_at',{ascending:false});
  res.json({invoice,payments:result(p,e)});
 });
 app.post('/api/invoices',canWrite,async(req,res)=>res.status(201).json(await rpc(req,'mc_save_invoice',{p_data:invoiceData(req.body)})));
 app.put('/api/invoices/:id',canWrite,async(req,res)=>res.json(await rpc(req,'mc_save_invoice',{p_data:invoiceData(req.body),p_id:requireUuid(req.params.id),p_version:version(req.body.version)})));
 app.post('/api/invoices/:id/payments',canWrite,async(req,res)=>res.status(201).json(await rpc(req,'mc_record_payment',{p_invoice:requireUuid(req.params.id),p_data:paymentData(req.body)})));
 app.post('/api/payments/:id/reverse',async(req,res)=>res.json(await rpc(req,'mc_reverse_payment',{p_payment:requireUuid(req.params.id),p_reason:text(req.body.reason,'Reason',1000,{required:true})})));
 app.post('/api/imports/inspect',canWrite,upload.single('file'),async(req,res)=>{const parsed=await readUpload(req.file);res.json({columns:parsed.columns,mapping:mappingFor(parsed.columns),sample:parsed.records.slice(0,5),count:parsed.records.length,fields});});
 app.post('/api/imports/preview',canWrite,upload.single('file'),async(req,res)=>{
  const parsed=await readUpload(req.file);let mapping;try{mapping=JSON.parse(req.body.mapping);}catch{throw new AppError('Invalid column mapping');}
  res.json(await rpc(req,'mc_preview_import',{p_file_name:text(req.file.originalname,'File name',200,{required:true}),p_rows:normalizeRows(parsed,mapping)}));
 });
 app.post('/api/imports/:id/commit',canWrite,async(req,res)=>res.json(await rpc(req,'mc_commit_import',{p_batch:requireUuid(req.params.id)})));
 app.get('/api/imports',async(req,res)=>{const {data,error}=await req.db.from('mc_import_batches').select('id,file_name,status,created_at,committed_at,result').eq('org_id',req.org).order('created_at',{ascending:false}).limit(100);res.json(result(data,error));});
 app.get('/api/imports/:id/rejected',async(req,res)=>{
  const {data,error}=await req.db.from('mc_import_batches').select('preview').eq('org_id',req.org).eq('id',requireUuid(req.params.id)).maybeSingle();const batch=result(data,error);if(!batch)throw new AppError('Import not found',404);
  sendFile(res,plainCsv(rejectedRows(batch.preview),['row',...fields,'error']),'text/csv; charset=utf-8','rejected-rows.csv');
 });
 app.post('/api/reports/apply',async(req,res)=>{if(!['invoices','history','payments'].includes(req.body.kind))throw new AppError('Invalid report');res.json(await rpc(req,'mc_apply_report',{p_kind:req.body.kind,p_filters:filters(req.body.filters,req.body.kind)}));});
 app.get('/api/reports/:id/export',async(req,res)=>{
  const format=req.query.format||'xlsx';if(!['csv','xlsx','pdf'].includes(format))throw new AppError('Invalid export format');
  const report=await rpc(req,'mc_get_report',{p_report:requireUuid(req.params.id),p_export:true});const buffer=format==='xlsx'?await excelBuffer(report,req.currency):format==='pdf'?await pdfBuffer(report,req.currency):csvBuffer(report,req.currency);
  sendFile(res,buffer,{csv:'text/csv; charset=utf-8',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pdf:'application/pdf'}[format],`mary-${report.kind}-${report.as_of_date}.${format}`);
 });
 app.get('/api/history/actors',async(req,res)=>res.json(await rpc(req,'mc_history_actors')));
 app.get('/api/team',async(req,res)=>res.json(await rpc(req,'mc_team')));
 app.post('/api/team',async(req,res)=>res.json(await rpc(req,'mc_save_member',{p_email:text(req.body.email,'Email',254,{required:true}),p_role:req.body.role,p_active:req.body.active!==false})));
 const dist=path.resolve(fileURLToPath(new URL('../../admin/dist',import.meta.url)));
 if(fs.existsSync(dist)){app.use(express.static(dist,{maxAge:config.production?'1h':0}));app.get('/',(_req,res)=>res.sendFile(path.join(dist,'index.html')));}
 app.use((_req,res)=>res.status(404).json({error:'Page not found'}));
 app.use((error,_req,res,_next)=>{const status=error.code==='LIMIT_FILE_SIZE'?413:error.status||400;res.status(status).json({error:error.code==='LIMIT_FILE_SIZE'?'File exceeds 5 MB':error.message||'Request failed'});});
 return app;
}
function sendFile(res,buffer,type,name){res.setHeader('Content-Type',type);res.setHeader('Content-Disposition',`attachment; filename="${name}"`);res.send(buffer);}
