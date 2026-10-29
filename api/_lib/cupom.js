// Confere o cupom no servidor antes de gravar o pedido (/api/pagamento e /api/reserva).
// A regra (validade, usos, fornecedor, destino, hotel, embarque) mora na função
// cupom_validar do banco (migration 066 do painel); a vitrine usa a mesma função.
// Aqui também se confere o valor: com cupom, o preço enviado não pode ficar
// abaixo do preço do pacote com o desconto.

async function conferirCupom(supabase, code, pacoteId, valor) {
  const { data: r, error } = await supabase.rpc('cupom_validar', { p_code: String(code), p_pacote: pacoteId ? String(pacoteId) : null });
  if (error) throw error;
  if (!pacoteId) return { erro: 'Este cupom não é válido para este pacote.' };
  if (!r || !r.ok) return { erro: (r && r.mensagem) || 'Cupom inválido. Verifique o código.' };

  const { data: post, error: postErr } = await supabase.from('posts').select('preco,produto').eq('id', pacoteId).single();
  if (postErr) throw postErr;
  const passagem = String(post.produto || 'pacote').trim().toLowerCase() === 'passagem';
  const esperado = Math.round(Math.round(Number(post.preco)) * (1 - r.pct / 100)) * (passagem ? 2 : 1);
  if (valor < esperado - 2) return { erro: 'O valor do pacote mudou. Atualize a página e tente de novo.' };
  return { cupom: r.code };
}

async function registrarUso(supabase, code) {
  const { data, error } = await supabase.rpc('cupom_registrar_uso', { p_code: code });
  if (error || !data) console.error('[cupom] uso não registrado:', code, error || 'limite atingido');
}

module.exports = { conferirCupom, registrarUso };
