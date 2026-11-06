-- v3.12.1: adiciona server_members na publicação do Realtime. Sem isso, o
-- postgres_changes que o app usa pra saber "alguém novo entrou/saiu do
-- servidor" nunca dispara, e quem já está com o servidor aberto nunca
-- atualiza a lista de membros (bug: "só eu apareço no servidor").

alter publication supabase_realtime add table public.server_members;
