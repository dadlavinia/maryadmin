export class AppError extends Error { constructor(message,status=400) { super(message); this.status=status; } }
export const uuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
export function requireUuid(v,label='ID') { if(!uuid(v)) throw new AppError(`Invalid ${label}`); return v; }
export function isoDate(v,label='Date') {
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number(v.slice(0,4))<1900||Number(v.slice(0,4))>2199) throw new AppError(`${label}: use YYYY-MM-DD`);
 const date=new Date(`${v}T00:00:00Z`); if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==v) throw new AppError(`${label}: invalid date`); return v;
}
export function money(v,{positive=false,label='Amount'}={}) {
 const raw=String(v??'').trim();
 if(raw.includes(',')&&!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(raw)) throw new AppError(`${label}: invalid thousands separators`);
 const str=raw.replace(/,/g,'');
 if(!/^\d{1,12}(\.\d{1,2})?$/.test(str)) throw new AppError(`${label}: enter up to two decimal places`);
 const [whole,frac='']=str.split('.'); const cents=BigInt(whole)*100n+BigInt(frac.padEnd(2,'0'));
 if(positive&&cents===0n) throw new AppError(`${label}: must be greater than zero`);
 return `${BigInt(whole)}.${frac.padEnd(2,'0')}`;
}
export function text(v,label,max,{required=false}={}) { const t=String(v??'').trim(); if(t.length>max||required&&!t) throw new AppError(`${label}: ${required?'required; ':''}maximum ${max} characters`); return t; }
export function customerData(b) {
 return {name:text(b.name,'Name',160,{required:true}),customer_code:text(b.customer_code,'Customer code',80),email:text(b.email,'Email',254),phone:text(b.phone,'Phone',60),notes:text(b.notes,'Notes',4000),archived:b.archived===true};
}
export function invoiceData(b) {
 const d={customer_id:requireUuid(b.customer_id,'customer'),external_number:text(b.external_number,'Source invoice number',100),invoice_date:isoDate(b.invoice_date,'Invoice date'),due_date:isoDate(b.due_date,'Due date'),amount:money(b.amount,{positive:true}),notes:text(b.notes,'Notes',4000),operation_status:b.operation_status||'open',request_id:b.request_id?requireUuid(b.request_id,'invoice request'):null};
 if(d.due_date<d.invoice_date) throw new AppError('Due date cannot precede invoice date');
 if(!['open','actioned','disputed'].includes(d.operation_status)) throw new AppError('Invalid action status'); return d;
}
export function paymentData(b) {
 const d={amount:money(b.amount,{positive:true}),payment_date:isoDate(b.payment_date,'Payment date'),method:b.method,reference:text(b.reference,'Reference',160),notes:text(b.notes,'Notes',4000),idempotency_key:requireUuid(b.idempotency_key,'payment request')};
 if(!['cash','bank','mpesa','cheque','other'].includes(d.method)) throw new AppError('Choose a payment method'); return d;
}
const dates=['date_from','date_to','due_from','due_to','event_from','event_to'];
const amounts=['amount_min','amount_max','balance_min','balance_max','paid_min','paid_max'];
const lists={payment_status:['unpaid','partial','paid'],due_status:['overdue','due_today','not_due','settled'],operation_status:['open','actioned','disputed'],sort:['date','name','due','amount','balance'],payment_method:['cash','bank','mpesa','cheque','other'],reversal_status:['active','reversed']};
export function filters(b={},kind='invoices') {
 const allowed = kind==='history'?['search','customer_id','invoice_id','actor_id','action','event_from','event_to']:kind==='payments'?['search','customer_id','event_from','event_to','amount_min','amount_max','payment_method','reversal_status']:['search','customer_id',...dates.filter(x=>!x.startsWith('event')), ...amounts,'overdue_min','overdue_max','payment_status','due_status','operation_status','sort'];
 const out={};
 for(const [k,v] of Object.entries(b)) {
  if(v==null||v==='')continue;
  if(!allowed.includes(k))throw new AppError(`Unsupported filter: ${k}`);
  if(dates.includes(k))out[k]=isoDate(v,k);
  else if(amounts.includes(k))out[k]=money(v,{label:k});
  else if(['customer_id','invoice_id','actor_id'].includes(k))out[k]=requireUuid(v,k);
  else if(lists[k]){if(!lists[k].includes(v))throw new AppError(`Invalid ${k}`);out[k]=v;}
  else if(k.startsWith('overdue_')){if(!/^\d{1,6}$/.test(String(v)))throw new AppError('Invalid overdue days');out[k]=Number(v);}
  else out[k]=text(v,k,160);
 }
 for(const [a,z] of [['date_from','date_to'],['due_from','due_to'],['event_from','event_to']])if(out[a]&&out[z]&&out[a]>out[z])throw new AppError('Start date must precede end date');
 for(const [a,z] of [['amount_min','amount_max'],['balance_min','balance_max'],['paid_min','paid_max'],['overdue_min','overdue_max']])if(out[a]!=null&&out[z]!=null&&Number(out[a])>Number(out[z]))throw new AppError('Minimum must not exceed maximum');
 return out;
}
export function version(v){ if(!Number.isInteger(v)||v<1)throw new AppError('Reload the record before saving');return v; }
