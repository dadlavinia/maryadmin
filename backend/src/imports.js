import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { AppError, isoDate, money } from './validation.js';
import path from 'node:path';
import unzipper from 'unzipper';
export const fields=['customer_name','invoice_number','invoice_date','due_date','amount','customer_code','email','phone','notes'];
const aliases={name:'customer_name',customer:'customer_name',client:'customer_name',client_name:'customer_name',invoice_no:'invoice_number',invoice:'invoice_number',source_invoice_number:'invoice_number',date:'invoice_date',invoice_amount:'amount',total:'amount',due:'due_date',customer_id:'customer_code'};
const key=h=>String(h).replace(/^\uFEFF/,'').trim().toLowerCase().replace(/[\s-]+/g,'_');
export function mappingFor(columns) {const map={};for(const c of columns){const k=aliases[key(c)]||key(c);if(fields.includes(k)&&!map[k])map[k]=c;}return map;}
function value(cell) {
 if(cell.type===ExcelJS.ValueType.Formula) throw new AppError('Replace spreadsheet formulas with values before uploading');
 if(cell.type===ExcelJS.ValueType.Number&&/^0+$/.test(cell.numFmt||'')) return String(cell.value).padStart(cell.numFmt.length,'0');
 if(cell.value instanceof Date) return cell.value.toISOString().slice(0,10);
 return cell.text??'';
}
export async function readUpload(file) {
 if(!file) throw new AppError('Select a CSV or Excel file');
 const ext=path.extname(file.originalname).toLowerCase(); let matrix;
 if(ext==='.csv'){
  try{matrix=parse(file.buffer.toString('utf8'),{bom:true,skip_empty_lines:true,relax_column_count:false,max_record_size:100000});}catch(e){throw new AppError(`CSV: ${e.message}`);}
 } else if(ext==='.xlsx') {
  let archive;try{archive=await unzipper.Open.buffer(file.buffer);}catch{throw new AppError('Invalid Excel workbook');}
  if(archive.files.length>2000||archive.files.reduce((sum,f)=>sum+f.uncompressedSize,0)>50*1024*1024)throw new AppError('Excel workbook is too large when expanded');
  const book=new ExcelJS.Workbook();try {await book.xlsx.load(file.buffer);}catch {throw new AppError('Invalid Excel workbook');}
  const sheets=book.worksheets.filter(s=>s.actualRowCount>0);
  if(sheets.length!==1) throw new AppError('Use a workbook with one populated worksheet');
  const sheet=sheets[0]; if(sheet.rowCount>5001||sheet.columnCount>60)throw new AppError('Maximum 5,000 rows and 60 columns');
  matrix=[];sheet.eachRow({includeEmpty:false},row=>{matrix.push(Array.from({length:sheet.columnCount},(_,i)=>value(row.getCell(i+1))));});
 } else throw new AppError('Use .csv or .xlsx');
 if(matrix.length<2||matrix.length>5001)throw new AppError('Import requires 1–5,000 rows');
 const columns=matrix[0].map(h=>String(h).trim());
 if(columns.length>60||columns.some(c=>!c)||new Set(columns).size!==columns.length) throw new AppError('Column headers must be unique and non-empty');
 return {columns,records:matrix.slice(1).map(row=>Object.fromEntries(columns.map((c,i)=>[c,String(row[i]??'').trim()])))};
}
export function normalizeRows(parsed,mapping) {
 for(const f of fields.slice(0,5))if(!parsed.columns.includes(mapping[f]))throw new AppError(`Map ${f.replaceAll('_',' ')}`);
 const used=Object.values(mapping).filter(Boolean);if(new Set(used).size!==used.length)throw new AppError('Map each column once');
 return parsed.records.map(record=>{
  const row=Object.fromEntries(fields.map(f=>[f,record[mapping[f]]||'']));
  try{row.amount=money(row.amount,{positive:true});}catch{} // Database preview reports errors per row.
  try{row.invoice_date=isoDate(row.invoice_date);}catch{}
  try{row.due_date=isoDate(row.due_date);}catch{}
  return row;
 });
}
export function rejectedRows(preview) {return preview.filter(r=>r.errors.length).map(r=>({row:r.row_number,...r.row,error:r.errors.join('; ')}));}
