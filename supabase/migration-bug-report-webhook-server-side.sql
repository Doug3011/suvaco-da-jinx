-- Move o POST pro webhook do Discord do client pro Postgres (via pg_net).
-- Antes a URL do webhook ficava hardcoded em app.js, que é servido pra
-- qualquer um (navegador ou .exe empacotado) - dava pra ler a URL no
-- DevTools e postar spam no canal pra sempre, ou até chamar a function
-- exposta globalmente (notifyBugReportWebhook) pelo console sem nem
-- precisar de um bug_reports de verdade existir. Agora o client só manda
-- o id do próprio report; a URL e a validação (o report tem que existir
-- e ser seu) ficam só aqui.
--
-- A URL em si NÃO fica neste arquivo (esse arquivo vai pro git, que é um
-- repositório público) - ela fica guardada criptografada no Vault do
-- Supabase. Antes de rodar o resto deste arquivo, rode isso UMA VEZ no SQL
-- Editor (sem salvar/commitar em lugar nenhum, só cola e roda direto):
--
--   select vault.create_secret(
--     '<cole a URL do webhook do Discord aqui>',
--     'bug_report_discord_webhook'
--   );

create extension if not exists pg_net;

create or replace function public.notify_bug_report(report_id uuid, screenshot_url text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.bug_reports;
  webhook_url text;
begin
  select * into r from public.bug_reports where id = report_id and reporter_id = auth.uid();
  if not found then
    return;
  end if;

  select decrypted_secret into webhook_url
    from vault.decrypted_secrets where name = 'bug_report_discord_webhook';
  if webhook_url is null then
    return;
  end if;

  perform net.http_post(
    url := webhook_url,
    body := jsonb_build_object(
      'embeds', jsonb_build_array(
        jsonb_build_object(
          'title', '🐛 Novo bug reportado no Ribbit',
          'description', left(coalesce(r.description, '(sem descrição)'), 3900),
          'color', 15020909,
          'fields', jsonb_build_array(
            jsonb_build_object('name', 'De', 'value', coalesce(r.reporter_name, 'desconhecido'), 'inline', true),
            jsonb_build_object('name', 'Versão', 'value', coalesce(r.app_version, '?'), 'inline', true),
            jsonb_build_object('name', 'Plataforma', 'value', coalesce(r.platform, '?'), 'inline', true)
          ),
          'image', case when screenshot_url is not null then jsonb_build_object('url', screenshot_url) else null end,
          'timestamp', to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        )
      )
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
end;
$$;

revoke all on function public.notify_bug_report(uuid, text) from public;
grant execute on function public.notify_bug_report(uuid, text) to authenticated;
