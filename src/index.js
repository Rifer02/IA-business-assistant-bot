import { Bot, InlineKeyboard, Keyboard, session } from 'grammy';
import { config } from './config.js';
import business, { money, escapeHtml, findItem } from './business.js';
import { askAI } from './ai.js';
import { initSheets, appendOrder, getOrders } from './sheets.js';
import { cartLines, cartCount, cartTotals, cartToItemsString, newOrderId } from './orders.js';
import { buildDailySummary, startScheduler } from './report.js';
import { computeStats, dayKey, formatStats } from './stats.js';

const bot = new Bot(config.telegramToken);

// ---------------------------------------------------------------------------
// Session: per-chat state kept in memory (cart, checkout step, AI chat history)
// step: idle | awaiting_address | awaiting_notes | confirming | saving
// ---------------------------------------------------------------------------
const freshSession = () => ({
  cart: {},
  step: 'idle',
  orderType: null,
  address: '',
  notes: '',
  history: [],
});
bot.use(session({ initial: freshSession }));

const isAdmin = (ctx) => config.adminIds.includes(ctx.from?.id);

// Simple sliding-window limiter so one user cannot burn the AI quota.
const aiHits = new Map();
function allowAI(userId, limit = 8, windowMs = 60_000) {
  const now = Date.now();
  const recent = (aiHits.get(userId) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  aiHits.set(userId, recent);
  return true;
}

// ---------------------------------------------------------------------------
// Keyboards and message builders
// ---------------------------------------------------------------------------
const mainKeyboard = new Keyboard()
  .text('🍕 Order now')
  .text('📖 Menu')
  .row()
  .text('🛒 My cart')
  .text('🕒 Info')
  .resized();

function menuKeyboard(cart) {
  const kb = new InlineKeyboard();
  for (const item of business.menu) {
    kb.text(`${item.name} · ${money(item.price)}`, `add:${item.id}`).row();
  }
  const count = cartCount(cart);
  kb.text(count ? `🛒 View cart (${count})` : '🛒 View cart', 'cart');
  return kb;
}

function cartKeyboard() {
  return new InlineKeyboard()
    .text('➕ Add more', 'menu')
    .text('🗑 Clear', 'clear')
    .row()
    .text('✅ Checkout', 'checkout');
}

function cartText(cart) {
  const lines = cartLines(cart);
  if (lines.length === 0) return '🛒 Your cart is empty. Tap <b>Order now</b> to start.';
  const body = lines
    .map((l) => `• ${l.qty} × ${escapeHtml(l.item.name)} — ${money(l.subtotal)}`)
    .join('\n');
  return `🛒 <b>Your cart</b>\n\n${body}\n\nSubtotal: <b>${money(cartTotals(cart).subtotal)}</b>`;
}

function summaryText(s) {
  const totals = cartTotals(s.cart, s.orderType);
  const lines = cartLines(s.cart)
    .map((l) => `• ${l.qty} × ${escapeHtml(l.item.name)} — ${money(l.subtotal)}`)
    .join('\n');
  const parts = [`🧾 <b>Order summary</b>\n\n${lines}\n`];
  parts.push(`Type: <b>${s.orderType}</b>`);
  if (s.orderType === 'Delivery') {
    parts.push(`Address: ${escapeHtml(s.address)}`);
    parts.push(`Delivery fee: ${money(totals.deliveryFee)}`);
  }
  if (s.notes) parts.push(`Notes: ${escapeHtml(s.notes)}`);
  parts.push(`\nTotal: <b>${money(totals.total)}</b>`);
  parts.push(`Payment: ${escapeHtml(business.payment)}`);
  return parts.join('\n');
}

function infoText() {
  const hours = Object.entries(business.hours)
    .map(([days, time]) => `${days}: ${time}`)
    .join('\n');
  return (
    `🍕 <b>${escapeHtml(business.name)}</b>\n` +
    `📍 ${escapeHtml(business.address)}\n` +
    `📞 ${escapeHtml(business.phone)}\n\n` +
    `<b>Hours</b>\n${escapeHtml(hours)}\n\n` +
    `🛵 Delivery: ${business.delivery.time}, ${business.delivery.area} (${money(business.delivery.fee)})\n` +
    `🥡 Pickup: ready in ${business.pickupTime}\n\n` +
    `Ask me anything about the menu, ingredients or delivery!`
  );
}

async function showMenu(ctx) {
  if (ctx.session.step !== 'confirming') ctx.session.step = 'idle';
  await ctx.reply('📖 <b>Menu</b> — tap an item to add it to your cart:', {
    parse_mode: 'HTML',
    reply_markup: menuKeyboard(ctx.session.cart),
  });
}

async function showSummary(ctx) {
  ctx.session.step = 'confirming';
  await ctx.reply(summaryText(ctx.session), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('✅ Confirm order', 'confirm').text('❌ Cancel', 'cancel'),
  });
}

