import dotenv from 'dotenv';
import {fileURLToPath} from 'node:url';
import {createApp} from './app.js';
dotenv.config({path:fileURLToPath(new URL('../.env',import.meta.url)),quiet:true});
const port=Number(process.env.PORT||4000);
const supabaseUrl=process.env.SUPABASE_URL||'';const supabaseKey=process.env.SUPABASE_PUBLISHABLE_KEY||'';
if(supabaseKey.startsWith('sb_secret_'))throw new Error('Use the Supabase publishable or legacy anon key, not a secret key');
if(supabaseKey.split('.').length===3){try{if(JSON.parse(Buffer.from(supabaseKey.split('.')[1],'base64url')).role==='service_role')throw new Error('Do not use a service-role key');}catch(e){if(e.message==='Do not use a service-role key')throw e;}}
const app=createApp({supabaseUrl,supabaseKey,production:process.env.NODE_ENV==='production',allowedOrigins:(process.env.ALLOWED_ORIGINS||'http://127.0.0.1:3001,http://localhost:3001').split(',').map(s=>s.trim())});
app.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Mary Collections: http://${process.env.HOST||'127.0.0.1'}:${port}`)).on('error',e=>{console.error(e.message);process.exitCode=1;});
