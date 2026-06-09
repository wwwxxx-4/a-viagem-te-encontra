// POST /api/webhook
// Recebe notificações do Mercado Pago (Checkout Pro). Busca o pagamento,
// localiza o pedido pelo external_reference (= pedidos.id) e atualiza o
// status de forma idempotente, enviando e-mail de confirmação apenas na
// primeira vez que o pedido passa a "approved".

const { MercadoPagoConfig, Payment } = require('mercadopago');
const { getSupabaseAdmin } = require('./_lib/supabase');
const { sendConfirmationEmail } = require('./_lib/email');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    // O MP envia diferentes formatos: { type: 'payment', data: { id } } ou via query (?topic=payment&id=...)
    const paymentId =
      (body && body.data && body.data.id) ||
      (req.query && (req.query['data.id'] || req.query.id)) ||
      null;

    const topic = (body && body.type) || (req.query && req.query.topic) || null;

    if (topic && topic !== 'payment') {
      // Ignora outros tipos de notificação (ex: merchant_order)
      return res.status(200).json({ received: true, ignored: topic });
    }

    if (!paymentId) {
      return res.status(200).json({ received: true, ignored: 'no payment id' });
    }

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) throw new Error('MP_ACCESS_TOKEN não configurado');

    const mpClient = new MercadoPagoConfig({ accessToken });
    const paymentApi = new Payment(mpClient);
    const payment = await paymentApi.get({ id: paymentId });

    const pedidoId = payment.external_reference;
    if (!pedidoId) {
      return res.status(200).json({ received: true, ignored: 'no external_reference' });
    }

    const supabase = getSupabaseAdmin();

    const { data: pedido, error: fetchErr } = await supabase
      .from('pedidos')
      .select('*')
      .eq('id', pedidoId)
      .single();

    if (fetchErr || !pedido) {
      console.error('[webhook] pedido não encontrado:', pedidoId, fetchErr);
      return res.status(200).json({ received: true, ignored: 'pedido não encontrado' });
    }

    const novoStatus = mapMpStatus(payment.status);
    const statusAnterior = pedido.status;

    // Atualiza status + mp_payment_id
    const { error: updateErr } = await supabase
      .from('pedidos')
      .update({
        status: novoStatus,
        mp_payment_id: String(payment.id),
      })
      .eq('id', pedido.id);

    if (updateErr) throw updateErr;

    // Idempotência: só envia e-mail se o pedido ESTÁ se tornando "approved" agora
    // (não estava approved antes e ainda não foi enviado)
    if (novoStatus === 'approved' && statusAnterior !== 'approved' && !pedido.email_enviado) {
      const emailResult = await sendConfirmationEmail({ ...pedido, status: novoStatus, mp_payment_id: String(payment.id) });
      if (!emailResult || !emailResult.error) {
        await supabase.from('pedidos').update({ email_enviado: true }).eq('id', pedido.id);
      }
    }

    return res.status(200).json({ received: true, pedidoId: pedido.id, status: novoStatus });
  } catch (err) {
    console.error('[webhook] erro:', err);
    // Retorna 200 mesmo em erro para evitar retentativas excessivas do MP em loop
    // (o /api/diagnostico e /api/reprocessar permitem corrigir manualmente depois)
    return res.status(200).json({ received: true, error: String(err && err.message || err) });
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