function resetOrder(s) {
  s.cart = {};
  s.step = 'idle';
  s.orderType = null;
  s.address = '';
  s.notes = '';
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
bot.command('start', async (ctx) => {
  const name = escapeHtml(ctx.from?.first_name || 'there');
  await ctx.reply(
    `👋 Hi ${name}! Welcome to <b>${escapeHtml(business.name)}</b>.\n\n` +
      `I can show you the menu, answer your questions and take your order. ` +
      `Just type a question or use the buttons below.`,
    { parse_mode: 'HTML', reply_markup: mainKeyboard },
  );
});

bot.command('help', (ctx) =>
  ctx.reply(
    'Commands:\n/menu - see the menu\n/order - start an order\n/cart - view your cart\n/cancel - cancel your order\n/info - hours and contact\n\nOr just ask me a question!',
  ),
);

bot.command(['menu', 'order'], showMenu);
bot.command('cart', (ctx) =>
  ctx.reply(cartText(ctx.session.cart), { parse_mode: 'HTML', reply_markup: cartKeyboard() }),
);
bot.command('info', (ctx) => ctx.reply(infoText(), { parse_mode: 'HTML' }));
bot.command('cancel', async (ctx) => {
  resetOrder(ctx.session);
  await ctx.reply('Order cancelled. Send /order whenever you want to start again.');
});
bot.command('myid', (ctx) => ctx.reply(`Your Telegram ID: ${ctx.from.id}`));

// Admin only
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('This command is for the business owner only.');
  try {
    const orders = await getOrders();
    const stats = computeStats(orders, dayKey(new Date(), config.timezone), config.timezone);
    await ctx.reply(
      `📈 Today so far (${stats.date})\n\n${formatStats(stats, business.currency)}\n\nUse /summary for the AI report.`,
    );
  } catch (error) {
    console.error('[admin] stats failed:', error.message);
    await ctx.reply('Could not read the orders sheet right now.');
  }
});

bot.command('summary', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('This command is for the business owner only.');
  await ctx.replyWithChatAction('typing');
  try {
    const { stats, text } = await buildDailySummary();
    await ctx.reply(`📊 AI summary - ${stats.date}\n\n${text}`);
  } catch (error) {
    console.error('[summary] failed:', error.message);
    await ctx.reply('Could not build the summary right now.');
  }
});

// ---------------------------------------------------------------------------
// Keyboard buttons
// ---------------------------------------------------------------------------
bot.hears(['🍕 Order now', '📖 Menu'], showMenu);
bot.hears('🛒 My cart', (ctx) =>
  ctx.reply(cartText(ctx.session.cart), { parse_mode: 'HTML', reply_markup: cartKeyboard() }),
);
bot.hears('🕒 Info', (ctx) => ctx.reply(infoText(), { parse_mode: 'HTML' }));

// ---------------------------------------------------------------------------
// Inline buttons (cart, checkout and confirmation)
// ---------------------------------------------------------------------------
bot.on('callback_query:data', async (ctx) => {
  const s = ctx.session;
  const data = ctx.callbackQuery.data;

  if (data.startsWith('add:')) {
    const item = findItem(data.slice(4));
    if (!item) return ctx.answerCallbackQuery({ text: 'Item not found' });
    s.cart[item.id] = (s.cart[item.id] || 0) + 1;
    await ctx.answerCallbackQuery({ text: `Added ${item.name}` });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: menuKeyboard(s.cart) });
    } catch {
      /* message not modified - ignore */
    }
    return;
  }

  switch (data) {
    case 'menu':
      await ctx.answerCallbackQuery();
      return showMenu(ctx);

    case 'cart':
      await ctx.answerCallbackQuery();
      return ctx.reply(cartText(s.cart), { parse_mode: 'HTML', reply_markup: cartKeyboard() });

    case 'clear':
      s.cart = {};
      await ctx.answerCallbackQuery({ text: 'Cart cleared' });
      return ctx.editMessageText(cartText(s.cart), { parse_mode: 'HTML' });

    case 'checkout':
      if (cartCount(s.cart) === 0) return ctx.answerCallbackQuery({ text: 'Your cart is empty' });
      await ctx.answerCallbackQuery();
      return ctx.reply('How would you like to receive your order?', {
        reply_markup: new InlineKeyboard()
          .text('🥡 Pickup', 'type:Pickup')
          .text(`🛵 Delivery (+${money(business.delivery.fee)})`, 'type:Delivery'),
      });

    case 'type:Pickup':
    case 'type:Delivery':
      if (cartCount(s.cart) === 0) return ctx.answerCallbackQuery({ text: 'Your cart is empty' });
      await ctx.answerCallbackQuery();
      s.orderType = data.slice(5);
      if (s.orderType === 'Delivery') {
        s.step = 'awaiting_address';
        return ctx.reply('📍 Please send your delivery address (street, number, floor/apartment).');
      }
      s.step = 'awaiting_notes';
      return askNotes(ctx);

    case 'skip_notes':
      await ctx.answerCallbackQuery();
      if (s.step !== 'awaiting_notes') return;
      s.notes = '';
      return showSummary(ctx);

    case 'cancel':
      resetOrder(s);
      await ctx.answerCallbackQuery({ text: 'Order cancelled' });
      return ctx.reply('Order cancelled. Send /order whenever you want to start again.');

    case 'confirm':
      return confirmOrder(ctx);

    default:
      return ctx.answerCallbackQuery();
  }
});

