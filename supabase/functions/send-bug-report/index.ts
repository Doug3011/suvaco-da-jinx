// Edge Function: lê um bug_reports pelo id, manda um e-mail pro
// desenvolvedor (via Resend) com a descrição e o print anexado (se tiver),
// e marca email_sent_at no registro.
//
// Segredo necessário (Dashboard > Edge Functions > send-bug-report > Secrets,
// ou "supabase secrets set" se usar a CLI):
//   RESEND_API_KEY  -> a API key gerada em resend.com (começa com "re_")
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente em
// toda Edge Function, não precisa configurar.
//
// Observação sobre o remetente: sem verificar um domínio próprio no Resend,
// só dá pra mandar usando o remetente de teste deles (onboarding@resend.dev)
// — e, no plano grátis sem domínio verificado, o Resend só entrega pro
// e-mail da conta que criou a API key. Se DEST_EMAIL abaixo não for esse
// e-mail, o envio vai falhar com erro 403 do Resend (visível nos Logs da
// function) até você verificar um domínio em resend.com/domains.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEST_EMAIL = 'gilbertodinossaro01@gmail.com';
const FROM_EMAIL = 'Suvaco da Jinx <onboarding@resend.dev>';

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

    const attachments: { filename: string; content: string }[] = [];
    if (report.screenshot_path) {
      const { data: file, error: dlErr } = await supabase.storage
        .from('bug-reports')
        .download(report.screenshot_path);
      if (!dlErr && file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        attachments.push({ filename: 'print.jpg', content: btoa(binary) });
      }
    }

    const body = [
      `De: ${report.reporter_name || 'desconhecido'}`,
      `Versão do app: ${report.app_version || '?'}`,
      `Plataforma: ${report.platform || '?'}`,
      `Data: ${report.created_at}`,
      '',
      'Descrição:',
      report.description || '(sem descrição)',
    ].join('\n');

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [DEST_EMAIL],
        subject: `[Suvaco da Jinx] Bug report de ${report.reporter_name || 'alguém'}`,
        text: body,
        attachments,
      }),
    });
    if (!resendRes.ok) {
      const errText = await resendRes.text();
      throw new Error(`Resend falhou (${resendRes.status}): ${errText}`);
    }

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
