// POST /api/reprocessar  { "pedido": "<id>" }
// Reprocessa um pedido manualmente: busca o status atual do pagamento no
// Mercado Pago (usando mp_payment_id ou mp_preference_id salvos) e reaplica
// a mesma lógica idempotente do webhook (atualiza status + envia e-mail
// se for o caso). Útil quando uma notificação do MP se perde.
//
// Protegida por DIAGNOSTICO_TOKEN (env var) — passe { "token": "..." } no body.

const { MercadoPagoConfig, Payment, MerchantOrder } = require('mercadopago');
const { getSupabaseAdmin } = require('./_lib/supabase');
const { sendConfirmationEmail } = require('./_lib/email');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const requiredToken = process.env.DIAGNOSTICO_TOKEN;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (requiredToken && body.token !== requiredToken) {
      return res.status(401).json({ error: 'Não autorizado' });
    }

    const { pedido: pedidoId, paymentId: paymentIdOverride } = body;
    if (!pedidoId) {
      return res.status(400).json({ error: 'Informe "pedido" (id) no corpo da requisição' });
    }

    const supabase = getSupabaseAdmin();
    const { data: pedido, error: fetchErr } = await supabase
      .from('pedidos')
      .select('*')
      .eq('id', pedidoId)
      .single();

    if (fetchErr || !pedido) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) throw new Error('MP_ACCESS_TOKEN não configurado');

    const mpClient = new MercadoPagoConfig({ accessToken });
    const paymentApi = new Payment(mpClient);

    let paymentId = paymentIdOverride || pedido.mp_payment_id;

    // Se ainda não temos um payment_id, tenta localizar via merchant_order da preference
    if (!paymentId && pedido.mp_preference_id) {
      try {
        const merchantOrderApi = new MerchantOrder(mpClient);
        const search = await merchantOrderApi.search({
          options: { preference_id: pedido.mp_preference_id },
        });
        const order = search?.elements?.[0];
        const firstPayment = order?.payments?.[0];
        if (firstPayment) paymentId = firstPayment.id;
      } catch (searchErr) {
        console.warn('[reprocessar] não foi possível buscar merchant_order:', searchErr);
      }
    }

    if (!paymentId) {
      return res.status(200).json({ pedido, ignored: 'Nenhum pagamento encontrado no Mercado Pago para este pedido' });
    }

    const payment = await paymentApi.get({ id: paymentId });
    const novoStatus = mapMpStatus(payment.status);
    const statusAnterior = pedido.status;

    const { error: updateErr } = await supabase
      .from('pedidos')
      .update({ status: novoStatus, mp_payment_id: String(payment.id) })
      .eq('id', pedido.id);

    if (updateErr) throw updateErr;

    let emailEnviadoAgora = false;
    if (novoStatus === 'approved' && statusAnterior !== 'approved' && !pedido.email_enviado) {
      const emailResult = await sendConfirmationEmail({ ...pedido, status: novoStatus, mp_payment_id: String(payment.id) });
      if (!emailResult || !emailResult.error) {
        await supabase.from('pedidos').update({ email_enviado: true }).eq('id', pedido.id);
        emailEnviadoAgora = true;
      }
    }

    return res.status(200).json({
      pedidoId: pedido.id,
      statusAnterior,
      statusAtual: novoStatus,
      mpPaymentId: payment.id,
      emailEnviadoAgora,
    });
  } catch (err) {
    console.error('[reprocessar] erro:', err);
    return res.status(500).json({ error: 'Erro ao reprocessar pedido', details: String(err && err.message || err) });
  }
};

function mapMpStatus(mpStatus) {
  switch (mpStatus) {
    case 'approved': return 'approved';
    case 'pending': return 'pending';
    case 'in_process': return 'in_process';
    case 'rejected': return 'rejected';
    case 'cancelled': return 'cancelled';
    case 'refunded': return 'refunded';
    case 'charged_back': return 'refunded';
    default: return mpStatus || 'pending';
  }
}
