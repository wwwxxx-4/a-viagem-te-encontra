// Helper de envio de e-mail de confirmação de compra via Resend.
// Importado por api/webhook.js e api/reprocessar.js (bundlado pelo @vercel/node).

const { Resend } = require('resend');

function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

async function sendConfirmationEmail(pedido) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY não configurada — pulando envio de e-mail');
    return { skipped: true };
  }

  const resend = new Resend(apiKey);

  const fromAddress = process.env.RESEND_FROM || 'A Viagem te Encontra <pedidos@aviagemteencontra.com.br>';

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
      <h2 style="color:#0d6efd">Pagamento confirmado! 🎉</h2>
      <p>Olá, ${escapeHtml(pedido.cliente_nome || '')}!</p>
      <p>Recebemos a confirmação do seu pagamento. Em breve nossa equipe entrará em contato para finalizar os detalhes da sua viagem.</p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee"><strong>Pacote</strong></td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${escapeHtml(pedido.pacote_destino || '')}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee"><strong>Hotel</strong></td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${escapeHtml(pedido.pacote_hotel || '')}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee"><strong>Valor</strong></td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${formatBRL(pedido.valor)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee"><strong>Pedido</strong></td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">#${escapeHtml(String(pedido.id).slice(0, 8))}</td>
        </tr>
        <tr>
          <td style="padding:8px 0"><strong>ID do pacote</strong></td>
          <td style="padding:8px 0;text-align:right">${escapeHtml(pedido.pacote_id || '-')}</td>
        </tr>
      </table>

      <p>Qualquer dúvida, é só responder este e-mail ou falar com a gente pelo WhatsApp.</p>
      <p style="margin-top:24px;color:#666;font-size:13px">A Viagem te Encontra — Mesquita Turismo</p>
    </div>
  `;

  try {
    const result = await resend.emails.send({
      from: fromAddress,
      to: pedido.cliente_email,
      subject: `Pagamento confirmado — ${pedido.pacote_destino || 'sua viagem'}`,
      html,
    });
    return result;
  } catch (err) {
    console.error('[email] erro ao enviar e-mail de confirmação:', err);
    return { error: String(err) };
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { sendConfirmationEmail };
