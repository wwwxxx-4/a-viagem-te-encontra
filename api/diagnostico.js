// GET /api/diagnostico?pedido=<id>  ou  ?payment=<mp_payment_id>
// Rota de apoio para depurar pedidos: mostra o registro salvo no Supabase
// e, se houver mp_payment_id (ou for informado via query), o status atual
// direto no Mercado Pago — útil para comparar e identificar webhooks perdidos.
//
// Protegida por DIAGNOSTICO_TOKEN (env var) — passe ?token=... na query.

const { MercadoPagoConfig, Payment } = require('mercadopago');
const { getSupabaseAdmin } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const requiredToken = process.env.DIAGNOSTICO_TOKEN;
  if (requiredToken && req.query.token !== requiredToken) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  try {
    const { pedido: pedidoId, payment: paymentIdQuery } = req.query;

    if (!pedidoId && !paymentIdQuery) {
      return res.status(400).json({ error: 'Informe ?pedido=<id> ou ?payment=<mp_payment_id>' });
    }

    const supabase = getSupabaseAdmin();

    let query = supabase.from('pedidos').select('*');
    query = pedidoId ? query.eq('id', pedidoId) : query.eq('mp_payment_id', String(paymentIdQuery));

    const { data: pedido, error } = await query.maybeSingle();
    if (error) throw error;

    if (!pedido) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    let mpPayment = null;
    const paymentId = paymentIdQuery || pedido.mp_payment_id;

    if (paymentId) {
      const accessToken = process.env.MP_ACCESS_TOKEN;
      if (accessToken) {
        try {
          const mpClient = new MercadoPagoConfig({ accessToken });
          const paymentApi = new Payment(mpClient);
          const payment = await paymentApi.get({ id: paymentId });
          mpPayment = {
            id: payment.id,
            status: payment.status,
            status_detail: payment.status_detail,
            external_reference: payment.external_reference,
            transaction_amount: payment.transaction_amount,
            date_approved: payment.date_approved,
          };
        } catch (mpErr) {
          mpPayment = { error: String(mpErr && mpErr.message || mpErr) };
        }
      }
    }

    return res.status(200).json({ pedido, mpPayment });
  } catch (err) {
    console.error('[diagnostico] erro:', err);
    return res.status(500).json({ error: 'Erro ao buscar diagnóstico', details: String(err && err.message || err) });
  }
};
