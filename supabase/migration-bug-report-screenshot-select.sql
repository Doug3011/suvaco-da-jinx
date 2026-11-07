-- Necessária pro aviso de bug via webhook: migration-3.11.0-bug-reports.sql só
-- criou policy de INSERT pro bucket bug-reports (a Edge Function antiga lia
-- com a service role, que ignora RLS). Agora que o link do print é gerado
-- direto no client (createSignedUrl), quem mandou o print precisa de uma
-- policy de SELECT pra poder gerar o link assinado do próprio arquivo.
create policy "dono pode gerar link assinado do próprio print de bug"
  on storage.objects for select
  using (bucket_id = 'bug-reports' and owner = auth.uid());
