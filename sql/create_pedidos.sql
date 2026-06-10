-- Tabela de pedidos (pagamentos via Mercado Pago) para "A Viagem te Encontra"
-- Execute no SQL Editor do Supabase (mesmo projeto da tabela "posts")

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),

  -- Dados do pacote no momento da compra (snapshot, evita depender de "posts" mudar depois)
  pacote_id text,
  pacote_destino text,
  pacote_hotel text,
  valor numeric(10,2) not null,

  -- Dados do cliente
  cliente_nome text not null,
  cliente_email text,
  cliente_telefone text not null,

  -- Dados dos passageiros: [{ nome, sobrenome, nascimento, cpf }, ...]
  passageiros jsonb,

  -- Status do pedido: pending | approved | rejected | cancelled | in_process | refunded
  status text not null default 'pending',

  -- IDs do Mercado Pago
  mp_preference_id text,
  mp_payment_id text,

  -- Controle de envio de e-mail de confirmação (evita duplicidade)
  email_enviado boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índices para busca rápida pelo webhook/diagnóstico
create index if not exists idx_pedidos_mp_payment_id on public.pedidos (mp_payment_id);
create index if not exists idx_pedidos_mp_preference_id on public.pedidos (mp_preference_id);
create index if not exists idx_pedidos_status on public.pedidos (status);

-- Trigger para manter updated_at sempre atualizado
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_pedidos_updated_at on public.pedidos;
create trigger trg_pedidos_updated_at
  before update on public.pedidos
  for each row execute function public.set_updated_at();

-- RLS: habilitamos, mas SEM policies públicas.
-- As funções serverless usam a SERVICE_ROLE_KEY, que ignora RLS — então
-- nenhum acesso direto via anon key (frontend) será permitido. Mais seguro.
alter table public.pedidos enable row level security;
