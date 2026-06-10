// POST /api/reserva
// Cria um pedido com status "reserva_solicitada" (sem gerar cobrança no
// Mercado Pago) e envia um e-mail interno para o financeiro com todos os
// dados do cliente/passageiros, para que a reserva seja feita offline e o
// link de pagamento (parcelado sem juros) seja enviado ao cliente depois.

const { getSupabaseAdmin } = require('./_lib/supabase');
const { sendReservaNotification } = require('./_lib/email');

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
        status: 'reserva_solicitada',
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // Notifica o financeiro para gerar a reserva offline e enviar o link de pagamento
    await sendReservaNotification(pedido);

    return res.status(200).json({ pedidoId: pedido.id, status: pedido.status });
  } catch (err) {
    console.error('[reserva] erro:', err);
    return res.status(500).json({ error: 'Erro ao solicitar reserva', details: String(err && err.message || err) });
  }
};
