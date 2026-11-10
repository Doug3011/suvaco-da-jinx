-- Function que gera o token de acesso (JWT) pro LiveKit Cloud, usado pra
-- entrar numa sala de voz via SFU em vez da mesh antiga de RTCPeerConnection.
--
-- As credenciais do LiveKit NÃO ficam neste arquivo (vai pro git, que é
-- público) - ficam no Vault do Supabase. Antes de rodar o resto, rode isso
-- UMA VEZ no SQL Editor (sem salvar em arquivo nenhum):
--
--   select vault.create_secret('<livekit api key>', 'livekit_api_key');
--   select vault.create_secret('<livekit api secret>', 'livekit_api_secret');
--
-- O JWT é construído à mão (header/payload base64url + HMAC-SHA256 via
-- pgcrypto) porque não dá pra rodar o SDK oficial do LiveKit dentro do
-- Postgres. O formato exato (quais campos, nomes de canPublishSources etc)
-- foi conferido batendo contra um token gerado pelo SDK oficial
-- (livekit-server-sdk) e validado com jwt.verify + o TokenVerifier oficial
-- (o mesmo verificador que o servidor real do LiveKit roda) antes de
-- considerar certo - não é formato "chutado".
--
-- Pegadinha que custou um tempo pra achar: encode(bytea, 'base64') do
-- Postgres quebra linha a cada 76 caracteres (formato MIME, com \n
-- embutido no meio da string) - sem remover isso, o "base64url" resultante
-- fica com newline no meio e vira um JWT inválido/ilegível, mesmo com o
-- resto da lógica (HMAC, troca de +/ por -_, etc) certa.

create extension if not exists pgcrypto;

create or replace function public.base64url_encode(data bytea)
returns text
language sql
immutable
as $$
  select replace(replace(replace(replace(encode(data, 'base64'), chr(10), ''), chr(13), ''), '+', '-'), '/', '_');
$$;

create or replace function public.get_livekit_token(p_channel_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  api_key text;
  api_secret text;
  ch public.channels;
  disp_name text;
  header_b64 text;
  payload_b64 text;
  signature_b64 text;
  identity text;
begin
  -- sem essa checagem, qualquer autenticado poderia entrar na sala de voz
  -- de QUALQUER servidor só sabendo o id do canal.
  select * into ch from public.channels where id = p_channel_id;
  if ch is null or ch.type <> 'voice' or not public.is_member_of_channel(p_channel_id) then
    raise exception 'sem acesso a esse canal de voz';
  end if;

  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'livekit_api_key';
  select decrypted_secret into api_secret from vault.decrypted_secrets where name = 'livekit_api_secret';
  if api_key is null or api_secret is null then
    raise exception 'LiveKit não configurado (faltam segredos no Vault)';
  end if;

  identity := auth.uid()::text;
  select display_name into disp_name from public.profiles where id = auth.uid();

  header_b64 := rtrim(public.base64url_encode(convert_to('{"alg":"HS256"}', 'utf8')), '=');
  payload_b64 := rtrim(public.base64url_encode(convert_to(
    jsonb_build_object(
      'iss', api_key,
      'sub', identity,
      'name', coalesce(disp_name, 'Convidado'),
      'nbf', extract(epoch from now())::bigint - 60,
      'exp', extract(epoch from now())::bigint + 43200,
      'video', jsonb_build_object(
        'room', 'voice-' || p_channel_id::text,
        'roomJoin', true,
        'canPublish', true,
        'canSubscribe', true,
        'canPublishData', true,
        'canPublishSources', jsonb_build_array('camera', 'microphone', 'screen_share', 'screen_share_audio')
      )
    )::text, 'utf8')), '=');

  signature_b64 := rtrim(public.base64url_encode(
    extensions.hmac(convert_to(header_b64 || '.' || payload_b64, 'utf8'), convert_to(api_secret, 'utf8'), 'sha256')), '=');

  return header_b64 || '.' || payload_b64 || '.' || signature_b64;
end;
$$;

revoke all on function public.get_livekit_token(uuid) from public;
grant execute on function public.get_livekit_token(uuid) to authenticated;
