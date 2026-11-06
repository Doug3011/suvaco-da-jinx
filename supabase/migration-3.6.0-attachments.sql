-- v3.6.0: metadados de anexo (arquivo/foto/vídeo) nas mensagens.
-- O ARQUIVO em si NUNCA passa por aqui nem pelo Storage — só metadados
-- leves, do mesmo tamanho que uma mensagem de texto já ocupa hoje. A
-- entrega do arquivo de verdade é P2P (WebRTC DataChannel) direto entre
-- quem mandou e quem baixa, só enquanto quem mandou estiver com o app
-- aberto.

alter table public.messages
  add column if not exists attachment_id uuid,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size bigint,
  add column if not exists attachment_kind text;

alter table public.direct_messages
  add column if not exists attachment_id uuid,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size bigint,
  add column if not exists attachment_kind text;
