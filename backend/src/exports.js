import path from 'node:path';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
const fontFile=name=>{
 const candidates=[path.resolve(process.cwd(),'assets/fonts',name),path.resolve(process.cwd(),'backend/assets/fonts',name)];
 const match=candidates.find(file=>fs.existsSync(file));
 if(!match)throw new Error(`Missing PDF font: ${name}`);
 return match;
};
export const columnSets={
 invoices:[['internal_number','Invoice ID'],['external_number','Source invoice'],['customer_code','Customer code'],['customer_name','Customer'],['invoice_date','Invoice date'],['due_date','Due date'],['amount','Invoiced'],['paid_amount','Collected'],['balance','Outstanding'],['payment_status','Payment status'],['due_status','Due status'],['overdue_days','Overdue days'],['operation_status','Action status'],['notes','Notes']],
 payments:[['internal_number','Invoice ID'],['external_number','Source invoice'],['customer_name','Customer'],['payment_date','Payment date'],['amount','Amount'],['method','Method'],['reference','Reference'],['notes','Notes'],['created_at','Recorded at'],['recorded_by','Recorded by'],['reversed_at','Reversed at'],['reversal_reason','Reversal reason']],
 history:[['created_at','Date and time'],['action','Action'],['customer_name','Customer'],['invoice_number','Invoice ID'],['external_number','Source invoice'],['actor_email','User'],['before_data','Before'],['after_data','After']]
};
const pretty=v=>typeof v==='object'&&v!==null?JSON.stringify(v):String(v??'');
export function safeCell(v) {const t=pretty(v);return /^[\s]*[=+@-]/.test(t)?`'${t}`:t;}
const csvCell=v=>`"${safeCell(v).replaceAll('"','""')}"`;
export function csvBuffer(report,currency='KES') {
 const cols=columnSets[report.kind];const lines=[['Mary Collections',report.kind],['Currency',currency],['Applied at',report.created_at],['As of',report.as_of_date],...Object.entries(report.filter_labels||{}),...Object.entries(report.filters).map(([k,v])=>[k,v]),...Object.entries(report.summary).map(([k,v])=>[k,v]),[],cols.map(x=>x[1]),...report.rows.map(r=>cols.map(([k])=>r[k]))];
 return Buffer.from('\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n'));
}
export function plainCsv(rows,columns) {return Buffer.from('\uFEFF'+[columns.map(c=>csvCell(c)),...rows.map(r=>columns.map(c=>csvCell(r[c])))].map(r=>r.join(',')).join('\r\n'));}
export async function excelBuffer(report,currency='KES') {
 const wb=new ExcelJS.Workbook();wb.creator='Mary Collections';wb.created=new Date(report.created_at);
 const cover=wb.addWorksheet('Summary',{properties:{tabColor:{argb:'FF16856A'}}});cover.columns=[{width:22},{width:18},{width:22},{width:18},{width:22},{width:18}];
 cover.mergeCells('A1:F2');cover.getCell('A1').value='Mary Collections';cover.getCell('A1').font={bold:true,size:22,color:{argb:'FFFFFFFF'}};cover.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF153E44'}};cover.getCell('A1').alignment={vertical:'middle'};cover.getRow(1).height=25;cover.getRow(2).height=15;
 cover.mergeCells('A3:F3');cover.getCell('A3').value=`${report.kind.toUpperCase()} · ${currency} · ${report.as_of_date}`;cover.getCell('A3').font={size:11,color:{argb:'FF60786E'}};cover.getRow(3).height=26;
 const metrics=Object.entries(report.summary).filter(([k])=>['count','invoiced','collected','outstanding','overdue','partial_balance'].includes(k));
 metrics.forEach(([key,value],i)=>{const col=1+(i%3)*2,row=5+Math.floor(i/3)*4;cover.mergeCells(row,col,row,col+1);cover.mergeCells(row+1,col,row+2,col+1);const title=cover.getCell(row,col),val=cover.getCell(row+1,col);title.value=key.replaceAll('_',' ').toUpperCase();title.font={size:9,color:{argb:'FF688476'}};val.value=value;val.numFmt=key==='count'?'0':'#,##0.00';val.font={size:19,bold:true,color:{argb:key==='overdue'?'FFB15E51':'FF153E44'}};val.alignment={vertical:'middle'};for(let rr=row;rr<=row+2;rr++)for(let cc=col;cc<=col+1;cc++)cover.getCell(rr,cc).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1F6F1'}};});
 cover.mergeCells('A14:F14');cover.getCell('A14').value='APPLIED FILTERS';cover.getCell('A14').font={size:10,bold:true,color:{argb:'FF153E44'}};let criterionRow=15;for(const [key,value]of Object.entries({...report.filters,...report.filter_labels})){cover.mergeCells(criterionRow,1,criterionRow,2);cover.mergeCells(criterionRow,3,criterionRow,6);cover.getCell(criterionRow,1).value=key.replaceAll('_',' ');cover.getCell(criterionRow,3).value=safeCell(value);cover.getRow(criterionRow).alignment={wrapText:true,vertical:'top'};criterionRow++;}if(criterionRow===15){cover.mergeCells('A15:F15');cover.getCell('A15').value='All records';}
 cover.mergeCells(criterionRow+2,1,criterionRow+2,6);cover.getCell(criterionRow+2,1).value=`Applied: ${report.created_at}`;cover.getCell(criterionRow+2,1).font={size:9,color:{argb:'FF829589'}};cover.pageSetup={paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:1};
 const sheet=wb.addWorksheet('Report',{properties:{tabColor:{argb:'FF153E44'}}});const cols=columnSets[report.kind];sheet.columns=cols.map(([key,header])=>({key,header,width:['notes','before_data','after_data'].includes(key)?50:key.includes('number')?25:22}));
 for(const [index,r]of report.rows.entries()){const row=sheet.addRow(Object.fromEntries(cols.map(([key])=>[key,typeof r[key]==='number'?r[key]:safeCell(r[key])])));row.font={size:10,color:{argb:'FF29473D'}};row.alignment={vertical:'middle'};row.eachCell({includeEmpty:true},cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:index%2?'FFF4F8F3':'FFFFFFFF'}};cell.border={bottom:{style:'hair',color:{argb:'FFE2EAE2'}}};});for(const[key]of cols)if(['notes','before_data','after_data'].includes(key))row.getCell(key).alignment={wrapText:true,vertical:'top'};if(String(r.notes||'').length<80&&!r.before_data&&!r.after_data)row.height=23;for(const key of ['payment_status','due_status'])if(cols.some(c=>c[0]===key)){const cell=row.getCell(key);cell.font={size:10,bold:true,color:{argb:r.payment_status==='paid'?'FF16856A':r.due_status==='overdue'?'FFB15E51':'FF956B10'}};}}
 sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:cols.length}};
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF153E44'}};sheet.getRow(1).height=26;
 cols.forEach(([k],i)=>{if(['amount','paid_amount','balance'].includes(k))sheet.getColumn(i+1).numFmt='#,##0.00';});
 const criteria=wb.addWorksheet('Parameters');criteria.columns=[{width:28},{width:80}];
 criteria.addRows([['Mary Collections',report.kind],['Currency',currency],['Applied at',report.created_at],['As of',report.as_of_date],['Report ID',report.id],[],['Filter','Value'],...Object.entries(report.filter_labels||{}).map(([k,v])=>[k,safeCell(v)]),...Object.entries(report.filters).map(([k,v])=>[k,safeCell(v)]),[],['Total','Value'],...Object.entries(report.summary)]);
 criteria.getRow(1).font={bold:true,size:16,color:{argb:'FF153E44'}};criteria.getRow(1).height=30;criteria.eachRow((row,n)=>{row.alignment={vertical:'top',wrapText:true};if(n>1&&n%2===0)row.eachCell(c=>c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF4F8F3'}});});sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};sheet.headerFooter.oddFooter='Mary Collections | '+currency+' | Page &P of &N';return Buffer.from(await wb.xlsx.writeBuffer());
}
export async function pdfBuffer(report,currency='KES') {
 const {default:PDFDocument}=await import('pdfkit');
 return new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:'A4',layout:'landscape',margin:32,bufferPages:true});const chunks=[];doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
 doc.registerFont('Body',fontFile('DejaVuSans.ttf'));doc.registerFont('Heading',fontFile('DejaVuSans-Bold.ttf'));
 const w=doc.page.width-64;let y=24;doc.rect(0,0,doc.page.width,67).fill('#153e44');
 const line=(text,size=9,color='#33454a')=>{doc.font('Body').fontSize(size).fillColor(color).text(String(text),32,y,{width:w});y=doc.y+8;};
 line('Mary Collections',20,'#ffffff');y=80;line(`${report.kind.toUpperCase()} REPORT | ${currency} | ${report.as_of_date}`,11);line(`Applied: ${report.created_at} | Report: ${report.id}`,8);
 line(Object.entries({...report.filters,...report.filter_labels}).map(([k,v])=>`${k.replaceAll('_',' ')}: ${v}`).join('  |  ')||'All records',8);
 const metrics=Object.entries(report.summary).filter(([k])=>['count','invoiced','collected','outstanding','overdue'].includes(k));if(metrics.length){const cw=w/metrics.length;metrics.forEach(([k,v],i)=>{const x=32+i*cw;doc.roundedRect(x,y,cw-8,43,5).fill('#f0f5ee');doc.font('Body').fontSize(7).fillColor('#718678').text(k.replaceAll('_',' ').toUpperCase(),x+8,y+7,{width:cw-24,lineBreak:false});doc.font('Heading').fontSize(12).fillColor(k==='overdue'?'#b15e51':'#153e44').text(Number(v).toLocaleString('en-KE',{minimumFractionDigits:k==='count'?0:2,maximumFractionDigits:2}),x+8,y+21,{width:cw-24,lineBreak:false});});y+=56;}
 const defs=report.kind==='invoices'?[['internal_number','Invoice / Source',.20],['customer_name','Customer',.19],['invoice_date','Invoice date',.10],['due_date','Due date',.10],['amount','Invoiced',.09],['paid_amount','Collected',.09],['balance','Balance',.09],['payment_status','Status',.14]]:report.kind==='payments'?[['internal_number','Invoice / Source',.22],['customer_name','Customer',.22],['payment_date','Date',.12],['amount','Amount',.12],['method','Method',.10],['reference','Reference / Status',.22]]:[['created_at','Time',.16],['action','Action',.14],['customer_name','Customer / Invoice',.20],['actor_email','User',.17],['changes','Changes',.33]];
 const head=()=>{let x=32;doc.rect(32,y,w,24).fill('#153e44');doc.fillColor('#ffffff').font('Heading').fontSize(8);for(const[,h,f]of defs){doc.text(h,x+5,y+7,{lineBreak:false});x+=w*f;}y+=24;};
 head();
 for(const [rowIndex,row] of report.rows.entries()){
  const values=defs.map(([k])=>{if(k==='changes')return `Before: ${pretty(row.before_data)}\nAfter: ${pretty(row.after_data)}`;if(k==='customer_name'&&report.kind==='history')return [row.customer_name,row.invoice_number,row.external_number].filter(Boolean).join('\n');if(k==='internal_number')return [row.internal_number,row.external_number].filter(Boolean).join('\n');if(k==='payment_status')return `${row.payment_status}\n${row.due_status}`;if(k==='reference')return `${row.reference||''}\n${row.reversed_at?'Reversed':'Active'}`;if(['amount','paid_amount','balance'].includes(k))return Number(row[k]).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});return pretty(row[k]);});
  // Audit JSON can be longer than a page; print a compact change list, with full values in CSV/Excel.
  if(report.kind==='history'){const before=row.before_data||{},after=row.after_data||{};values[4]=Object.keys({...before,...after}).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k])).map(k=>`${k}: ${pretty(before[k])||'-'} -> ${pretty(after[k])||'-'}`).join('\n');}
  doc.font('Body').fontSize(8);
  const wrap=(text,width)=>{
   const lines=[];
   for(const raw of String(text).split('\n')){let line='';for(const ch of raw){if(line&&doc.widthOfString(line+ch)>width){lines.push(line);line=ch;}else line+=ch;}lines.push(line);}
   return lines;
  };
  const columns=values.map((v,i)=>wrap(v,w*defs[i][2]-10));let offset=0;const total=Math.max(...columns.map(c=>c.length));
  while(offset<total){
   const space=doc.page.height-48-y;const available=Math.floor((space-10)/11);
   if(available<1||space<27||(total-offset<=3&&available<total-offset)){doc.addPage();y=32;head();continue;}
   const count=Math.min(available,total-offset);const height=Math.max(27,count*11+10);let x=32;doc.font('Body').fontSize(8);if(rowIndex%2===1)doc.rect(32,y,w,height).fill('#f4f8f2');
   defs.forEach(([, ,f],i)=>{doc.fillColor('#23373c');columns[i].slice(offset,offset+count).forEach((line,j)=>doc.text(line,x+5,y+6+j*11,{lineBreak:false}));x+=w*f;});
   y+=height;doc.strokeColor('#dfe6e7').moveTo(32,y).lineTo(32+w,y).stroke();offset+=count;
   if(offset<total){doc.addPage();y=32;head();}
  }
 }
 const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.font('Body').fontSize(8).fillColor('#758489').text(`Mary Collections · ${currency} · ${report.as_of_date}`,32,doc.page.height-25,{lineBreak:false});doc.fontSize(8).fillColor('#758489').text(`${i+1} / ${range.count}`,doc.page.width-80,doc.page.height-25,{lineBreak:false});}
 doc.end();
 });
}
