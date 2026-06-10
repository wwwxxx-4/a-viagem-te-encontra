-- Migração: adiciona dados de passageiros e torna e-mail opcional / telefone obrigatório
-- Execute no SQL Editor do Supabase SE a tabela "pedidos" já existia
-- (criada pelo create_pedidos.sql original, antes desta atualização).

alter table public.pedidos
  add column if not exists passageiros jsonb;

alter table public.pedidos
  alter column cliente_email drop not null;

alter table public.pedidos
  alter column cliente_telefone set not null;
