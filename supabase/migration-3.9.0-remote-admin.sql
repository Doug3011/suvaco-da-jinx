-- v3.9.0: flag de segurança pro "modo admin" (controle remoto de tela,
-- estilo TeamViewer, só entre amigos de confiança — ver plano/changelog).
-- Setável SÓ por SQL manual, nunca pela UI/API do app: mesmo que alguém
-- descubra o toggle escondido nas Configurações, ele não ativa nada sem
-- essa flag vir true do perfil da conta.

alter table public.profiles
  add column if not exists is_remote_admin boolean not null default false;

-- Pra liberar pra uma conta específica (troque o UUID pelo id real do
-- perfil em public.profiles — dá pra achar pelo display_name):
-- update public.profiles set is_remote_admin = true where id = 'UUID-AQUI';
