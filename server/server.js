// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Basic middleware ---
app.use(helmet());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// serve frontend
app.use(express.static('public'));

// If frontend hosted on same origin, no cors needed. Otherwise configure origin and credentials.
app.use(cors({ origin: true, credentials: true }));

// session (for simplicity use memory store; in production استخدم store مناسب)
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false, maxAge: 24*60*60*1000 } // secure=true in prod with HTTPS
}));

// --- Supabase client (server-side, needs SERVICE_ROLE key or anon with insert rights) ---
if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY){
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// --- Google Sheets setup (Service Account) ---
if(!process.env.GOOGLE_SERVICE_ACCOUNT_FILE || !process.env.SPREADSHEET_ID){
  console.error('Missing GOOGLE_SERVICE_ACCOUNT_FILE or SPREADSHEET_ID in .env');
  // don't exit: allow for local dev if you only use Supabase; but check at runtime.
}
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
});
const sheetsClient = google.sheets({ version: 'v4', auth });

// Utility: read Users sheet from Google Sheets
async function checkUserInSheet(email, phone){
  const sheetId = process.env.SPREADSHEET_ID;
  if(!sheetId) return { exists:false };
  try{
    const res = await sheetsClient.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Users!A:C' });
    const rows = res.data.values || [];
    // Expect columns: A=email, B=phone, C=role
    for(const r of rows){
      const e = (r[0]||'').toString().trim();
      const p = (r[1]||'').toString().trim();
      const role = (r[2]||'user').toString().trim();
      if(e.toLowerCase() === (email||'').toLowerCase() && p === (phone||'')){
        return { exists:true, role };
      }
    }
    return { exists:false };
  }catch(err){
    console.error('Google Sheets error', err);
    return { exists:false };
  }
}

// ROUTES

// check user and set session
app.post('/api/checkUser', async (req, res) => {
  const { email, phone } = req.body;
  if(!email || !phone) return res.status(400).json({ exists:false, message:'missing' });
  const result = await checkUserInSheet(email, phone);
  if(result.exists){
    req.session.user = { email, role: result.role || 'user' };
    return res.json({ exists:true, role: result.role || 'user' });
  } else {
    return res.json({ exists:false });
  }
});

// logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(()=> res.json({ ok:true }));
});

// insert invoice (must have logged in user)
app.post('/api/invoices', async (req, res) => {
  const user = req.session.user;
  if(!user) return res.status(401).json({ success:false, message:'Not authenticated' });

  // server-side validation: ensure required fields present
  const { type, product_code, product_name, code, supplier, quantity, unit_price, total, note } = req.body;
  if(!type || !supplier || !code){
    return res.status(400).json({ success:false, message:'Required fields missing' });
  }

  try{
    const now = new Date().toISOString();
    const payload = {
      type,
      product_code: product_code || null,
      product_name: product_name || null,
      code,
      supplier,
      quantity: quantity ?? null,
      unit_price: unit_price ?? null,
      total: total ?? null,
      note: note ?? null,
      user_email: user.email,
      created_at: now
    };
    // insert to supabase
    const { data, error } = await supabase
      .from('invoices')
      .insert([payload]);
    if(error){
      console.error('Supabase insert error', error);
      return res.status(500).json({ success:false, message:'DB error' });
    }
    return res.json({ success:true, invoice: data[0] });
  }catch(err){
    console.error(err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

// get invoices (admin only) with period filter: daily | weekly | monthly
app.get('/api/invoices', async (req, res) => {
  const user = req.session.user;
  if(!user || user.role !== 'admin') return res.status(403).json({ ok:false, message:'forbidden' });
  const period = (req.query.period || 'daily').toLowerCase();

  let from;
  const now = new Date();
  if(period === 'daily'){
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // today 00:00
  } else if(period === 'weekly'){
    from = new Date(now.getTime() - 7*24*60*60*1000);
  } else if(period === 'monthly'){
    from = new Date(now.getTime() - 30*24*60*60*1000);
  } else {
    from = new Date(0);
  }
  const fromIso = from.toISOString();

  try{
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .gte('created_at', fromIso)
      .order('created_at', { ascending: false });
    if(error){
      console.error('Supabase select error', error);
      return res.status(500).json({ ok:false, message:'DB error' });
    }
    return res.json({ ok:true, invoices: data });
  }catch(err){
    console.error(err);
    return res.status(500).json({ ok:false, message:'Server error' });
  }
});

// Start server
app.listen(PORT, ()=> console.log(`Server started on port ${PORT}`));
