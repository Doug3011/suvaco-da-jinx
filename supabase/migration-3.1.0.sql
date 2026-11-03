-- Migração pra v3.1.0 (amigos + DM + perfil completo) — rodar no SQL
-- Editor do Supabase numa instalação que já tem o schema anterior (não
-- precisa rodar o schema.sql inteiro de novo, só isso aqui).

alter table public.profiles add column banner_url text;

-- ====== AMIZADES ======
-- uma linha por par, status pending -> accepted. recusar/cancelar/desfazer
-- amizade e' sempre um delete da linha (nao tem status 'recusado' guardado).
create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

alter table public.friend_requests enable row level security;

create policy "ve pedidos que envolvem voce" on public.friend_requests for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);
create policy "manda pedido como voce mesmo" on public.friend_requests for insert
  with check (auth.uid() = requester_id);
create policy "so quem recebeu aceita" on public.friend_requests for update
  using (auth.uid() = addressee_id) with check (status = 'accepted');
create policy "qualquer um dos dois remove (cancela/recusa/desfaz)" on public.friend_requests for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create function public.are_friends(other uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.friend_requests
    where status = 'accepted'
      and ((requester_id = auth.uid() and addressee_id = other)
        or (requester_id = other and addressee_id = auth.uid()))
  );
$$;

-- "amigos em comum": a policy de select de friend_requests so deixa ver
-- linhas onde VOCE e' requester/addressee, entao nao da pra calcular a
-- intersecao com um select direto (nao enxergaria as amizades do outro
-- usuario). Roda com privilegio elevado e devolve so' o resultado da
-- intersecao, sem vazar a lista completa de amigos de ninguem.
create function public.mutual_friends(other uuid) returns setof public.profiles
language sql security definer stable set search_path = public as $$
  select p.* from public.profiles p
  join public.friend_requests fr_me on fr_me.status = 'accepted'
    and ((fr_me.requester_id = auth.uid() and fr_me.addressee_id = p.id)
      or (fr_me.requester_id = p.id and fr_me.addressee_id = auth.uid()))
  join public.friend_requests fr_other on fr_other.status = 'accepted'
    and ((fr_other.requester_id = other and fr_other.addressee_id = p.id)
      or (fr_other.requester_id = p.id and fr_other.addressee_id = other))
  where p.id <> auth.uid() and p.id <> other;
$$;

-- ====== MENSAGENS DIRETAS ======
create table public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.direct_messages enable row level security;

create policy "ve mensagens que envolvem voce" on public.direct_messages for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);
create policy "manda como voce mesmo, so pra amigo" on public.direct_messages for insert
  with check (auth.uid() = sender_id and public.are_friends(recipient_id));

alter publication supabase_realtime add table public.direct_messages;
