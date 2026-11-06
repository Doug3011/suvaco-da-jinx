-- v3.10.0: "visto há Xh" (last_seen_at) + reações com emoji nas mensagens de canal.

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
alter table public.message_reactions enable row level security;

create policy "qualquer um ve reacoes de mensagens que pode ver"
  on public.message_reactions for select
  using (
    exists (
      select 1 from public.messages m
      join public.channels c on c.id = m.channel_id
      join public.server_members sm on sm.server_id = c.server_id
      where m.id = message_reactions.message_id and sm.user_id = auth.uid()
    )
  );

create policy "reage como voce mesmo, só em mensagem que pode ver"
  on public.message_reactions for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.messages m
      join public.channels c on c.id = m.channel_id
      join public.server_members sm on sm.server_id = c.server_id
      where m.id = message_reactions.message_id and sm.user_id = auth.uid()
    )
  );

create policy "só remove a própria reação"
  on public.message_reactions for delete
  using (auth.uid() = user_id);

alter publication supabase_realtime add table public.message_reactions;
