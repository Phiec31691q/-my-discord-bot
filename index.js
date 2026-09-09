/* ============================================================
   JARM v2 — FULL-SUITE DISCORD BOT | Discord.js v14
   AI Chat + Kayıt + Kurulum + Guard + Level + Ticket + Mod
   JXRM Studio • Developer: 217i • Verification Ready
   ============================================================ */
require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, Collection, REST, Routes, ActivityType,
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, AttachmentBuilder, AuditLogEvent
} = require('discord.js');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ============================ CONFIG ============================ */
const config = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  devGuild: process.env.DEV_GUILD_ID || null,
  port: parseInt(process.env.PORT || '8080', 10),
  owners: (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
  colors: { primary: 0xF5C542, success: 0x57F287, error: 0xED4245, warn: 0xFEE75C, gold: 0xFFB830, purple: 0x9D5CFF, ai: 0x00E5FF, guard: 0xE74C3C }
};

/* ============================ JSON-LITE DB ============================ */
const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
let dbCache = {};
try { dbCache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { dbCache = {}; }
let dbTimer = null;
function dbPersist() { if (dbTimer) return; dbTimer = setTimeout(() => { dbTimer = null; try { fs.writeFileSync(DB_FILE, JSON.stringify(dbCache, null, 2)); } catch (e) { console.error('[DB]', e.message); } }, 400); }
function dbWalk(key, create) { const parts = key.split('.'); let node = dbCache; for (let i = 0; i < parts.length - 1; i++) { const p = parts[i]; if (node[p] == null || typeof node[p] !== 'object') { if (!create) return null; node[p] = {}; } node = node[p]; } return { node, last: parts[parts.length - 1] }; }
const db = {
  get(k, d = null) { const w = dbWalk(k, false); if (!w) return d; const v = w.node[w.last]; return v === undefined ? d : v; },
  set(k, v) { const w = dbWalk(k, true); w.node[w.last] = v; dbPersist(); return v; },
  add(k, n) { return this.set(k, (Number(this.get(k, 0)) || 0) + n); },
  push(k, v) { const a = this.get(k, []); if (!Array.isArray(a)) return this.set(k, [v]); a.push(v); return this.set(k, a); },
  delete(k) { const w = dbWalk(k, false); if (!w) return false; delete w.node[w.last]; dbPersist(); return true; },
  has(k) { return this.get(k, undefined) !== undefined; },
  startsWith(prefix) { return Object.keys(dbCache).filter(k => k.startsWith(prefix)).map(k => [k, dbCache[k]]); }
};

/* ============================ EMBED / YARDIMCILAR ============================ */
const base = (c = config.colors.primary) => new EmbedBuilder().setColor(c).setTimestamp();
const ok = (t) => base(config.colors.success).setDescription(`✅ ${t}`);
const err = (t) => base(config.colors.error).setDescription(`❌ ${t}`);
const info = (t) => base(config.colors.primary).setDescription(t);
function jEmbed(client, c = config.colors.primary) { return base(c).setFooter({ text: 'Jarm • JXRM Studio', iconURL: client.user.displayAvatarURL() }).setThumbnail(client.user.displayAvatarURL({ size: 256 })); }
function hasPerms(i, p = []) { const m = i.member; if (!m) return false; if (m.permissions.has(PermissionFlagsBits.Administrator)) return true; return m.permissions.has(p); }
async function deny(i, t) { const p = { content: `❌ ${t}`, flags: MessageFlags.Ephemeral }; if (i.replied || i.deferred) await i.followUp(p); else await i.reply(p); }
function hierarchyOk(i, t) { const g = i.guild; if (t.id === g.ownerId) return false; if (i.user.id === g.ownerId) return true; if (i.member.roles.highest.position <= t.roles.highest.position) return false; if (g.members.me.roles.highest.position <= t.roles.highest.position) return false; return true; }
function split2000(t) { const out = []; while (t.length > 2000) { let cut = t.lastIndexOf('\n', 2000); if (cut < 500) cut = t.lastIndexOf(' ', 2000); if (cut < 500) cut = 2000; out.push(t.slice(0, cut)); t = t.slice(cut).trim(); } if (t) out.push(t); return out; }
function bar(cur, max, len = 10) { const p = Math.max(0, Math.min(1, cur / max)); const f = Math.round(p * len); return '▰'.repeat(f) + '▱'.repeat(len - f); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* ============================ TRANSKRIPT ============================ */
async function buildTranscript(channel, meta) {
  const msgs = []; let lastId;
  for (let i = 0; i < 3; i++) { const o = { limit: 100 }; if (lastId) o.before = lastId; const b = await channel.messages.fetch(o).catch(() => null); if (!b || !b.size) break; msgs.push(...b.values()); lastId = b.lastKey(); if (b.size < 100) break; }
  msgs.reverse();
  const rows = msgs.map(m => `<div class="m"><span class="t">[${new Date(m.createdTimestamp).toLocaleString('tr-TR')}]</span> <b>${esc(m.author.tag)}</b>: ${esc(m.content || '')}</div>`).join('\n');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{background:#1e1f22;color:#dbdee1;font-family:sans-serif;padding:24px}.m{padding:5px;border-bottom:1px solid #2b2d31}.t{color:#949ba4;font-size:12px}b{color:#f5c542}</style></head><body><h1>Ticket: ${esc(channel.name)}</h1><h3>Kategori: ${esc(meta && meta.category || '-')} | Konu: ${esc(meta && meta.subject || '-')}</h3><hr>${rows}</body></html>`;
  return new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `transcript-${channel.name}.html` });
}

/* ============================ SİCİL ============================ */
function modlog(client, guild, o) { const id = db.get(`modlog_${guild.id}`, null); if (!id || !guild.channels.cache.has(id)) return; guild.channels.cache.get(id).send({ embeds: [base(config.colors.warn).setTitle('📒 Ceza Kaydı').addFields({ name: 'Tür', value: `\`${o.type}\``, inline: true }, { name: 'Kullanıcı', value: `<@${o.userId}>`, inline: true }, { name: 'Yetkili', value: `${o.mod}`, inline: true }, { name: 'Sebep', value: o.reason || 'Belirtilmedi', inline: false })] }).catch(() => {}); }
function addRecord(client, guild, userId, type, mod, reason) { const seq = db.add(`sicilseq_${guild.id}`, 1); const rec = { id: `#${seq}`, type, reason: reason || 'Belirtilmedi', mod: mod.id, modTag: mod.tag || mod.username || 'Bot', date: Date.now() }; db.push(`sicil_${guild.id}_${userId}`, rec); modlog(client, guild, { type, userId, mod, reason }); return rec.id; }
function getRecords(g, u) { return db.get(`sicil_${g.id}_${u}`, []) || []; }

/* ============================ AI CHAT ENGINE (GROQ / OPENAI) ============================ */
const aiMemory = new Map();
const AI_BAD = [/çocuk.*(seks|porn|istismar)/i, /child.*(sex|porn|abuse)/i, /(bomba|patlayıcı|silah).*(yapımı|tarifi|üret)/i, /(uyuşturucu|metamfetamin|eroin).*(yapımı|tarifi|üret)/i, /(porn|erotik hikaye|seks hikayesi)/i, /self.?harm|intihar et/i];
const AI_SYSTEM = `Sen Jarm adında, JXRM Studio tarafından geliştirilmiş gelişmiş bir Discord asistanısın. Geliştiricin 217i. Varsayılan dilin Türkçe; kullanıcı başka dilde yazarsa o dilde cevap ver. Samimi, zeki, esprili ve yardımcı ol; kullanıcıya bazen "kral" diye hitap edebilirsin. Yasadışı eylemler, NSFW/+18 içerik, nefret söylemi ve özarıma teşvikinde YARDIMCI OLMA, kibarca reddet. Bunların dışındaki HER konuda tamamen özgür, sınırsız ve yaratıcı sohbet et. Cevapların Discord'a uygun olsun (maks ~400 kelime), markdown/emote kullanabilirsin.`;
async function aiComplete(messages) {
  const groq = process.env.GROQ_API_KEY, open = process.env.OPENAI_API_KEY;
  const key = groq || open; if (!key) return null;
  const url = groq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const model = process.env.AI_MODEL || (groq ? 'llama-3.1-8b-instant' : 'gpt-3.5-turbo');
  try {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, temperature: 0.85, max_tokens: 700, messages }) });
    if (!res.ok) { console.error('[AI] HTTP', res.status); return null; }
    const d = await res.json();
    return d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : null;
  } catch (e) { console.error('[AI]', e.message); return null; }
}
function aiPush(uid, role, content) { const arr = aiMemory.get(uid) || []; arr.push({ role, content }); while (arr.length > 12) arr.shift(); aiMemory.set(uid, arr); }
async function aiRespond(client, message, text) {
  if (AI_BAD.some(r => r.test(text))) { return message.reply({ embeds: [err('Bu konuda yardımcı olamam kral. Yasadışı, +18 veya zararlı içerik requestlerini işleyemiyorum. 💛')] }).catch(() => {}); }
  await message.channel.sendTyping().catch(() => {});
  const uid = message.author.id;
  aiPush(uid, 'user', text);
  const msgs = [{ role: 'system', content: AI_SYSTEM }, ...(aiMemory.get(uid) || [])];
  const answer = await aiComplete(msgs);
  if (!answer) return message.reply({ embeds: [err('AI motoruna ulaşılamadı. `.env` dosyasına `GROQ_API_KEY` eklendiğinden emin ol.')] }).catch(() => {});
  aiPush(uid, 'assistant', answer);
  const chunks = split2000(answer);
  for (let i = 0; i < chunks.length; i++) {
    const emb = jEmbed(client, config.colors.ai).setDescription(chunks[i]);
    if (i === 0) emb.setAuthor({ name: `Jarm AI • ${message.author.username} için`, iconURL: message.author.displayAvatarURL() });
    await message.channel.send({ embeds: [emb] }).catch(() => {});
  }
}

/* ============================ LEVEL SİSTEMİ ============================ */
const xpCooldown = new Map();
function xpData(g, u) { return db.get(`xp_${g}_${u}`, null) || { xp: 0, level: 0, msgs: 0 }; }
function levelFor(xp) { return Math.floor(0.12 * Math.sqrt(xp)); }
function xpForLevel(l) { return Math.pow(l / 0.12, 2); }
async function giveXp(client, message) {
  const key = `${message.guild.id}_${message.author.id}`;
  const now = Date.now();
  if ((xpCooldown.get(key) || 0) + 60000 > now) return;
  xpCooldown.set(key, now);
  const d = xpData(message.guild.id, message.author.id);
  const gain = 15 + Math.floor(Math.random() * 11);
  d.xp += gain; d.msgs++;
  const oldLvl = d.level; const newLvl = levelFor(d.xp); d.level = newLvl;
  db.set(`xp_${message.guild.id}_${message.author.id}`, d);
  if (newLvl > oldLvl) {
    const roles = db.get(`levelroles_${message.guild.id}`, null) || {};
    const rid = roles[String(newLvl)];
    if (rid && message.guild.roles.cache.has(rid)) await message.member.roles.add(rid, 'Seviye ödülü').catch(() => {});
    await message.channel.send({ embeds: [jEmbed(client, config.colors.gold).setTitle('🎉 SEVİYE ATLADIN!').setDescription(`${message.member}, **${newLvl}. seviyeye** ulaştın! Tebrikler kral. 🏆`)] }).catch(() => {});
  }
}

