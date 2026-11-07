-- Conserta o botão de "Reportar um bug": a policy de INSERT de
-- migration-3.11.0-bug-reports.sql nunca pegou de verdade no banco (RLS
-- tava ligado sem nenhuma policy permissiva, bloqueando TODO insert com
-- "new row violates row-level security policy"). Recria por garantia.
--
-- Além disso, o insert do app usa .select('id').single() pra pegar o id
-- do report recém-criado (precisa pra disparar o aviso no Discord depois)
-- - isso faz um RETURNING que também passa pela checagem de SELECT do RLS,
-- e não existia nenhuma policy de leitura (de propósito, só decidida
-- tarde demais). Sem essa policy, o insert até passaria mas o .select()
-- de volta falharia. Adiciona uma policy de SELECT só pro próprio autor.

drop policy if exists "qualquer logado pode criar um bug report" on public.bug_reports;
create policy "qualquer logado pode criar um bug report"
  on public.bug_reports for insert
  with check (auth.uid() is not null);

drop policy if exists "autor ve os proprios bug reports" on public.bug_reports;
create policy "autor ve os proprios bug reports"
  on public.bug_reports for select
  using (auth.uid() = reporter_id);
