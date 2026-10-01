import serverless from 'serverless-http';
import {createApp} from '../../backend/src/app.js';

function cleanEnv(value='') {
  const trimmed=String(value).trim();
  if((trimmed.startsWith('"')&&trimmed.endsWith('"'))||(trimmed.startsWith("'")&&trimmed.endsWith("'"))) return trimmed.slice(1,-1).trim();
  return trimmed;
}

function normalizeSupabaseUrl(value='') {
  const cleaned=cleanEnv(value).replace(/\/+$/,'');
  if(!cleaned) return '';
  try {
    const parsed=new URL(cleaned);
    if(parsed.protocol!=='https:'&&parsed.protocol!=='http:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

const supabaseUrl=normalizeSupabaseUrl(process.env.SUPABASE_URL);
const supabaseKey=cleanEnv(process.env.SUPABASE_PUBLISHABLE_KEY);

if(supabaseKey.startsWith('sb_secret_')) throw new Error('Use the Supabase publishable or legacy anon key, not a secret key');
if(supabaseKey.split('.').length===3){
  try{
    if(JSON.parse(Buffer.from(supabaseKey.split('.')[1],'base64url')).role==='service_role') throw new Error('Do not use a service-role key');
  }catch(error){
    if(error.message==='Do not use a service-role key') throw error;
  }
}

const allowedOrigins=[
  process.env.URL,
  ...(process.env.ALLOWED_ORIGINS||'').split(',')
].map(cleanEnv).filter(Boolean);

const app=createApp({
  supabaseUrl,
  supabaseKey,
  production:true,
  allowedOrigins:[...new Set(allowedOrigins)]
});

export const handler=serverless(app);