/* ============================ GUARD (KORUMA) ============================ */
const nukeTracker = new Map();
const joinTracker = new Map();
const snipes = new Map();
function guardCfg(g) { return db.get(`guard_${g.id}`, null) || { enabled: { nuke: true, raid: true, role: true }, whitelist: [], log: null }; }
function guardAllowed(guild, executorId) {
  if (executorId === guild.ownerId || executorId === guild.members.me.id) return true;
  const cfg = guardCfg(guild);
  if (cfg.whitelist.includes(executorId)) return true;
  const m = guild.members.cache.get(executorId);
  if (!m) return false;
  if (m.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return m.roles.cache.some(r => cfg.whitelist.includes(r.id));
}
async function guardPunish(client, guild, executorId, action) {
  const cfg = guardCfg(guild);
  const member = guild.members.cache.get(executorId);
  if (member && member.moderatable) { await member.roles.set([], 'GUARD: Yetkisiz işlem').catch(() => {}); await member.ban({ reason: `GUARD: ${action}` }).catch(() => {}); }
  if (cfg.log && guild.channels.cache.has(cfg.log)) {
    guild.channels.cache.get(cfg.log).send({ embeds: [base(config.colors.guard).setTitle('🚨 GUARD MÜDAHALESİ').setDescription(`**<@${executorId}>** yetkisiz \`${action}\` işlemi denedi.\n➜ Rolleri alındı ve banlandı.`)] }).catch(() => {});
  }
}
async function guardCount(client, guild, executorId, action) {
  const key = `${guild.id}_${executorId}`;
  const arr = (nukeTracker.get(key) || []).filter(t => Date.now() - t < 10000);
  arr.push(Date.now()); nukeTracker.set(key, arr);
  if (arr.length >= 3) { nukeTracker.set(key, []); await guardPunish(client, guild, executorId, action); }
  else if (cfg_log(guild)) notifyGuard(guild, executorId, action, arr.length);
}
function cfg_log(g) { const c = guardCfg(g); return c.log && g.channels.cache.has(c.log) ? g.channels.cache.get(c.log) : null; }
function notifyGuard(guild, executorId, action, count) { const ch = cfg_log(guild); if (!ch) return; ch.send({ embeds: [base(config.colors.guard).setTitle('⚠️ Guard Uyarısı').setDescription(`<@${executorId}> → \`${action}\` (10sn içinde ${count}/3)`)] }).catch(() => {}); }

/* ============================ TICKET HELPERS ============================ */
const CATEGORIES = [
  { value: 'Destek', label: 'Destek', desc: 'Genel destek talepleri', color: config.colors.primary },
  { value: 'Sikayet', label: 'Şikayet', desc: 'Oyuncu/üye şikayetleri', color: config.colors.error },
  { value: 'VIP', label: 'VIP / Satış', desc: 'Satın alım & VIP', color: config.colors.gold },
  { value: 'Basvuru', label: 'Yetkili Başvurusu', desc: 'Staff başvuruları', color: config.colors.success }
];
const catOf = v => CATEGORIES.find(c => c.value === v) || CATEGORIES[0];
async function openTicketModal(i, cat) {
  const c = catOf(cat);
  const m = new ModalBuilder().setCustomId(`ticket_modal:${c.value}`).setTitle(`Ticket • ${c.label}`);
  m.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('t_subject').setLabel('Konu').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('t_detail').setLabel('Detay').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
  await i.showModal(m);
}
async function createTicket(client, i) {
  const cat = i.customId.split(':')[1] || 'Destek';
  const subject = i.fields.getTextInputValue('t_subject'), detail = i.fields.getTextInputValue('t_detail');
  const g = i.guild;
  const ex = db.get(`ticket_open_${g.id}_${i.user.id}`, null);
  if (ex && g.channels.cache.has(ex)) return i.reply({ embeds: [err(`Zaten açık ticketin var: <#${ex}>`)], flags: MessageFlags.Ephemeral });
  const staff = db.get(`ticket_staff_${g.id}`, null);
  const safe = i.user.username.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) || 'kullanici';
  const ow = [
    { id: g.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: g.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }];
  if (staff && g.roles.cache.has(staff)) ow.push({ id: staff, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  const ch = await g.channels.create({ name: `ticket-${safe}`, type: ChannelType.GuildText, topic: `Ticket | Sahip: ${i.user.id} | Kategori: ${cat}`, permissionOverwrites: ow });
  db.set(`ticket_${ch.id}`, { owner: i.user.id, category: cat, subject, detail, openedAt: Date.now(), added: [], locked: false });
  db.set(`ticket_open_${g.id}_${i.user.id}`, ch.id);
  const c = catOf(cat);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('t_close').setLabel('Kapat').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('t_lock').setLabel('Kilitle').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('t_transcript').setLabel('Transkript').setStyle(ButtonStyle.Secondary));
  await ch.send({ content: `${i.user}${staff ? ` <@&${staff}>` : ''}`, embeds: [jEmbed(client, c.color).setTitle(`🎫 ${c.label} Ticket`).setDescription(`**Konu:** ${subject}\n**Detay:** ${detail}`)], components: [row] });
  await i.reply({ embeds: [ok(`Ticket oluşturuldu: ${ch}`)], flags: MessageFlags.Ephemeral });
}
async function askClose(i) {
  await i.reply({ embeds: [info('Ticketi kapatmak istediğine emin misin? Transkript loga gider.')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('t_close_yes').setLabel('Evet, Kapat').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('t_close_no').setLabel('Vazgeç').setStyle(ButtonStyle.Secondary))], flags: MessageFlags.Ephemeral });
}
async function closeTicket(i, yes) {
  if (!yes) return i.update({ embeds: [info('Kapatma iptal.')], components: [], flags: MessageFlags.Ephemeral });
  const ch = i.channel, meta = db.get(`ticket_${ch.id}`, null);
  const logId = db.get(`ticket_log_${ch.guild.id}`, null);
  const log = logId ? ch.guild.channels.cache.get(logId) : null;
  if (log) { const att = await buildTranscript(ch, meta); await log.send({ embeds: [base(config.colors.error).setTitle('🔒 Ticket Kapatıldı').addFields({ name: 'Sahip', value: meta ? `<@${meta.owner}>` : '-', inline: true }, { name: 'Kapatan', value: `${i.user}`, inline: true })], files: [att] }).catch(() => {}); }
  if (meta) db.delete(`ticket_open_${ch.guild.id}_${meta.owner}`);
  db.delete(`ticket_${ch.id}`);
  await i.update({ embeds: [ok('Ticket kapatılıyor...')], components: [] });
  setTimeout(() => ch.delete().catch(() => {}), 4000);
}
async function setLock(i, lock) {
  const ch = i.channel, meta = db.get(`ticket_${ch.id}`, null);
  if (!meta) return deny(i, 'Bu bir ticket kanalı değil.');
  for (const uid of [meta.owner, ...(meta.added || [])]) await ch.permissionOverwrites.edit(uid, { SendMessages: lock ? false : null }).catch(() => {});
  meta.locked = lock; db.set(`ticket_${ch.id}`, meta);
  await i.update({ components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('t_close').setLabel('Kapat').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(lock ? 't_unlock' : 't_lock').setLabel(lock ? 'Kilidi Aç' : 'Kilitle').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('t_transcript').setLabel('Transkript').setStyle(ButtonStyle.Secondary))] });
  await i.followUp({ embeds: [ok(lock ? 'Ticket kilitlendi.' : 'Kilit açıldı.')], flags: MessageFlags.Ephemeral });
}
async function handleTranscript(i) {
  const ch = i.channel, meta = db.get(`ticket_${ch.id}`, null);
  const log = db.get(`ticket_log_${ch.guild.id}`, null);
  if (!log || !ch.guild.channels.cache.has(log)) return deny(i, 'Log kanalı yok.');
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const att = await buildTranscript(ch, meta);
  await ch.guild.channels.cache.get(log).send({ content: `📄 ${ch.name} — ${i.user}`, files: [att] });
  await i.editReply({ embeds: [ok('Transkript gönderildi.')] });
}

/* ============================ KAYIT SİSTEMİ ============================ */
async function applyRegistration(client, guild, member, data, gender, staff) {
  const cfg = db.get(`kayit_${guild.id}`, null);
  if (!cfg) throw new Error('Kayıt sistemi kurulu değil (/kayıt-sistem).');
  const tag = cfg.tag || '';
  const nick = `${tag} ${data.name} | ${data.age}`.slice(0, 32);
  await member.setNickname(nick, 'Kayıt sistemi').catch(() => {});
  const remove = [cfg.kayitsiz].filter(Boolean);
  const add = [gender === 'm' ? cfg.erkek : cfg.kadin, cfg.uye].filter(Boolean);
  for (const r of remove) if (guild.roles.cache.has(r)) await member.roles.remove(r, 'Kayıt').catch(() => {});
  for (const r of add) if (guild.roles.cache.has(r)) await member.roles.add(r, 'Kayıt').catch(() => {});
  const stats = db.get(`kayitstats_${guild.id}`, null) || { total: 0, m: 0, f: 0 };
  stats.total++; gender === 'm' ? stats.m++ : stats.f++;
  db.set(`kayitstats_${guild.id}`, stats);
  db.delete(`regpending_${guild.id}_${member.id}`);
  const logCh = cfg.log && guild.channels.cache.has(cfg.log) ? guild.channels.cache.get(cfg.log) : null;
  if (logCh) logCh.send({ embeds: [jEmbed(client, config.colors.success).setTitle('📝 KAYIT TAMAMLANDI').setDescription(`${member} başarıyla kaydedildi.`).addFields({ name: 'İsim', value: `\`${nick}\``, inline: true }, { name: 'Cinsiyet', value: gender === 'm' ? '♂ Erkek' : '♀ Kadın', inline: true }, { name: 'Yetkili', value: staff ? `${staff}` : 'Kendisi (Form)', inline: true })] }).catch(() => {});
  return nick;
}

/* ============================ POLL ============================ */
function pollEmbed(p) {
  const total = Object.values(p.votes).reduce((s, a) => s + a.length, 0);
  const emb = base(config.colors.purple).setTitle('🗳️ ' + p.question)
    .setDescription(p.opts.map((o, idx) => { const v = (p.votes[idx] || []).length; const pct = total ? Math.round(v / total * 100) : 0; return `**${idx + 1}.** ${o}\n${bar(pct, 100)} **%${pct}** (${v} oy)`; }).join('\n\n'))
    .setFooter({ text: `Toplam ${total} oy • Bitiş: <t:${Math.floor(p.ends / 1000)}:R>` });
  return emb;
}
function pollRow(p) { return [new ActionRowBuilder().addComponents(p.opts.map((o, idx) => new ButtonBuilder().setCustomId(`poll_${p.id}_${idx}`).setLabel(`${idx + 1}`).setStyle(ButtonStyle.Primary)))]; }