function askNotes(ctx) {
  return ctx.reply('📝 Any special requests? (extra cheese, no onion, ring the bell...) Send a message or skip.', {
    reply_markup: new InlineKeyboard().text('Skip', 'skip_notes'),
  });
}

async function confirmOrder(ctx) {
  const s = ctx.session;
  if (s.step !== 'confirming' || cartCount(s.cart) === 0) {
    return ctx.answerCallbackQuery({ text: 'Nothing to confirm' });
  }
  await ctx.answerCallbackQuery();
  s.step = 'saving'; // blocks double taps while we write to Google Sheets

  const totals = cartTotals(s.cart, s.orderType);
  const order = {
    id: newOrderId(new Date(), config.timezone),
    timestamp: new Date().toISOString(),
    customer: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Unknown',
    telegramId: ctx.from.id,
    items: cartToItemsString(s.cart),
    type: s.orderType,
    address: s.address,
    notes: s.notes,
    total: totals.total,
    status: 'New',
  };

  try {
    await appendOrder(order);
  } catch (error) {
    console.error('[order] could not save to Google Sheets:', error.message);
    s.step = 'confirming';
    return ctx.reply('⚠️ Something went wrong saving your order. Please tap Confirm again in a moment.');
  }

  const eta = order.type === 'Delivery' ? business.delivery.time : business.pickupTime;
  await ctx.reply(
    `🎉 <b>Order confirmed!</b>\n\nOrder ID: <code>${order.id}</code>\nTotal: <b>${money(order.total)}</b>\nEstimated time: ${eta}\n\nThank you, ${escapeHtml(ctx.from.first_name || '')}!`,
    { parse_mode: 'HTML' },
  );

  for (const adminId of config.adminIds) {
    bot.api
      .sendMessage(
        adminId,
        `🔔 New ${order.type} order ${order.id}\n${order.items}\nTotal: ${money(order.total)}\nCustomer: ${order.customer}${order.address ? `\nAddress: ${order.address}` : ''}${order.notes ? `\nNotes: ${order.notes}` : ''}`,
      )
      .catch((e) => console.error('[order] admin notification failed:', e.message));
  }

  resetOrder(s);
}

// ---------------------------------------------------------------------------
// Free text: checkout steps first, otherwise the AI assistant answers
// ---------------------------------------------------------------------------
bot.on('message:text', async (ctx) => {
  const s = ctx.session;
  const text = ctx.message.text.trim();

  if (s.step === 'awaiting_address') {
    if (text.length < 5) return ctx.reply('That address looks too short. Please send the full address.');
    s.address = text.slice(0, 200);
    s.step = 'awaiting_notes';
    return askNotes(ctx);
  }

  if (s.step === 'awaiting_notes') {
    s.notes = text.slice(0, 300);
    return showSummary(ctx);
  }

  if (!allowAI(ctx.from.id)) {
    return ctx.reply('You are sending messages very fast. Please wait a few seconds and try again.');
  }

  await ctx.replyWithChatAction('typing');
  const answer = await askAI(text.slice(0, 500), s.history);
  s.history.push({ role: 'user', text: text.slice(0, 500) }, { role: 'model', text: answer });
  s.history = s.history.slice(-8);
  await ctx.reply(answer);
});

bot.catch((err) => console.error('[bot] unhandled error:', err.error?.message || err));

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function main() {
  await initSheets();
  startScheduler(bot);

  await bot.api.setMyCommands([
    { command: 'order', description: 'Start an order' },
    { command: 'menu', description: 'See the menu' },
    { command: 'cart', description: 'View your cart' },
    { command: 'info', description: 'Hours and contact' },
    { command: 'cancel', description: 'Cancel current order' },
  ]);

  process.once('SIGINT', () => bot.stop());
  process.once('SIGTERM', () => bot.stop());

  await bot.start({
    onStart: (info) => console.log(`[bot] @${info.username} is running for "${business.name}"`),
  });
}

main().catch((error) => {
  console.error('Fatal startup error:', error.message);
  process.exit(1);
});
