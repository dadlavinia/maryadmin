import serverless from 'serverless-http';
import {createApp} from '../../backend/src/app.js';

const supabaseUrl=process.env.SUPABASE_URL||'';
const supabaseKey=process.env.SUPABASE_PUBLISHABLE_KEY||'';

if(supabaseKey.startsWith('sb_secret_'))throw new Error('Use the Supabase publishable or legacy anon key, not a secret key');
if(supabaseKey.split('.').length===3){
  try{
    if(JSON.parse(Buffer.from(supabaseKey.split('.')[1],'base64url')).role==='service_role')throw new Error('Do not use a service-role key');
  }catch(error){
    if(error.message==='Do not use a service-role key')throw error;
  }
}

const allowedOrigins=[
  process.env.URL,
  ...(process.env.ALLOWED_ORIGINS||'').split(',')
].map(value=>value?.trim()).filter(Boolean);

const app=createApp({
  supabaseUrl,
  supabaseKey,
  production:true,
  allowedOrigins:[...new Set(allowedOrigins)]
});

export const handler=serverless(app);