/* ============================ MATH PARSER ============================ */
function evalMath(expr) {
  const clean = expr.replace(/\s/g, '');
  const tokens = clean.match(/\d+\.?\d*|[+\-*/%^()]/g);
  if (!tokens || tokens.join('') !== clean) throw new Error('bad');
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };
  const out = [], ops = []; let prev = null;
  for (const t of tokens) {
    if (/^\d/.test(t)) out.push(parseFloat(t));
    else if (t === '(') ops.push(t);
    else if (t === ')') { while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()); if (!ops.length) throw new Error('bad'); ops.pop(); }
    else { if (t === '-' && (prev === null || prev === '(' || prec[prev])) out.push(0); while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t] && t !== '^') ops.pop(); ops.push(t); }
    prev = t;
  }
  while (ops.length) { const o = ops.pop(); if (o === '(') throw new Error('bad'); out.push(o); }
  const st = [];
  for (const t of out) {
    if (typeof t === 'number') st.push(t);
    else { const b = st.pop(), a = st.pop(); if (a === undefined || b === undefined) throw new Error('bad'); st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : t === '/' ? a / b : t === '%' ? a % b : Math.pow(a, b)); }
  }
  if (st.length !== 1 || !isFinite(st[0])) throw new Error('bad');
  return st[0];
}

