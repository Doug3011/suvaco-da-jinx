-- v3.11.0: "Reportar um bug" (descrição + print opcional, enviado por e-mail
-- via Edge Function). Essa migration cria a tabela de registro e o bucket de
-- storage pros prints - a Edge Function em si (supabase/functions/send-bug-report)
-- precisa ser criada à parte pelo Dashboard (não dá pra criar Edge Function por SQL).

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reporter_id uuid references public.profiles(id) on delete set null,
  reporter_name text,
  description text not null,
  app_version text,
  platform text,
  screenshot_path text,
  email_sent_at timestamptz
);
alter table public.bug_reports enable row level security;

-- qualquer um logado (inclusive login anônimo, que é o que o app usa) pode
-- criar um report - não existe política de select/update/delete pra clientes
-- comuns de propósito: só o dashboard (chave de service role, que ignora RLS)
-- e a Edge Function devem conseguir ler/atualizar os reports.
create policy "qualquer logado pode criar um bug report"
  on public.bug_reports for insert
  with check (auth.uid() is not null);

-- bucket privado (não público) pros prints - só a Edge Function (service role)
-- precisa ler os arquivos pra anexar no e-mail.
insert into storage.buckets (id, name, public)
values ('bug-reports', 'bug-reports', false)
on conflict (id) do nothing;

create policy "qualquer logado pode enviar print de bug"
  on storage.objects for insert
  with check (bucket_id = 'bug-reports' and auth.uid() is not null);
