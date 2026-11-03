-- Suvaco da Jinx — schema Supabase (rodar no SQL Editor do seu projeto, de cima pra baixo)

-- ====== PERFIS ======
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null default 'Convidado',
  avatar_url text,
  bio text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name)
  values (new.id, 'user_' || substr(new.id::text, 1, 8), coalesce(new.raw_user_meta_data->>'display_name', 'Convidado'));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
create policy "profiles sao publicos pra leitura" on public.profiles for select using (true);
create policy "so o dono edita o proprio perfil" on public.profiles for update using (auth.uid() = id);

-- ====== SERVIDORES ======
create table public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon_url text,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  invite_code text unique not null default substr(md5(random()::text), 1, 8),
  created_at timestamptz not null default now()
);

create table public.server_members (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create function public.is_member_of_server(sid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.server_members where server_id = sid and user_id = auth.uid());
$$;

alter table public.servers enable row level security;
alter table public.server_members enable row level security;

create policy "so membros veem o servidor" on public.servers for select using (is_member_of_server(id));
create policy "qualquer logado cria servidor (vira owner)" on public.servers for insert with check (auth.uid() = owner_id);
create policy "so owner edita" on public.servers for update using (auth.uid() = owner_id);
create policy "so owner apaga" on public.servers for delete using (auth.uid() = owner_id);

create policy "so membros veem a lista de membros" on public.server_members for select using (is_member_of_server(server_id));
create policy "so owner remove membro (ou o proprio sai)" on public.server_members for delete
  using (auth.uid() = user_id or exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

create function public.join_server_by_code(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select id into sid from public.servers where invite_code = code;
  if sid is null then raise exception 'codigo invalido'; end if;
  insert into public.server_members (server_id, user_id) values (sid, auth.uid())
    on conflict do nothing;
  return sid;
end;
$$;

-- ====== CANAIS (texto e voz) ======
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null,
  type text not null check (type in ('text', 'voice')),
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.channels enable row level security;
create policy "so membros veem canais" on public.channels for select using (is_member_of_server(server_id));
create policy "membros criam canal" on public.channels for insert with check (is_member_of_server(server_id));

create function public.is_member_of_channel(cid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.channels c where c.id = cid and public.is_member_of_server(c.server_id)
  );
$$;

-- trigger: ao criar servidor, owner entra como membro + canais default sao criados
create function public.handle_new_server() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.server_members (server_id, user_id, role) values (new.id, new.owner_id, 'owner');
  insert into public.channels (server_id, name, type, position) values
    (new.id, 'geral', 'text', 0), (new.id, 'Geral', 'voice', 1);
  return new;
end;
$$;
create trigger on_server_created after insert on public.servers
  for each row execute procedure public.handle_new_server();

-- ====== MENSAGENS (canal de texto) ======
-- anexo grande e P2P efemero (nao persiste o arquivo) — so guardamos o metadado
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text,
  attachment_name text,
  attachment_size_bytes bigint,
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;
create policy "so membros do canal leem mensagens" on public.messages for select using (is_member_of_channel(channel_id));
create policy "so membros do canal escrevem, como si mesmo" on public.messages for insert
  with check (auth.uid() = author_id and is_member_of_channel(channel_id));

-- habilita Realtime (postgres_changes) na tabela de mensagens
alter publication supabase_realtime add table public.messages;
