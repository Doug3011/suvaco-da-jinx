// Edge Function: lê um bug_reports pelo id, manda um e-mail pro
// desenvolvedor (via Gmail SMTP com senha de app) com a descrição e o print
// anexado (se tiver), e marca email_sent_at no registro.
//
// Segredos necessários (Dashboard > Edge Functions > send-bug-report > Secrets,
// ou "supabase secrets set" se usar a CLI):
//   GMAIL_USER          -> o Gmail que vai ENVIAR o e-mail (precisa ter
//                           verificação em 2 etapas ligada pra gerar senha de app)
//   GMAIL_APP_PASSWORD  -> a senha de app de 16 caracteres gerada em
//                           myaccount.google.com/apppasswords
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente em
// toda Edge Function, não precisa configurar.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const DEST_EMAIL = 'gilbertodinossaro01@gmail.com';

Deno.serve(async (req) => {
  try {
    const { reportId } = await req.json();
    if (!reportId) {
      return new Response(JSON.stringify({ error: 'reportId obrigatório' }), { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: report, error: reportErr } = await supabase
      .from('bug_reports')
      .select('*')
      .eq('id', reportId)
      .single();
    if (reportErr || !report) {
      return new Response(JSON.stringify({ error: 'report não encontrado' }), { status: 404 });
    }

    const attachments: { filename: string; content: Uint8Array; encoding: 'binary' }[] = [];
    if (report.screenshot_path) {
      const { data: file, error: dlErr } = await supabase.storage
        .from('bug-reports')
        .download(report.screenshot_path);
      if (!dlErr && file) {
        attachments.push({
          filename: 'print.jpg',
          content: new Uint8Array(await file.arrayBuffer()),
          encoding: 'binary',
        });
      }
    }

    const client = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: {
          username: Deno.env.get('GMAIL_USER')!,
          password: Deno.env.get('GMAIL_APP_PASSWORD')!,
        },
      },
    });

    const body = [
      'Novo bug report no Suvaco da Jinx',
      '',
      `De: ${report.reporter_name || 'desconhecido'}`,
      `Versão do app: ${report.app_version || '?'}`,
      `Plataforma: ${report.platform || '?'}`,
      `Data: ${report.created_at}`,
      '',
      'Descrição:',
      report.description || '(sem descrição)',
    ].join('\n');

    await client.send({
      from: Deno.env.get('GMAIL_USER')!,
      to: DEST_EMAIL,
      subject: `[Suvaco da Jinx] Bug report de ${report.reporter_name || 'alguém'}`,
      content: body,
      attachments,
    });
    await client.close();

    await supabase
      .from('bug_reports')
      .update({ email_sent_at: new Date().toISOString() })
      .eq('id', reportId);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('send-bug-report falhou:', e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
