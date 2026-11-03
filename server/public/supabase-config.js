// Credenciais do projeto Supabase — a publishable/anon key é pública por design
// (a segurança de verdade vem das políticas de RLS no banco, não do segredo da key).
'use strict';

const SUPABASE_URL = 'https://fjbwgkbzaqeghmgcwrkc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_w8EBUw9BOcc7XVtvKudOiQ_gEt73b2e';

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
