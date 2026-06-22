-- Adiciona o campo "produto" na tabela posts, para diferenciar
-- pacotes completos (hotel+aéreo) de passagens aéreas somente (preço por pessoa).
-- Execute no SQL Editor do Supabase.

alter table public.posts
  add column if not exists produto text not null default 'pacote';

-- Valores aceitos: 'pacote' (preço para 2 pessoas, padrão) | 'passagem' (preço por pessoa)
-- Ao cadastrar uma passagem aérea somente, defina produto = 'passagem'.