/* ============================ KOMUTLAR ============================ */
const commands = [
  /* ---------- KURULUM (OTO-DESTEK-KUR) ---------- */
  {
    category: 'Kurulum',
    data: new SlashCommandBuilder().setName('kurulum').setDescription('Sunucuyu A\'dan Z\'ye otomatik kurar (roller, kanallar, ticket, AI, kayıt).')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(client, i) {
      if (!hasPerms(i, [PermissionFlagsBits.Administrator])) return deny(i, 'Yönetici gerekli.');
      await i.deferReply();
      const g = i.guild, me = g.members.me;
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || !me.permissions.has(PermissionFlagsBits.ManageChannels)) return i.editReply({ embeds: [err('Bana **Rol Yönet** ve **Kanal Yönet** yetkisi ver!')] });
      const R = {};
      const mkRole = async (name, color, perms) => { const r = await g.roles.create({ name, color, permissions: perms || [] , reason: 'Jarm Kurulum' }); R[name] = r; return r; };
      await mkRole('🛡️ Kurmay', 0xE74C3C, [PermissionFlagsBits.Administrator]);
      await mkRole('⚔️ Moderatör', 0x3498DB, [PermissionFlagsBits.KickMembers, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageNicknames]);
      await mkRole('🛠️ Destek Ekibi', 0x2ECC71, [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory]);
      await mkRole('💎 VIP', 0xF1C40F, []);
      await mkRole('🛡️ Guard Whitelist', 0x2C3E50, []);
      await mkRole('🌟 Üye', 0x95A5A6, []);
      await mkRole('♂ Erkek', 0x1F8BEB, []);
      await mkRole('♀ Kadın', 0xFF7EB9, []);
      await mkRole('• Kayıtsız', 0x7F8C8D, []);
      await mkRole('🌱 Seviye 5', 0x2ECC71, []); await mkRole('🌿 Seviye 10', 0x27AE60, []);
      await mkRole('🌳 Seviye 25', 0xF39C12, []); await mkRole('👑 Seviye 50', 0xE74C3C, []);
      const EV = g.roles.everyone.id;
      const mkCat = async (name, ow) => g.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites: ow });
      const mkCh = async (cat, name, topic, extra) => g.channels.create({ name, type: ChannelType.GuildText, parent: cat.id, topic: topic || null, permissionOverwrites: extra || [] });
      const catB = await mkCat('📌 BİLGİLENDİRME', [{ id: EV, deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads], allow: [PermissionFlagsBits.ViewChannel] }]);
      const catT = await mkCat('🌐 TOPLULUK', [{ id: EV, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }]);
      const catK = await mkCat('🚪 KAYIT', [{ id: EV, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel] }]);
      const catD = await mkCat('🎫 DESTEK', [{ id: EV, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel] }]);
      const catY = await mkCat('🔐 YETKİLİ', [{ id: EV, deny: [PermissionFlagsBits.ViewChannel] }, { id: R['⚔️ Moderatör'].id, allow: [PermissionFlagsBits.ViewChannel] }, { id: R['🛡️ Kurmay'].id, allow: [PermissionFlagsBits.ViewChannel] }, { id: R['🛠️ Destek Ekibi'].id, allow: [PermissionFlagsBits.ViewChannel] }]);
      const chKurallar = await mkCh(catB, '📋・kurallar', 'Sunucu kuralları');
      const chDuyuru = await mkCh(catB, '📢・duyurular', 'Resmi duyurular');
      const chOylama = await mkCh(catB, '🗳️・oylama', 'Anketler');
      const chSayac = await mkCh(catB, '📊・sayac', 'Üye sayacı');
      const chSohbet = await mkCh(catT, '💬・sohret'.replace('reh', 'h'), 'Genel sohbet');
      const chAI = await mkCh(catT, '🤖・jarm-ai', 'Jarm AI ile sohbet et (@Jarm)');
      const chMedya = await mkCh(catT, '🖼️・medya', 'Görsel/video paylaşımı');
      const chOyun = await mkCh(catT, '🎮・oyun-sohbet', 'Oyun muhabbeti');
      const chGiris = await mkCh(catK, '👋・hoşgeldin', 'Giriş kapısı');
      const chKayitLog = await mkCh(catK, '📝・kayıt-log', 'Kayıt logları', [{ id: R['🛠️ Destek Ekibi'].id, allow: [PermissionFlagsBits.ViewChannel] }]);
      const chTicket = await mkCh(catD, '🎫・destek-talepleri', 'Ticket paneli');
      const chTicketLog = await mkCh(catD, '📄・destek-log', 'Ticket transkriptleri', [{ id: R['🛠️ Destek Ekibi'].id, allow: [PermissionFlagsBits.ViewChannel] }]);
      const chYet = await mkCh(catY, '🛡️・yetkili-sohbet');
      const chMod = await mkCh(catY, '📚・mod-log');
      const chGuard = await mkCh(catY, '🚨・guard-log');
      /* DB bağları */
      db.set(`ticket_staff_${g.id}`, R['🛠️ Destek Ekibi'].id);
      db.set(`ticket_log_${g.id}`, chTicketLog.id);
      db.set(`welcome_${g.id}`, chGiris.id);
      db.set(`welcomelog_${g.id}`, chKayitLog.id);
      db.set(`modlog_${g.id}`, chMod.id);
      db.set(`ai_channels_${g.id}`, [chAI.id]);
      db.set(`otorol_${g.id}`, { member: R['• Kayıtsız'].id, bot: R['💎 VIP'].id });
      db.set(`kayit_${g.id}`, { kayitsiz: R['• Kayıtsız'].id, erkek: R['♂ Erkek'].id, kadin: R['♀ Kadın'].id, uye: R['🌟 Üye'].id, tag: '✦', log: chKayitLog.id });
      db.set(`guard_${g.id}`, { enabled: { nuke: true, raid: true, role: true }, whitelist: [R['🛡️ Kurmay'].id, R['🛡️ Guard Whitelist'].id], log: chGuard.id });
      db.set(`levelroles_${g.id}`, { '5': R['🌱 Seviye 5'].id, '10': R['🌿 Seviye 10'].id, '25': R['🌳 Seviye 25'].id, '50': R['👑 Seviye 50'].id });
      db.set(`sayac_${g.id}`, { channel: chSayac.id, target: 500 });
      db.set(`automod_${g.id}`, { kufur: true, reklam: true, link: false, caps: false, spam: true });
      /* Paneller */
      await chKurallar.send({ embeds: [jEmbed(client, config.colors.error).setTitle('📋 SUNUCU KURALLARI').setDescription('1️⃣ Saygı her şeydir; hakaret, taciz, nefret söylemi yasak.\n2️⃣ Reklam, davet linki ve spam yasak.\n3️⃣ +18 içerik kesinlikle yasak.\n4️⃣ Yetkililere etiketle saygılı davran.\n5️⃣ Kanal amacına uygun kullan.\n6️⃣ Bot komutlarını kötüye kullanma.\n\n⚖️ Kural ihlali = uyarı → mute → ban.')] });
      await chGiris.send({ embeds: [jEmbed(client, config.colors.success).setTitle('👋 GİRİŞ KAPISI').setDescription('Aramıza hoş geldin! Kayıt olmak için aşağıdaki butona bas ve formu doldur. **Oy yok, bekleme yok — anında kayıt!**')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('reg_start').setLabel('📝 Kayıt Ol').setStyle(ButtonStyle.Success))] });
      await chTicket.send({ embeds: [jEmbed(client, config.colors.primary).setTitle('🎫 DESTEK MERKEZİ').setDescription('Aşağıdan kategori seçerek ticket oluştur.')], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_select').setPlaceholder('Kategori seç...').addOptions(CATEGORIES.map(c => ({ label: c.label, value: c.value, description: c.desc }))))] });
      await chAI.send({ embeds: [jEmbed(client, config.colors.ai).setTitle('🤖 JARM AI SOHBET').setDescription('Burada **@Jarm** etiketleyerek benimle sınırsız sohbet edebilirsin kral! Belleğim var, bağlamı hatırlarım. 💬')] });
      await chDuyuru.send({ embeds: [jEmbed(client, config.colors.gold).setTitle('📢 DUYURU').setDescription('Sunucumuz Jarm v2 ile kuruldu! Tüm sistemler aktif. 🎉')] });
      await i.editReply({ embeds: [jEmbed(client, config.colors.success).setTitle('🏗️ KURULUM TAMAMLANDI').setDescription(`**${5} kategori, ${15} kanal, ${13} rol** oluşturuldu.\n✅ Ticket paneli • ✅ Kayıt kapısı • ✅ AI kanalı • ✅ Guard • ✅ Level rolleri • ✅ Oto-mod açık`)] });
    }
  },

  /* ---------- KAYIT ---------- */
  {
    category: 'Kayıt',
    data: new SlashCommandBuilder().setName('kayıt-sistem').setDescription('Kayıt sistemini manuel kurar/günceller.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addRoleOption(o => o.setName('kayitsiz').setDescription('Kayıtsız rolü').setRequired(true))
      .addRoleOption(o => o.setName('erkek').setDescription('Erkek rolü').setRequired(true))
      .addRoleOption(o => o.setName('kadin').setDescription('Kadın rolü').setRequired(true))
      .addRoleOption(o => o.setName('uye').setDescription('Kayıtlı üye rolü').setRequired(true))
      .addStringOption(o => o.setName('tag').setDescription('İsim önü tag (örn: ✦)').setMaxLength(5))
      .addChannelOption(o => o.setName('log').setDescription('Kayıt log kanalı')),
    async execute(client, i) {
      if (!hasPerms(i, [PermissionFlagsBits.ManageGuild])) return deny(i, 'Yetkin yok.');
      db.set(`kayit_${i.guild.id}`, {
        kayitsiz: i.options.getRole('kayitsiz').id, erkek: i.options.getRole('erkek').id,
        kadin: i.options.getRole('kadin').id, uye: i.options.getRole('uye').id,
        tag: i.options.getString('tag') || '', log: i.options.getChannel('log') ? i.options.getChannel('log').id : null
      });
      await i.reply({ embeds: [ok('Kayıt sistemi ayarlandı. `/kurulum` paneli veya `📝 Kayıt Ol` butonu aktif.')] });
    }
  },
  {
    category: 'Kayıt',
    data: new SlashCommandBuilder().setName('kayıt').setDescription('Yetkili: manuel kayıt yapar.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
      .addUserOption(o => o.setName('kullanici').setDescription('Üye').setRequired(true))
      .addStringOption(o => o.setName('isim').setDescription('İsim').setRequired(true).setMaxLength(20))
      .addIntegerOption(o => o.setName('yas').setDescription('Yaş').setRequired(true).setMinValue(8).setMaxValue(99))
      .addStringOption(o => o.setName('cinsiyet').setDescription('Cinsiyet').setRequired(true).addChoices({ name: 'Erkek', value: 'm' }, { name: 'Kadın', value: 'f' })),
    async execute(client, i) {
      if (!hasPerms(i, [PermissionFlagsBits.ManageNicknames])) return deny(i, 'Yetkin yok.');
      const member = await i.guild.members.fetch(i.options.getUser('kullanici').id).catch(() => null);
      if (!member) return deny(i, 'Üye bulunamadı.');
      try {
        const nick = await applyRegistration(client, i.guild, member, { name: i.options.getString('isim'), age: i.options.getInteger('yas') }, i.options.getString('cinsiyet'), i.user);
        await i.reply({ embeds: [ok(`${member} kaydedildi → \`${nick}\``)] });
      } catch (e) { await i.reply({ embeds: [err(e.message)] }); }
    }
  },
  {
    category: 'Kayıt',
    data: new SlashCommandBuilder().setName('kayıt-bilgi').setDescription('Kayıt istatistiklerini gösterir.'),
    async execute(client, i) {
      const s = db.get(`kayitstats_${i.guild.id}`, null) || { total: 0, m: 0, f: 0 };
      await i.reply({ embeds: [jEmbed(client, config.colors.primary).setTitle('📝 KAYIT İSTATİSTİKLERİ').addFields({ name: 'Toplam', value: `${s.total}`, inline: true }, { name: '♂ Erkek', value: `${s.m}`, inline: true }, { name: '♀ Kadın', value: `${s.f}`, inline: true })] });
    }
  },

  /* ---------- AI ---------- */
  {
    category: 'AI',
    data: new SlashCommandBuilder().setName('ai-kanal').setDescription('AI sohbet kanallarını yönetir.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption(o => o.setName('islem').setDescription('İşlem').setRequired(true).addChoices({ name: 'ekle', value: 'add' }, { name: 'sil', value: 'rem' }, { name: 'liste', value: 'list' }))
      .addChannelOption(o => o.setName('kanal').setDescription('Kanal')),
    async execute(client, i) {
      if (!hasPerms(i, [PermissionFlagsBits.ManageGuild])) return deny(i, 'Yetkin yok.');
      const op = i.options.getString('islem'), ch = i.options.getChannel('kanal');
      let list = db.get(`ai_channels_${i.guild.id}`, null) || [];
      if (op === 'add') { if (!ch) return deny(i, 'Kanal belirt.'); if (!list.includes(ch.id)) list.push(ch.id); db.set(`ai_channels_${i.guild.id}`, list); return i.reply({ embeds: [ok(`${ch} AI kanalı oldu.`)] }); }
      if (op === 'rem') { list = list.filter(x => x !== (ch ? ch.id : i.channel.id)); db.set(`ai_channels_${i.guild.id}`, list); return i.reply({ embeds: [ok('AI kanalı kaldırıldı.')] }); }
      return i.reply({ embeds: [info(list.length ? list.map(x => `<#${x}>`).join('\n') : 'AI kanalı yok.')] });
    }
  },
  {
    category: 'AI',
    data: new SlashCommandBuilder().setName('ai-sor').setDescription('Jarm AI\'a direkt soru sor.')
      .addStringOption(o => o.setName('soru').setDescription('Sorun').setRequired(true).setMaxLength(1000)),
    async execute(client, i) {
      await i.deferReply();
      const q = i.options.getString('soru');
      if (AI_BAD.some(r => r.test(q))) return i.editReply({ embeds: [err('Bu konuda yardımcı olamam.')] });
      aiPush(i.user.id, 'user', q);
      const ans = await aiComplete([{ role: 'system', content: AI_SYSTEM }, ...(aiMemory.get(i.user.id) || [])]);
      if (!ans) return i.editReply({ embeds: [err('AI motoruna ulaşılamadı (GROQ_API_KEY kontrol et).')] });
      aiPush(i.user.id, 'assistant', ans);
      await i.editReply({ embeds: split2000(ans).map((c, idx) => jEmbed(client, config.colors.ai).setDescription(c).setAuthor(idx === 0 ? { name: `Jarm AI • ${i.user.username}`, iconURL: i.user.displayAvatarURL() } : null)) });
    }
  },

  /* ---------- GUARD ---------- */
  {
    category: 'Guard',
    data: new SlashCommandBuilder().setName('guard').setDescription('Koruma sistemini yönetir.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(o => o.setName('islem').setDescription('İşlem').setRequired(true).addChoices({ name: 'durum', value: 'status' }, { name: 'toggle', value: 'toggle' }, { name: 'whitelist-ekle', value: 'wladd' }, { name: 'whitelist-sil', value: 'wlrem' }, { name: 'log', value: 'log' }))
      .addStringOption(o => o.setName('modul').setDescription('Modül').addChoices({ name: 'nuke', value: 'nuke' }, { name: 'raid', value: 'raid' }, { name: 'role', value: 'role' }))
      .addBooleanOption(o => o.setName('durum').setDescription('Aç/Kapat'))
      .addRoleOption(o => o.setName('rol').setDescription('Rol'))
      .addChannelOption(o => o.setName('kanal').setDescription('Log kanalı')),
    async execute(client, i) {
      if (!hasPerms(i, [PermissionFlagsBits.Administrator])) return deny(i, 'Yönetici gerekli.');
      const cfg = guardCfg(i.guild); const op = i.options.getString('islem');
      if (op === 'log') { cfg.log = i.options.getChannel('kanal').id; db.set(`guard_${i.guild.id}`, cfg); return i.reply({ embeds: [ok('Guard log ayarlandı.')] }); }
      if (op === 'toggle') { const m = i.options.getString('modul'), s = i.options.getBoolean('durum'); if (!m) return deny(i, 'Modül belirt.'); cfg.enabled[m] = s; db.set(`guard_${i.guild.id}`, cfg); return i.reply({ embeds: [ok(`Guard **${m}** ${s ? 'açıldı' : 'kapandı'}.`)] }); }
      if (op === 'wladd') { const r = i.options.getRole('rol'); if (!r) return deny(i, 'Rol belirt.'); if (!cfg.whitelist.includes(r.id)) cfg.whitelist.push(r.id); db.set(`guard_${i.guild.id}`, cfg); return i.reply({ embeds: [ok(`${r} whitelist'e eklendi.')] }); }
      if (op === 'wlrem') { const r = i.options.getRole('rol'); cfg.whitelist = cfg.whitelist.filter(x => x !== r.id); db.set(`guard_${i.guild.id}`, cfg); return i.reply({ embeds: [ok(`${r} çıkarıldı.')] }); }
      return i.reply({ embeds: [jEmbed(client, config.colors.guard).setTitle('🛡️ GUARD DURUMU').addFields({ name: 'Modüller', value: Object.entries(cfg.enabled).map(([k, v]) => `\`${k}\`: ${v ? '✅' : '❌'}`).join('\n'), inline: true }, { name: 'Whitelist', value: cfg.whitelist.map(x => `<@&${x}>`).join('\n') || '-', inline: true }, { name: 'Log', value: cfg.log ? `<#${cfg.log}>` : '-', inline: true })] });
    }
  },

  /* ---------- LEVEL ---------- */
  {
    category: 'Level',
    data: new SlashCommandBuilder().setName('level').setDescription('Seviye kartını gösterir.').addUserOption(o => o.setName('kullanici').setDescription('Üye')),
    async execute(client, i) {
      const u = i.options.getUser('kullanici') || i.user;
      const d = xpData(i.guild.id, u.id);
      const cur = d.xp - xpForLevel(d.level), need = xpForLevel(d.level + 1) - xpForLevel(d.level);
      await i.reply({ embeds: [jEmbed(client, config.colors.gold).setAuthor({ name: `${u.username} — Seviye Kartı`, iconURL: u.displayAvatarURL() }).setThumbnail(u.displayAvatarURL({ size: 512 })).addFields({ name: '🏆 Seviye', value: `**${d.level}**`, inline: true }, { name: '✨ XP', value: `${d.xp}`, inline: true }, { name: '💬 Mesaj', value: `${d.msgs}`, inline: true }, { name: 'İlerleme', value: `${bar(cur, need)} ${Math.round(cur / need * 100)}%`, inline: false })] });
    }
  },
  {
    category: 'Level',
    data: new SlashCommandBuilder().setName('liderlik').setDescription('Seviye sıralaması (top 10).'),
    async execute(client, i) {
      const rows = db.startsWith(`xp_${i.guild.id}_`).map(([k, v]) => ({ id: k.split('_')[2], ...v })).sort((a, b) => b.xp - a.xp).slice(0, 10);
      if (!rows.length) return i.reply({ embeds: [info('Henüz veri yok.')] });
      const medals = ['🥇', '🥈', '🥉'];
      await i.reply({ embeds: [jEmbed(client, config.colors.gold).setTitle('🏆 SEVİYE LİDERLİĞİ').setDescription(rows.map((r, idx) => `${medals[idx] || `**${idx + 1}.**`} <@${r.id}> — **Lv ${r.level}** (${r.xp} XP)`).join('\n'))] });
    }
  },
  {
    category: 'Level',
    data: new SlashCommandBuilder().setName('level-rol').setDescription('Seviye ödül rolleri.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addIntegerOption(o => o.setName('seviye').setDescription('Seviye').setRequired(true).setMinValue(1))
      .addRoleOption(o => o.setName('rol').setDescription('Rol (boş=sil)')),
    async execute(client, i) {
      if (!hasPerms(i, [PermissionFlagsBits.ManageRoles])) return deny(i, 'Yetkin yok.');
      const lvl = i.options.getInteger('seviye'), role = i.options.getRole('rol');
      const map = db.get(`levelroles_${i.guild.id}`, null) || {};
      if (role) map[String(lvl)] = role.id; else delete map[String(lvl)];
      db.set(`levelroles_${i.guild.id}`, map);
      await i.reply({ embeds: [ok(`Seviye ${lvl} → ${role || 'temizlendi'}`)] });
    }
  },

  /* ---------- EKSTRA (12+) ---------- */
  { category: 'Ekstra', data: new SlashCommandBuilder().setName('afk').setDescription('AFK moduna geçersin.').addStringOption(o => o.setName('sebep').setDescription('Sebep')), async execute(client, i) { db.set(`afk_${i.user.id}`, { r: i.options.getString('sebep') || 'Belirtilmedi', t: Date.now() }); await i.reply({ embeds: [ok(`AFK oldun: \`${i.options.getString('sebep') || 'Belirtilmedi'}\``)] }); } },
  { category: 'Ekstra', data: new SlashCommandBuilder().setName('snipe').setDescription('Kanalda silinen son mesajı gösterir.'), async execute(client, i) { const s = snipes.get(i.channel.id); if (!s) return i.reply({ embeds: [info('Bu kanalda silinmiş mesaj yok.')] }); await i.reply({ embeds: [jEmbed(client, config.colors.purple).setTitle('🕵️ SNIPED').setDescription(`**${s.tag}:** ${s.content || '(ek/içerik yok)'}\n<t:${Math.floor(s.t / 1000)}:R>`)] }); } },
  {
    category: 'Ekstra',
    data: new SlashCommandBuilder().setName('anket').setDescription('Butonlu anket oluşturur.')
      .addStringOption(o => o.setName('soru').setDescription('Soru').setRequired(true))
      .addStringOption(o => o.setName('secenekler').setDescription('A | B | C (max 5)').setRequired(true))
      .addIntegerOption(o => o.setName('dakika').setDescription('Süre').setMinValue(1).setMaxValue(1440)),
    async execute(client, i) {
      const opts = i.options.getString('secenekler').split('|').map(s => s.trim()).filter(Boolean).slice(0, 5);
      if (opts.length < 2) return deny(i, 'En az 2 seçenek (A | B).');
      const p = { id: crypto.randomBytes(4).toString('hex'), question: i.options.getString('soru'), opts, votes: {}, ends: Date.now() + (i.options.getInteger('dakika') || 60) * 60000, owner: i.user.id };
      db.set(`poll_${p.id}`, p);
      const msg = await i.channel.send({ embeds: [pollEmbed(p)], components: pollRow(p) });
      p.msg = msg.id; db.set(`poll_${p.id}`, p);
      await i.reply({ embeds: [ok('Anket oluşturuldu.')], flags: MessageFlags.Ephemeral });
    }
  },
  { category: 'Ekstra', data: new SlashCommandBuilder().setName('yazıtura').setDescription('Para atar.'), async execute(client, i) { const r = Math.random() < 0.5 ? 'YAZI' : 'TURA'; await i.reply({ embeds: [jEmbed(client, config.colors.gold).setTitle('🪙 PARA ATILDI').setDescription(`Sonuç: **${r}**!`)] }); } },
  { category: 'Ekstra', data: new SlashCommandBuilder().setName('zar').setDescription('Zar atar.').addIntegerOption(o => o.setName('yuz').setDescription('Yüz sayısı').setMinValue(2).setMaxValue(1000)), async execute(client, i) { const n = i.options.getInteger('yuz') || 6; const r = 1 + Math.floor(Math.random() * n); await i.reply({ embeds: [jEmbed(client, config.colors.primary).setTitle('🎲 ZAR').setDescription(`d${n} → **${r}**`)] }); } },
  { category: 'Ekstra', data: new SlashCommandBuilder().setName('8ball').setDescription('Sihirli küreye sor.').addStringOption(o => o.setName('soru').setDescription('Soru').setRequired(true)), async execute(client, i) { const a = ['Evet, kesinlikle.', 'Hayır, asla.', 'Büyük ihtimalle evet.', 'Şüpheli...', 'Kader senin elinde kral.', 'Yıldızlar evet diyor.', 'Bu konuda yorum yok.', 'Sabret, zaman gösterecek.']; await i.reply({ embeds: [jEmbed(client, config.colors.purple).setTitle('🎱 8-BALL').setDescription(`**S:** ${i.options.getString('soru')}\n**C:** ${a[Math.floor(Math.random() * a.length)]}`)] }); } },
  { category: 'Ekstra', data: new SlashCommandBuilder().setName('ship').setDescription('İki kişiyi shiple.').addUserOption(o => o.setName('kisi1').setDescription('1. kişi').setRequired(true)).addUserOption(o => o.setName('kisi2').setDescription('2. kişi').setRequired(true)), async execute(client, i) { const a = i.options.getUser('kisi1'), b = i.options.getUser('kisi2'); const h = crypto.createHash('md5').update(a.id + b.id).digest(); const pct = h.readUInt16BE(0) % 101; await i.reply({ embeds: [jEmbed(client, 0xFF7EB9).setTitle('💘 SHIP METRE').setDescription(`${a} ❤️ ${b}\n${bar(pct, 100)} **%${pct}** uyum!`)] }); } },
  { category: 'Ekstra', data: new SlashCommandBuilder().setName('matematik').setDescription('Güvenli matematik hesabı.').addStringOption(o => o.setName('islem').setDescription('Örn: (5+3)*2^2').setRequired(true)), async execute(client, i) { try { const r = evalMath(i.options.getString('islem')); await i.reply({ embeds: [jEmbed(client, config.colors.primary).setTitle('🧮 MATEMATİK').setDescription(`\`${i.options.getString('islem')} = ${r}\``)] }); } catch { await i.reply({ embeds: [err('Geçersiz ifade.')] }); } } },
  { category: 'Ekstra', data: new SlashCommandBuilder().setName('şifre').setDescription('Güçlü şifre üretir.').addIntegerOption(o => o.setName('uzunluk').setDescription('8-64').setMinValue(8).setMaxValue(64)), async execute(client, i) { const len = i.options.getInteger('uzunluk') || 16; const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*'; let s = ''; const rb = crypto.randomBytes(len); for (let x = 0; x < len; x++) s += chars[rb[x] % chars.length]; await i.reply({ embeds: [jEmbed(client, config.colors.success).setTitle('🔐 ŞİFRE').setDescription(`\`${s}\``)], flags: MessageFlags.Ephemeral }); } },
  { category: 'Ekstra', data: new SlashCommandBuilder().setName('renk').setDescription('Rastgele renk paleti üretir.'), async execute(client, i) { const hex = crypto.randomBytes(3).toString('hex'); await i.reply({ embeds: [new EmbedBuilder().setColor(parseInt(hex, 16)).setTitle('🎨 RENK').setDescription(`#${hex.toUpperCase()}`).setThumbnail(`https://singlecolorimage.com/get/${hex}/128x128`)] }); } },
  { category: 'Ekstra', data: new SlashCommandBuilder().setName('hatırlat').setDescription('Hatırlatıcı kurar.').addIntegerOption(o => o.setName('dakika').setDescription('Süre').setRequired(true).setMinValue(1).setMaxValue(10080)).addStringOption(o => o.setName('metin').setDescription('Ne hatırlatayım?').setRequired(true)), async execute(client, i) { const list = db.get('reminders', null) || []; list.push({ u: i.user.id, t: Date.now() + i.options.getInteger('dakika') * 60000, m: i.options.getString('metin') }); db.set('reminders', list); await i.reply({ embeds: [ok(`⏰ ${i.options.getInteger('dakika')} dakika sonra hatırlatacağım: \`${i.options.getString('metin')}\``)] }); } },
  {
    category: 'Ekstra',
    data: new SlashCommandBuilder().setName('profil').setDescription('Detaylı profil kartı.').addUserOption(o => o.setName('kullanici').setDescription('Üye')),
    async execute(client, i) {
      const m = i.options.getMember('kullanici') || i.member; const u = m.user;
      const d = xpData(i.guild.id, u.id); const warns = getRecords(i.guild, u.id).filter(r => r.type === 'WARN').length;
      const badges = []; if (d.level >= 10) badges.push('🏆'); if (d.msgs >= 500) badges.push('💬'); if (warns === 0) badges.push('😇'); if (u.bot) badges.push('🤖'); if (config.owners.includes(u.id)) badges.push('👑');
      await i.reply({ embeds: [jEmbed(client, config.colors.purple).setAuthor({ name: `${u.username} — Profil Kartı`, iconURL: u.displayAvatarURL() }).setImage(u.bannerURL ? u.bannerURL({ size: 512 }) : null).setThumbnail(u.displayAvatarURL({ size: 512 })).addFields(
        { name: '🆔 ID', value: `\`${u.id}\``, inline: true }, { name: '🏆 Seviye', value: `${d.level} (${d.xp} XP)`, inline: true }, { name: '⚠️ Uyarı', value: `${warns}`, inline: true },
        { name: '📅 Hesap', value: `<t:${Math.floor(u.createdTimestamp / 1000)}:R>`, inline: true }, { name: '🚪 Katılım', value: m.joinedTimestamp ? `<t:${Math.floor(m.joinedTimestamp / 1000)}:R>` : '-', inline: true }, { name: '🎖️ Rozetler', value: badges.join(' ') || '-', inline: true },
        { name: '🎭 Roller', value: m.roles.cache.filter(r => r.id !== i.guild.id).sort((a, b) => b.position - a.position).map(r => `${r}`).slice(0, 8).join(' ') || '-', inline: false })] });
    }
  },

  /* ---------- TICKET ---------- */
  { category: 'Ticket', data: new SlashCommandBuilder().setName('ticket-setup').setDescription('Ticket paneli kurar.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addRoleOption(o => o.setName('staff').setDescription('Yetkili rolü').setRequired(true)).addChannelOption(o => o.setName('log').setDescription('Log kanalı').setRequired(true)).addChannelOption(o => o.setName('panel').setDescription('Panel kanalı')), async execute(client, i) { db.set(`ticket_staff_${i.guild.id}`, i.options.getRole('staff').id); db.set(`ticket_log_${i.guild.id}`, i.options.getChannel('log').id); const p = i.options.getChannel('panel') || i.channel; await p.send({ embeds: [jEmbed(client).setTitle('🎫 DESTEK MERKEZİ').setDescription('Kategori seç, ticket açılsın.')], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_select').setPlaceholder('Kategori...').addOptions(CATEGORIES.map(c => ({ label: c.label, value: c.value, description: c.desc }))))] }); await i.reply({ embeds: [ok('Panel kuruldu.')], flags: MessageFlags.Ephemeral }); } },
  { category: 'Ticket', data: new SlashCommandBuilder().setName('ticket-add').setDescription('Tickete kullanıcı ekler.').addUserOption(o => o.setName('kullanici').setDescription('Üye').setRequired(true)), async execute(client, i) { const ch = i.channel; if (!ch.topic || !ch.topic.startsWith('Ticket |')) return deny(i, 'Ticket kanalı değil.'); const u = i.options.getUser('kullanici'); const meta = db.get(`ticket_${ch.id}`, null) || { added: [] }; await ch.permissionOverwrites.edit(u.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }); if (!meta.added.includes(u.id)) meta.added.push(u.id); db.set(`ticket_${ch.id}`, meta); await i.reply({ embeds: [ok(`${u} eklendi.`)] }); } },
  { category: 'Ticket', data: new SlashCommandBuilder().setName('ticket-remove').setDescription('Ticketten kullanıcı çıkarır.').addUserOption(o => o.setName('kullanici').setDescription('Üye').setRequired(true)), async execute(client, i) { const ch = i.channel; if (!ch.topic || !ch.topic.startsWith('Ticket |')) return deny(i, 'Ticket kanalı değil.'); const u = i.options.getUser('kullanici'); const meta = db.get(`ticket_${ch.id}`, null) || { added: [] }; await ch.permissionOverwrites.edit(u.id, { ViewChannel: false, SendMessages: false }); meta.added = meta.added.filter(x => x !== u.id); db.set(`ticket_${ch.id}`, meta); await i.reply({ embeds: [ok(`${u} çıkarıldı.`)] }); } },
  { category: 'Ticket', data: new SlashCommandBuilder().setName('ticket-close').setDescription('Ticketi kapatır.'), async execute(client, i) { if (!i.channel.topic || !i.channel.topic.startsWith('Ticket |')) return deny(i, 'Ticket kanalı değil.'); await askClose(i); } },

  /* ---------- MODERASYON ---------- */
  { category: 'Moderasyon', data: new SlashCommandBuilder().setName('ban').setDescription('Ban.').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).addUserOption(o => o.setName('kullanici').setDescription('Üye').setRequired(true)).addStringOption(o => o.setName('sebep').setDescription('Sebep')).addIntegerOption(o => o.setName('gun').setDescription('Mesaj silme günü 0-7').setMinValue(0).setMaxValue(7)), async execute(client, i) { if (!hasPerms(i, [PermissionFlagsBits.BanMembers])) return deny(i, 'Yetkin yok.'); const t = await i.guild.members.fetch(i.options.getUser('kullanici').id).catch(() => null); if (!t) return deny(i, 'Bulunamadı.'); if (!hierarchyOk(i, t)) return deny(i, 'Hiyerarşi.'); const r = i.options.getString('sebep') || 'Belirtilmedi'; await i.guild.members.ban(t.id, { deleteMessageSeconds: (i.options.getInteger('gun') ?? 0) * 86400, reason: r }); addRecord(client, i.guild, t.id, 'BAN', i.user, r); await i.reply({ embeds: [ok(`**${t.user.tag}** banlandı.`)] }); } },
  { category: 'Moderasyon', data: new SlashCommandBuilder().setName('unban').setDescription('Ban kaldırır.').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).addStringOption(o => o.setName('kullanici_id').setDescription('ID').setRequired(true)), async execute(client, i) { if (!hasPerms(i, [PermissionFlagsBits.BanMembers])) return deny(i, 'Yetkin yok.'); const id = i.options.getString('kullanici_id'); try { await i.guild.members.unban(id); addRecord(client, i.guild, id, 'UNBAN', i.user, ''); await i.reply({ embeds: [ok(`<@${id}> unban.`)] }); } catch { deny(i, 'Banlı değil.'); } } },
  { category: 'Moderasyon', data: new SlashCommandBuilder().setName('kick').setDescription('Kick.').setDefaultMemberPermissions(PermissionFlagsBits.KickMembers).addUserOption(o => o.setName('kullanici').setDescription('Üye').setRequired(true)).addStringOption(o => o.setName('sebep').setDescription('Sebep')), async execute(client, i) { if (!hasPerms(i, [PermissionFlagsBits.KickMembers])) return deny(i, 'Yetkin yok.'); const t = await i.guild.members.fetch(i.options.getUser('kullanici').id).catch(() => null); if (!t || !hierarchyOk(i, t)) return deny(i, 'Hiyerarşi/bulunamadı.'); const r = i.options.getString('sebep') || 'Belirtilmedi'; await t.kick(r); addRecord(client, i.guild, t.id, 'KICK', i.user, r); await i.reply({ embeds: [ok(`**${t.user.tag}** atıldı.`)] }); } },
  { category: 'Moderasyon', data: new SlashCommandBuilder().setName('timeout').setDescription('Susturur.').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName('kullanici').setDescription('Üye').setRequired(true)).addIntegerOption(o => o.setName('dakika').setDescription('Dakika').setRequired(true).setMinValue(1).setMaxValue(40320)).addStringOption(o => o.setName('sebep').setDescription('Sebep')), async execute(client, i) { if (!hasPerms(i, [PermissionFlagsBits.ModerateMembers])) return deny(i, 'Yetkin yok.'); const t = await i.guild.members.fetch(i.options.getUser('kullanici').id).catch(() => null); if (!t || !hierarchyOk(i, t) || !t.moderatable) return deny(i, 'Uygulanamaz.'); const m = i.options.getInteger('dakika'), r = i.options.getString('sebep') || 'Belirtilmedi'; await t.timeout(m * 60000, r); addRecord(client, i.guild, t.id, 'TIMEOUT', i.user, `${m}dk ${r}`); await i.reply({ embeds: [ok(`${t} ${m}dk susturuldu.`)] }); } },
  { category: 'Moderasyon', data: new SlashCommandBuilder().setName('untimeout').setDescription('Susturma kaldırır.').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName('kullanici').setDescription('Üye').setRequired(true)), async execute(client, i) { const t = await i.guild.members.fetch(i.options.getUser('kullanici').id).catch(() => null); if (!t || !t.isCommunicationDisabled()) return deny(i, 'Susturulmamış.'); await t.timeout(null); await i.reply({ embeds: [ok('Açıldı.')] }); } },
  { category: 'Moderasyon', data: new SlashCommandBuilder().setName('warn').setDescription('Uyarır.').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName('kullanici').setDescription('Üye').setRequired(true)).addStringOption(o => o.setName('sebep').setDescription('Sebep').setRequired(true)), async execute(client, i) { if (!hasPerms(i, [PermissionFlagsBits.ModerateMembers])) return deny(i, 'Yetkin yok.'); const t = await i.guild.members.fetch(i.options.getUser('kullanici').id).catch(() => null); if (!t) return deny(i, 'Bulunamadı.'); const id = addRecord(client, i.guild, t.id, 'WARN', i.user, i.options.getString('sebep')); await i.reply({ embeds: [ok(`${t} uyarıldı (\`${id}\`).`)] }); } },
  { category: 'Moderasyon', data: new SlashCommandBuilder().setName('warnings').setDescription('Uyarı listesi.').addUserOption(o => o.setName('kullanici').setDescription('Üye').setRequired(true)), async execute(client, i) { const u = i.options.getUser('kullanici'); const rs = getRecords(i.guild, u.id).filter(r => r.type === 'WARN'); if (!rs.length) return i.reply({ embeds: [info('Uyarı yok.')] }); await i.reply({ embeds: [base(config.colors.warn).setTitle(`⚠️ ${u.tag}`).setDescription(rs.map(r => `\`${r.id}\` ${r.reason} — <t:${Math.floor(r.date / 1000)}:R>`).join('\n'))] }); } },
  { category: 'Moderasyon', data: new SlashCommandBuilder().setName('clearwarn').setDescription('Uyarıları temizler.').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName('kullanici').setDescription('Üye').setRequired(true)), async execute(client, i) { const u = i.options.getUser('kullanici'); db.set(`sicil_${i.guild.id}_${u.id}`, getRecords(i.guild, u.id).filter(r => r.type !== 'WARN')); await i.reply({ embeds: [ok('Temizlendi.')] }); } },
  { category: 'Moderasyon', data: new SlashCommandBuilder().setName('sil').setDescription('Mesaj siler.').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addIntegerOption(o => o.setName('miktar').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100)).addBooleanOption(o => o.setName('sadece_bot').setDescription('Sadece bot')), async execute(client, i) { await i.deferReply({ flags: MessageFlags.Ephemeral }); const f = await i.channel.messages.fetch({ limit: i.options.getInteger('miktar') }); let l = i.options.getBoolean('sadece_bot') ? f.filter(m => m.author.bot) : f; l = l.filter(m => Date.now() - m.createdTimestamp < 1209600000); if (!l.size) return i.editReply({ embeds: [err('Silinecek mesaj yok.')] }); await i.channel.bulkDelete(l, true).catch(() => {}); await i.editReply({ embeds: [ok(`${l.size} mesaj silindi.`)] }); } },
  { category: 'Moderasyon', data: new SlashCommandBuilder().setName('kilitle').setDescription('Kanalı kilitler.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels), async execute(client, i) { await i.channel.permissionOverwrites.edit(i.guild.roles.everyone.id, { SendMessages: false }); await i.reply({ embeds: [ok('🔒 Kilitlendi.')] }); } },
  { category: 'Moderasyon', data: new SlashCommandBuilder().setName('kilit-aç').setDescription('Kilit açar.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels), async execute(client, i) { await i.channel.permissionOverwrites.edit(i.guild.roles.everyone.id, { SendMessages: null }); await i.reply({ embeds: [ok('🔓 Açıldı.')] }); } },
  { category: 'Moderasyon', data: new SlashCommandBuilder().setName('sicil').setDescription('Ceza geçmişi.').addUserOption(o => o.setName('kullanici').setDescription('Üye').setRequired(true)), async execute(client, i) { const u = i.options.getUser('kullanici'); const rs = getRecords(i.guild, u.id); await i.reply({ embeds: [jEmbed(client, config.colors.purple).setTitle(`📒 ${u.tag}`).setDescription(rs.length ? rs.slice(-8).map(r => `\`${r.id}\` **${r.type}** — ${r.reason} (${r.modTag})`).join('\n') : 'Sicil temiz ✅')] }); } },
  { category: 'Moderasyon', data: new SlashCommandBuilder().setName('modlog').setDescription('Modlog kanalı.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(o => o.setName('kanal').setDescription('Kanal').setRequired(true)), async execute(client, i) { db.set(`modlog_${i.guild.id}`, i.options.getChannel('kanal').id); await i.reply({ embeds: [ok('Ayarlandı.')] }); } },

  /* ---------- OTO-MOD ---------- */
  { category: 'Oto-Mod', data: new SlashCommandBuilder().setName('automod').setDescription('Oto-mod yönetimi.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('sistem').setDescription('Sistem').setRequired(true).addChoices({ name: 'küfür', value: 'kufur' }, { name: 'reklam', value: 'reklam' }, { name: 'link', value: 'link' }, { name: 'caps', value: 'caps' }, { name: 'spam', value: 'spam' })).addBooleanOption(o => o.setName('durum').setDescription('Aç/Kapat').setRequired(true)).addStringOption(o => o.setName('kelime').setDescription('Özel kelime ekle')), async execute(client, i) { const s = i.options.getString('sistem'), on = i.options.getBoolean('durum'); const c = db.get(`automod_${i.guild.id}`, null) || {}; c[s] = on; db.set(`automod_${i.guild.id}`, c); const w = i.options.getString('kelime'); if (w) { const arr = db.get(`automod_words_${i.guild.id}`, null) || []; if (!arr.includes(w.toLowerCase())) arr.push(w.toLowerCase()); db.set(`automod_words_${i.guild.id}`, arr); } await i.reply({ embeds: [ok(`**${s}** ${on ? 'açıldı' : 'kapandı'}.`)] }); } },
  { category: 'Oto-Mod', data: new SlashCommandBuilder().setName('otorol').setDescription('Oto-rol ayarlar.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addRoleOption(o => o.setName('uye_rol').setDescription('Üye rolü')).addRoleOption(o => o.setName('bot_rol').setDescription('Bot rolü')).addBooleanOption(o => o.setName('kapat').setDescription('Kapat')), async execute(client, i) { if (i.options.getBoolean('kapat')) { db.delete(`otorol_${i.guild.id}`); return i.reply({ embeds: [ok('Kapandı.')] }); } db.set(`otorol_${i.guild.id}`, { member: i.options.getRole('uye_rol') ? i.options.getRole('uye_rol').id : null, bot: i.options.getRole('bot_rol') ? i.options.getRole('bot_rol').id : null }); await i.reply({ embeds: [ok('Oto-rol ayarlandı.')] }); } },
  { category: 'Oto-Mod', data: new SlashCommandBuilder().setName('welcome').setDescription('Karşılama/log kanalları.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(o => o.setName('karşılama').setDescription('Kanal')).addChannelOption(o => o.setName('log').setDescription('Log')), async execute(client, i) { const w = i.options.getChannel('karşılama'), l = i.options.getChannel('log'); if (w) db.set(`welcome_${i.guild.id}`, w.id); if (l) db.set(`welcomelog_${i.guild.id}`, l.id); await i.reply({ embeds: [ok('Ayarlandı.')] }); } },
  { category: 'Oto-Mod', data: new SlashCommandBuilder().setName('sayac').setDescription('Sayaç ayarlar.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(o => o.setName('kanal').setDescription('Kanal')).addIntegerOption(o => o.setName('hedef').setDescription('Hedef').setMinValue(1)), async execute(client, i) { const c = i.options.getChannel('kanal'), t = i.options.getInteger('hedef'); if (!c || !t) { const s = db.get(`sayac_${i.guild.id}`, null); return i.reply({ embeds: [info(s ? `Hedef ${s.target}, kalan ${Math.max(0, s.target - i.guild.memberCount)}.` : 'Ayarlı değil.')] }); } db.set(`sayac_${i.guild.id}`, { channel: c.id, target: t }); await i.reply({ embeds: [ok(`Sayaç: ${t} → ${c}`)] }); } },

  /* ---------- EMOJİ ---------- */
  { category: 'Emoji', data: new SlashCommandBuilder().setName('emoji-ekle').setDescription('Emoji ekler.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions).addStringOption(o => o.setName('isim').setDescription('İsim').setRequired(true)).addAttachmentOption(o => o.setName('gorsel').setDescription('Dosya')).addStringOption(o => o.setName('url').setDescription('URL')).addStringOption(o => o.setName('emoji').setDescription('Emoji yapıştır')), async execute(client, i) { await i.deferReply(); try { let img = null; const a = i.options.getAttachment('gorsel'), u = i.options.getString('url'), e = i.options.getString('emoji'); if (a) img = Buffer.from(await (await fetch(a.url)).arrayBuffer()); else if (u) img = Buffer.from(await (await fetch(u)).arrayBuffer()); else if (e) { const m = /<?(a)?:(\w{2,32}):(\d{17,25})>?/.exec(e); if (!m) throw new Error('parse'); img = Buffer.from(await (await fetch(`https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? 'gif' : 'png'}`)).arrayBuffer()); } else throw new Error('kaynak'); const em = await i.guild.emojis.create({ attachment: img, name: i.options.getString('isim') }); await i.editReply({ embeds: [ok(`Eklendi: ${em}`)] }); } catch (e) { await i.editReply({ embeds: [err('Eklenemedi: ' + e.message)] }); } } },
  { category: 'Emoji', data: new SlashCommandBuilder().setName('emoji-sil').setDescription('Emoji siler.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions).addStringOption(o => o.setName('emoji').setDescription('Emoji/ad').setRequired(true)), async execute(client, i) { const inp = i.options.getString('emoji'); let t = null; const m = /<?(a)?:(\w{2,32}):(\d{17,25})>?/.exec(inp || ''); if (m) t = i.guild.emojis.cache.get(m[3]); if (!t) t = i.guild.emojis.cache.find(e => e.name.toLowerCase() === inp.toLowerCase()); if (!t) return deny(i, 'Bulunamadı.'); await t.delete(); await i.reply({ embeds: [ok('Silindi.')] }); } },
  { category: 'Emoji', data: new SlashCommandBuilder().setName('emoji-bilgi').setDescription('Emoji bilgi.').addStringOption(o => o.setName('emoji').setDescription('Emoji').setRequired(true)), async execute(client, i) { const inp = i.options.getString('emoji'); const m = /<?(a)?:(\w{2,32}):(\d{17,25})>?/.exec(inp || ''); let t = m ? i.guild.emojis.cache.get(m[3]) : i.guild.emojis.cache.find(e => e.name.toLowerCase() === inp.toLowerCase()); if (!t) return deny(i, 'Yok.'); await i.reply({ embeds: [jEmbed(client).setThumbnail(t.url).setTitle(`ℹ️ ${t.name}`).addFields({ name: 'ID', value: `\`${t.id}\``, inline: true }, { name: 'Anim', value: t.animated ? 'Evet' : 'Hayır', inline: true }, { name: 'Link', value: t.url, inline: false })] }); } },

  /* ---------- GENEL ---------- */
  { category: 'Genel', data: new SlashCommandBuilder().setName('yardım').setDescription('Tüm komutlar.'), async execute(client, i) { const g = {}; client.commands.forEach(c => { const cat = c.category || 'Genel'; (g[cat] = g[cat] || []).push(`\`/${c.data.name}\``); }); const emb = jEmbed(client).setTitle('📚 JARM YARDIM').setDescription(`Toplam **${client.commands.size}** komut.`); Object.entries(g).forEach(([k, v]) => emb.addFields({ name: `▸ ${k}`, value: v.join(' '), inline: false })); await i.reply({ embeds: [emb] }); } },
  { category: 'Genel', data: new SlashCommandBuilder().setName('sunucu-bilgi').setDescription('Sunucu bilgisi.'), async execute(client, i) { const g = i.guild; const o = await g.fetchOwner().catch(() => null); await i.reply({ embeds: [jEmbed(client).setTitle(`🏰 ${g.name}`).setThumbnail(g.iconURL() || '').addFields({ name: 'Sahip', value: o ? `${o}` : '-', inline: true }, { name: 'Üye', value: `${g.memberCount}`, inline: true }, { name: 'Kanal', value: `${g.channels.cache.size}`, inline: true }, { name: 'Rol', value: `${g.roles.cache.size}`, inline: true }, { name: 'Emoji', value: `${g.emojis.cache.size}`, inline: true }, { name: 'Kuruluş', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true })] }); } },
  { category: 'Genel', data: new SlashCommandBuilder().setName('avatar').setDescription('Avatar.').addUserOption(o => o.setName('kullanici').setDescription('Üye')), async execute(client, i) { const u = (i.options.getUser('kullanici') || i.user); const url = u.displayAvatarURL({ size: 1024 }); await i.reply({ embeds: [base().setTitle(`🖼️ ${u.username}`).setImage(url)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('PNG').setURL(url.replace(/\.(webp|jpeg|jpg)/, '.png')).setStyle(ButtonStyle.Link))] }); } },
  { category: 'Genel', data: new SlashCommandBuilder().setName('banner').setDescription('Banner.').addUserOption(o => o.setName('kullanici').setDescription('Üye')), async execute(client, i) { const u = await client.users.fetch(i.options.getUser('kullanici')?.id || i.user.id, { force: true }); const url = u.bannerURL({ size: 1024 }); if (!url) return i.reply({ embeds: [info('Banner yok.')], flags: MessageFlags.Ephemeral }); await i.reply({ embeds: [base().setTitle(`🎇 ${u.username}`).setImage(url)] }); } },
  { category: 'Genel', data: new SlashCommandBuilder().setName('embed-yaz').setDescription('Embed oluşturur (modal).').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addChannelOption(o => o.setName('kanal').setDescription('Kanal')), async execute(client, i) { const ch = i.options.getChannel('kanal') || i.channel; const m = new ModalBuilder().setCustomId(`embed_modal:${ch.id}`).setTitle('Embed Oluşturucu'); m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_title').setLabel('Başlık').setStyle(TextInputStyle.Short).setRequired(false)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_desc').setLabel('Açıklama').setStyle(TextInputStyle.Paragraph).setRequired(false)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_color').setLabel('Renk (#hex)').setStyle(TextInputStyle.Short).setRequired(false)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_btn').setLabel('Buton: etiket | url').setStyle(TextInputStyle.Short).setRequired(false))); await i.showModal(m); } },
  { category: 'Genel', data: new SlashCommandBuilder().setName('ping').setDescription('Bot ping.'), async execute(client, i) { await i.reply({ embeds: [jEmbed(client).setTitle('🏓 PONG').setDescription(`WS: **${client.ws.ping}ms**`)] }); } }
];

/* ============================ CLIENT ============================ */
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember] });
client.commands = new Collection();
commands.forEach(c => client.commands.set(c.data.name, c));

/* ============================ READY ============================ */
client.once('ready', async () => {
  client.user.setPresence({ activities: [{ name: 'Jarm v2 • /yardım', type: ActivityType.Watching }], status: 'online' });
  const body = client.commands.map(c => c.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(config.token);
  try { if (config.devGuild) await rest.put(Routes.applicationGuildCommands(config.clientId, config.devGuild), { body }); else await rest.put(Routes.applicationCommands(config.clientId), { body }); console.log(`[CMD] ${body.length} komut yüklendi.`); } catch (e) { console.error('[CMD]', e.message); }
  console.log(`[BOT] ${client.user.tag} online.`);
});

/* ============================ INTERACTION ============================ */
client.on('interactionCreate', async (i) => {
  try {
    if (i.isChatInputCommand()) { const c = client.commands.get(i.commandName); if (c) await c.execute(client, i); return; }
    if (i.isStringSelectMenu() && i.customId === 'ticket_select') return await openTicketModal(i, i.values[0]);
    if (i.isModalSubmit()) {
      if (i.customId.startsWith('ticket_modal:')) return await createTicket(client, i);
      if (i.customId === 'reg_modal') {
        const name = i.fields.getTextInputValue('reg_name').trim();
        const age = parseInt(i.fields.getTextInputValue('reg_age'), 10);
        if (!name || isNaN(age) || age < 8 || age > 99) return i.reply({ embeds: [err('Geçersiz isim/yaş (8-99).')], flags: MessageFlags.Ephemeral });
        db.set(`regpending_${i.guild.id}_${i.user.id}`, { name, age });
        return i.reply({ embeds: [jEmbed(client, config.colors.success).setTitle('📝 KAYIT FORMU').setDescription(`İsim: \`${name}\` | Yaş: \`${age}\`\nŞimdi cinsiyetini seç:`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('reg_male').setLabel('♂ Erkek').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('reg_female').setLabel('♀ Kadın').setStyle(ButtonStyle.Secondary))], flags: MessageFlags.Ephemeral });
      }
      if (i.customId.startsWith('embed_modal:')) {
        const ch = i.guild.channels.cache.get(i.customId.split(':')[1]) || i.channel;
        const emb = base(); const col = (i.fields.getTextInputValue('e_color') || '').match(/^#?([0-9a-f]{6})$/i);
        if (col) emb.setColor(parseInt(col[1], 16));
        const t = i.fields.getTextInputValue('e_title'); if (t) emb.setTitle(t);
        const d = i.fields.getTextInputValue('e_desc'); if (d) emb.setDescription(d);
        emb.setFooter({ text: i.user.username, iconURL: i.user.displayAvatarURL() });
        const b = i.fields.getTextInputValue('e_btn'); const comps = [];
        if (b && b.includes('|')) { const [lb, url] = b.split('|').map(s => s.trim()); if (/^https?:\/\//.test(url || '')) comps.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(lb || 'Link').setURL(url).setStyle(ButtonStyle.Link))); }
        await ch.send({ embeds: [emb], components: comps });
        return i.reply({ embeds: [ok('Gönderildi.')], flags: MessageFlags.Ephemeral });
      }
      return;
    }
    if (i.isButton()) {
      const id = i.customId;
      if (id === 'ticket_quick') return await openTicketModal(i, 'Destek');
      if (id === 't_close') return await askClose(i);
      if (id === 't_close_yes') return await closeTicket(i, true);
      if (id === 't_close_no') return await closeTicket(i, false);
      if (id === 't_lock') return await setLock(i, true);
      if (id === 't_unlock') return await setLock(i, false);
      if (id === 't_transcript') return await handleTranscript(i);
      if (id === 'reg_start') return await i.showModal(new ModalBuilder().setCustomId('reg_modal').setTitle('Jarm Kayıt Formu').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reg_name').setLabel('İsmin').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reg_age').setLabel('Yaşın').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2))));
      if (id === 'reg_male' || id === 'reg_female') {
        const pend = db.get(`regpending_${i.guild.id}_${i.user.id}`, null);
        if (!pend) return i.update({ embeds: [err('Form bulunamadı, tekrar dene.')], components: [], flags: MessageFlags.Ephemeral });
        const member = await i.guild.members.fetch(i.user.id).catch(() => null);
        if (!member) return;
        try { const nick = await applyRegistration(client, i.guild, member, pend, id === 'reg_male' ? 'm' : 'f', null); return i.update({ embeds: [jEmbed(client, config.colors.success).setTitle('🎉 KAYIT BAŞARILI').setDescription(`Hoş geldin **${nick}**! Rolün verildi, iyi eğlenceler kral. 💛`)], components: [], flags: MessageFlags.Ephemeral }); }
        catch (e) { return i.update({ embeds: [err(e.message)], components: [], flags: MessageFlags.Ephemeral }); }
      }
      if (id.startsWith('poll_')) {
        const [, pid, idxS] = id.split('_'); const p = db.get(`poll_${pid}`, null);
        if (!p) return i.reply({ embeds: [err('Anket yok.')], flags: MessageFlags.Ephemeral });
        if (Date.now() > p.ends) return i.reply({ embeds: [err('Anket süresi doldu.')], flags: MessageFlags.Ephemeral });
        const idx = parseInt(idxS, 10);
        for (const k of Object.keys(p.votes)) p.votes[k] = p.votes[k].filter(u => u !== i.user.id);
        (p.votes[idx] = p.votes[idx] || []).push(i.user.id);
        db.set(`poll_${pid}`, p);
        const ch = i.guild.channels.cache.get(p.ch) || i.channel;
        const msg = p.msg ? await ch.messages.fetch(p.msg).catch(() => null) : null;
        if (msg) await msg.edit({ embeds: [pollEmbed(p)], components: pollRow(p) });
        return i.deferUpdate();
      }
    }
  } catch (e) {
    console.error('[INTERACTION]', e && e.stack ? e.stack : e);
    try { const p = { content: '❌ Hata oluştu, loglandı.', flags: MessageFlags.Ephemeral }; if (i.replied || i.deferred) await i.followUp(p); else await i.reply(p); } catch {}
  }
});

/* ============================ MESSAGE (AUTOMOD + LEVEL + AFK + AI) ============================ */
const DEFAULT_WORDS = ['amk', 'aq', 'amq', 'orospu', 'piç', 'sik', 'yarrak', 'kahpe', 'pezevenk', 'ibne', 'gavat', 'amcık', 'yavşak', 'oc'];
const spamMap = new Map();
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;
  const g = message.guild;
  /* AFK */
  const afk = db.get(`afk_${message.author.id}`, null);
  if (afk) { db.delete(`afk_${message.author.id}`); message.reply({ embeds: [ok(`Tekrar hoş geldin! AFK sebebin: \`${afk.r}\` (<t:${Math.floor(afk.t / 1000)}:R>)`)] }).catch(() => {}); }
  for (const m of message.mentions.users.values()) { const a = db.get(`afk_${m.id}`, null); if (a) message.reply({ embeds: [info(`🛌 ${m} şu an AFK: \`${a.r}\` (<t:${Math.floor(a.t / 1000)}:R>)`)] }).catch(() => {}); }
  /* AI */
  const aiCh = db.get(`ai_channels_${g.id}`, null) || [];
  if (message.mentions.users.has(client.user.id) || aiCh.includes(message.channel.id)) {
    const text = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    if (text) return await aiRespond(client, message, text);
  }
  /* AUTOMOD */
  const st = db.get(`automod_${g.id}`, null) || {};
  if (Object.values(st).some(v => v) && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    const content = message.content || ''; const words = db.get(`automod_words_${g.id}`, null) || DEFAULT_WORDS;
    let v = null;
    if (st.kufur && words.some(w => content.toLowerCase().includes(w))) v = 'Küfür';
    if (!v && st.reklam && /(discord\.gg|discord\.com\/invite)/i.test(content)) v = 'Reklam';
    if (!v && st.link && /(https?:\/\/|www\.)/i.test(content)) v = 'Link';
    if (!v && st.caps) { const L = content.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, ''), U = content.replace(/[^A-ZÇĞİÖŞÜ]/g, ''); if (content.length >= 8 && L.length >= 8 && U.length / L.length > 0.7) v = 'Caps'; }
    if (!v && st.spam) { const now = Date.now(); const arr = (spamMap.get(message.author.id) || []).filter(t => now - t < 3000); arr.push(now); spamMap.set(message.author.id, arr); if (arr.length > 4) { v = 'Spam'; spamMap.set(message.author.id, []); } }
    if (v) {
      await message.delete().catch(() => {});
      const n = await message.channel.send({ embeds: [err(`${message.author}, \`${v}\` ihlali — mesaj silindi.`)] }).catch(() => null);
      if (n) setTimeout(() => n.delete().catch(() => {}), 5000);
      addRecord(client, g, message.author.id, 'AUTOMOD', client.user, v);
      if (v === 'Spam') await message.member.timeout(60000, 'Anti-spam').catch(() => {});
      return;
    }
  }
  /* LEVEL */
  await giveXp(client, message);
});

/* ============================ SNIPER ============================ */
client.on('messageDelete', (m) => { if (m.guild && !m.author?.bot) snipes.set(m.channel.id, { tag: m.author.tag, content: (m.content || '').slice(0, 1000), t: Date.now() }); });

/* ============================ MEMBER ADD (KAYIT GATE + WELCOME + RAID) ============================ */
client.on('guildMemberAdd', async (member) => {
  const g = member.guild;
  try {
    const roles = db.get(`otorol_${g.id}`, null);
    if (roles) { const rid = member.user.bot ? roles.bot : roles.member; if (rid && g.roles.cache.has(rid)) await member.roles.add(rid).catch(() => {}); }
    /* RAID */
    const cfg = guardCfg(g);
    if (cfg.enabled.raid) {
      const arr = (joinTracker.get(g.id) || []).filter(t => Date.now() - t < 10000); arr.push(Date.now()); joinTracker.set(g.id, arr);
      if (arr.length >= 8) { const ch = cfg.log && g.channels.cache.has(cfg.log) ? g.channels.cache.get(cfg.log) : null; if (ch) ch.send({ embeds: [base(config.colors.guard).setTitle('🚨 RAID ŞÜPHESİ').setDescription(`10sn içinde ${arr.length} giriş! Yeni üyelere otomatik timeout.`)] }).catch(() => {}); db.set(`raidmode_${g.id}`, Date.now() + 300000); }
      if ((db.get(`raidmode_${g.id}`, 0) || 0) > Date.now()) await member.timeout(600000, 'Raid koruması').catch(() => {});
    }
    const sayac = db.get(`sayac_${g.id}`, null);
    if (sayac && g.channels.cache.has(sayac.channel)) g.channels.cache.get(sayac.channel).send({ embeds: [base(config.colors.success).setDescription(`🎉 **${member.user.tag}** katıldı! **${g.memberCount}/${sayac.target}** üye.`)] }).catch(() => {});
    const w = db.get(`welcome_${g.id}`, null);
    if (w && g.channels.cache.has(w)) g.channels.cache.get(w).send({ embeds: [jEmbed(client, config.colors.success).setTitle('👋 HOŞ GELDİN').setDescription(`${member} aramıza katıldı! (${g.memberCount}. üye)\n📅 Hesap: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`), components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('reg_start').setLabel('📝 Kayıt Ol').setStyle(ButtonStyle.Success))] }).catch(() => {});
    const l = db.get(`welcomelog_${g.id}`, null);
    if (l && g.channels.cache.has(l)) g.channels.cache.get(l).send({ embeds: [base().setTitle('➡️ Giriş').setDescription(`${member} (\`${member.id}\`)`)] }).catch(() => {});
  } catch (e) { console.error('[ADD]', e.message); }
});
client.on('guildMemberRemove', async (member) => {
  const g = member.guild;
  const l = db.get(`welcomelog_${g.id}`, null);
  if (l && g.channels.cache.has(l)) g.channels.cache.get(l).send({ embeds: [base(config.colors.error).setTitle('⬅️ Çıkış').setDescription(`${member.user.tag} (\`${member.id}\`)`)] }).catch(() => {});
  db.delete(`regpending_${g.id}_${member.id}`);
});

/* ============================ GUARD EVENTS ============================ */
client.on('channelDelete', async (ch) => { if (!ch.guild) return; const cfg = guardCfg(ch.guild); if (!cfg.enabled.nuke) return; const logs = await ch.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }).catch(() => null); const ex = logs && logs.entries.first(); if (!ex || !ex.executor) return; if (guardAllowed(ch.guild, ex.executor.id)) return; await guardCount(client, ch.guild, ex.executor.id, 'channelDelete'); });
client.on('channelCreate', async (ch) => { if (!ch.guild) return; const cfg = guardCfg(ch.guild); if (!cfg.enabled.nuke) return; const logs = await ch.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 1 }).catch(() => null); const ex = logs && logs.entries.first(); if (!ex || !ex.executor) return; if (guardAllowed(ch.guild, ex.executor.id)) return; await guardCount(client, ch.guild, ex.executor.id, 'channelCreate'); });
client.on('roleDelete', async (r) => { const cfg = guardCfg(r.guild); if (!cfg.enabled.nuke) return; const logs = await r.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 }).catch(() => null); const ex = logs && logs.entries.first(); if (!ex || !ex.executor) return; if (guardAllowed(r.guild, ex.executor.id)) return; await guardCount(client, r.guild, ex.executor.id, 'roleDelete'); });
client.on('guildMemberUpdate', async (oldM, newM) => {
  const cfg = guardCfg(newM.guild); if (!cfg.enabled.role) return;
  const added = newM.roles.cache.filter(r => !oldM.roles.cache.has(r.id));
  if (!added.size) return;
  const logs = await newM.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 1 }).catch(() => null);
  const ex = logs && logs.entries.first();
  if (!ex || !ex.executor) return;
  if (guardAllowed(newM.guild, ex.executor.id)) return;
  await newM.roles.remove(added.map(r => r.id), 'GUARD: yetkisiz rol').catch(() => {});
  await guardCount(client, newM.guild, ex.executor.id, 'roleUpdate');
});

/* ============================ REMINDERS ============================ */
setInterval(async () => {
  const list = db.get('reminders', null) || [];
  if (!list.length) return;
  const due = list.filter(r => r.t <= Date.now());
  if (!due.length) return;
  db.set('reminders', list.filter(r => r.t > Date.now()));
  for (const r of due) { const u = await client.users.fetch(r.u).catch(() => null); if (u) u.send({ embeds: [base(config.colors.warn).setTitle('⏰ HATIRLATMA').setDescription(r.m)] }).catch(() => {}); }
}, 20000);

/* ============================ EXPRESS (RENDER 7/24) ============================ */
const app = express();
app.get('/', (req, res) => res.status(200).json({ status: 'online', bot: client.user ? client.user.tag : 'boot', uptime: process.uptime(), ping: client.ws.ping, servers: client.guilds.cache.size }));
app.get('/health', (req, res) => res.json({ ok: true }));
app.listen(config.port, () => console.log(`[WEB] :${config.port} dinleniyor.`));

/* ============================ ERROR HANDLING ============================ */
process.on('unhandledRejection', e => console.error('[UR]', e && e.stack ? e.stack : e));
process.on('uncaughtException', e => console.error('[UE]', e && e.stack ? e.stack : e));
process.on('warning', w => console.warn('[W]', w.message));

client.login(config.token).catch(e => { console.error('[LOGIN]', e.message); process.exit(1); });