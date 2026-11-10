-- Adiciona servidor TURN (Metered.ca) pra conexoes WebRTC que nao conseguem
-- se conectar so com STUN (CGNAT, wifi corporativo, 4G de operadora, etc) -
-- era a causa provavel de "tela preta so pra alguns amigos" e "tive que
-- sair e entrar de novo pra ver a transmissao".
--
-- As credenciais NAO ficam neste arquivo (vai pro git, que e publico) -
-- ficam no Vault do Supabase. Antes de rodar o resto, rode isso UMA VEZ
-- no SQL Editor (so cola e roda direto, nao salva em arquivo nenhum):
--
--   select vault.create_secret('<usuario do TURN>', 'turn_username');
--   select vault.create_secret('<senha do TURN>', 'turn_credential');

create or replace function public.get_ice_servers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  turn_user text;
  turn_pass text;
begin
  select decrypted_secret into turn_user from vault.decrypted_secrets where name = 'turn_username';
  select decrypted_secret into turn_pass from vault.decrypted_secrets where name = 'turn_credential';

  if turn_user is null or turn_pass is null then
    return jsonb_build_array(
      jsonb_build_object('urls', 'stun:stun.l.google.com:19302'),
      jsonb_build_object('urls', 'stun:stun1.l.google.com:19302')
    );
  end if;

  return jsonb_build_array(
    jsonb_build_object('urls', 'stun:stun.relay.metered.ca:80'),
    jsonb_build_object('urls', 'turn:global.relay.metered.ca:80', 'username', turn_user, 'credential', turn_pass),
    jsonb_build_object('urls', 'turn:global.relay.metered.ca:80?transport=tcp', 'username', turn_user, 'credential', turn_pass),
    jsonb_build_object('urls', 'turn:global.relay.metered.ca:443', 'username', turn_user, 'credential', turn_pass),
    jsonb_build_object('urls', 'turns:global.relay.metered.ca:443?transport=tcp', 'username', turn_user, 'credential', turn_pass)
  );
end;
$$;

revoke all on function public.get_ice_servers() from public;
grant execute on function public.get_ice_servers() to authenticated;
