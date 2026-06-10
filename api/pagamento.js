// POST /api/pagamento
// Cria um pedido (status "pending") na tabela `pedidos` e gera uma
// Preferência de pagamento no Mercado Pago (Checkout Pro), retornando
// o link (init_point) para redirecionar o cliente.

const { MercadoPagoConfig, Preference } = require('mercadopago');
const { getSupabaseAdmin } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const {
      pacoteId,
      pacoteDestino,
      pacoteHotel,
      preco,
      clienteNome,
      clienteEmail,
      clienteTelefone,
      passageiros,
    } = body;

    if (!preco || !clienteNome || !clienteTelefone) {
      return res.status(400).json({ error: 'Dados obrigatórios ausentes (preco, clienteNome, clienteTelefone)' });
    }

    if (!Array.isArray(passageiros) || passageiros.length < 1) {
      return res.status(400).json({ error: 'Dados dos passageiros ausentes' });
    }
    for (const p of passageiros) {
      if (!p || !p.nome || !p.sobrenome || !p.nascimento || !p.cpf) {
        return res.status(400).json({ error: 'Preencha nome, sobrenome, data de nascimento e CPF de todos os passageiros' });
      }
    }

    const valor = Number(preco);
    if (!isFinite(valor) || valor <= 0) {
      return res.status(400).json({ error: 'Preço inválido' });
    }

    const supabase = getSupabaseAdmin();

    // 1) Cria o pedido como "pending"
    const { data: pedido, error: insertErr } = await supabase
      .from('pedidos')
      .insert({
        pacote_id: pacoteId ? String(pacoteId) : null,
        pacote_destino: pacoteDestino || null,
        pacote_hotel: pacoteHotel || null,
        valor,
        cliente_nome: clienteNome,
        cliente_email: clienteEmail || null,
        cliente_telefone: clienteTelefone,
        passageiros,
        status: 'pending',
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // 2) Cria a Preferência no Mercado Pago
    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) throw new Error('MP_ACCESS_TOKEN não configurado');

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://aviagemteencontra.com.br';

    const mpClient = new MercadoPagoConfig({ accessToken });
    const preference = new Preference(mpClient);

    const result = await preference.create({
      body: {
        items: [
          {
            id: String(pacoteId || pedido.id),
            title: `${pacoteDestino || 'Pacote de viagem'}${pacoteHotel ? ' - ' + pacoteHotel : ''}${pacoteId ? ` (Pacote #${pacoteId})` : ''}`,
            description: pacoteId ? `ID do pacote: ${pacoteId}` : undefined,
            quantity: 1,
            unit_price: valor,
            currency_id: 'BRL',
          },
        ],
        payer: {
          name: clienteNome,
          email: clienteEmail || undefined,
          phone: clienteTelefone ? { number: String(clienteTelefone) } : undefined,
        },
        back_urls: {
          success: `${baseUrl}/?status=approved&pedido=${pedido.id}`,
          pending: `${baseUrl}/?status=pending&pedido=${pedido.id}`,
          failure: `${baseUrl}/?status=failure&pedido=${pedido.id}`,
        },
        auto_return: 'approved',
        notification_url: `${baseUrl}/api/webhook`,
        external_reference: pedido.id,
        statement_descriptor: 'MESQUITA TURISMO',
        payment_methods: {
          installments: 12,
        },
      },
    });

    // 3) Salva o preference_id no pedido
    const { error: updateErr } = await supabase
      .from('pedidos')
      .update({ mp_preference_id: result.id })
      .eq('id', pedido.id);

    if (updateErr) console.error('[pagamento] erro ao salvar mp_preference_id:', updateErr);

    return res.status(200).json({
      pedidoId: pedido.id,
      preferenceId: result.id,
      initPoint: result.init_point,
    });
  } catch (err) {
    console.error('[pagamento] erro:', err);
    return res.status(500).json({ error: 'Erro ao processar pagamento', details: String(err && err.message || err) });
  }
};
