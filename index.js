/* ============================================================
   BLOOMA GUARDIAN — FULL-SUITE ALL-IN-ONE DISCORD BOT
   Discord.js v14 | TEK DOSYA | GLITCH READY | VERIFICATION READY
   JXRM STUDIO
   ============================================================ */
require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, Collection, REST, Routes, ActivityType,
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, AttachmentBuilder
} = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

/* ============================ CONFIG ============================ */
const config = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  devGuild: process.env.DEV_GUILD_ID || null,
  port: parseInt(process.env.PORT || '8080', 10),
  owners: (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
  colors: { primary: 0x5865F2, success: 0x57F287, error: 0xED4245, warn: 0xFEE75C, gold: 0xFFB830, purple: 0x9D5CFF }
};

/* ============================ JSON-LITE DB ============================ */
const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
let dbCache = {};
try { dbCache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { dbCache = {}; }
let dbTimer = null;
function dbPersist() {
  if (dbTimer) return;
  dbTimer = setTimeout(() => {
    dbTimer = null;
    try { fs.writeFileSync(DB_FILE, JSON.stringify(dbCache, null, 2)); } catch (e) { console.error('[DB]', e.message); }
  }, 400);
}
function dbWalk(key, create) {
  const parts = key.split('.');
  let node = dbCache;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (node[p] == null || typeof node[p] !== 'object') { if (!create) return null; node[p] = {}; }
    node = node[p];
  }
  return { node, last: parts[parts.length - 1] };
}
const db = {
  get(key, def = null) { const w = dbWalk(key, false); if (!w) return def; const v = w.node[w.last]; return v === undefined ? def : v; },
  set(key, val) { const w = dbWalk(key, true); w.node[w.last] = val; dbPersist(); return val; },
  add(key, n) { return this.set(key, (Number(this.get(key, 0)) || 0) + n); },
  push(key, val) { const arr = this.get(key, []); if (!Array.isArray(arr)) return this.set(key, [val]); arr.push(val); return this.set(key, arr); },
  delete(key) { const w = dbWalk(key, false); if (!w) return false; delete w.node[w.last]; dbPersist(); return true; },
  has(key) { return this.get(key, undefined) !== undefined; }
};

/* ============================ EMBED HELPERS ============================ */
const base = (color = config.colors.primary) => new EmbedBuilder().setColor(color).setTimestamp();
const ok = (t) => base(config.colors.success).setDescription(`✅ ${t}`);
const err = (t) => base(config.colors.error).setDescription(`❌ ${t}`);
const info = (t) => base(config.colors.primary).setDescription(t);
const warnE = (t) => base(config.colors.warn).setDescription(`⚠️ ${t}`);

/* ============================ PERM HELPERS ============================ */
function hasPerms(interaction, perms = []) {
  const m = interaction.member;
  if (!m) return false;
  if (m.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return m.permissions.has(perms);
}
async function deny(interaction, text) {
  const payload = { content: `❌ ${text}`, flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
  else await interaction.reply(payload);
}
function hierarchyOk(interaction, targetMember) {
  const guild = interaction.guild;
  if (targetMember.id === guild.ownerId) return false;
  if (interaction.user.id === guild.ownerId) return true;
  if (interaction.member.roles.highest.position <= targetMember.roles.highest.position) return false;
  if (guild.members.me.roles.highest.position <= targetMember.roles.highest.position) return false;
  return true;
}

/* ============================ TRANSKRIPT ============================ */
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
async function buildTranscript(channel, meta) {
  const msgs = [];
  let lastId = undefined;
  for (let i = 0; i < 3; i++) {
    const opts = { limit: 100 };
    if (lastId) opts.before = lastId;
    const batch = await channel.messages.fetch(opts).catch(() => null);
    if (!batch || !batch.size) break;
    msgs.push(...batch.values());
    lastId = batch.lastKey();
    if (batch.size < 100) break;
  }
  msgs.reverse();
  const rows = msgs.map(m =>
    `<div class="m"><span class="t">[${new Date(m.createdTimestamp).toLocaleString('tr-TR')}]</span> <b>${esc(m.author.tag)}</b>: ${esc(m.content || '')}${m.attachments && m.attachments.size ? ` <i>(${m.attachments.size} ek)</i>` : ''}</div>`
  ).join('\n');
  const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>Transkript - ${esc(channel.name)}</title>
<style>body{background:#1e1f22;color:#dbdee1;font-family:Segoe UI,sans-serif;padding:24px}h1{color:#fff}h3{color:#949ba4;font-weight:400}
.m{padding:6px 10px;border-bottom:1px solid #2b2d31;line-height:1.5}.t{color:#949ba4;font-size:12px;margin-right:6px}b{color:#5865f2}i{color:#949ba4}</style></head>
<body><h1>Ticket Transkripti</h1><h3>Kanal: #${esc(channel.name)} | Kategori: ${esc(meta && meta.category || '-')} | Konu: ${esc(meta && meta.subject || '-')} | Kapatılış: ${new Date().toLocaleString('tr-TR')}</h3>
<hr>${rows || '<p>Mesaj bulunamadı.</p>'}</body></html>`;
  return new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `transcript-${channel.name}-${Date.now()}.html` });
}

/* ============================ SİCİL / MODLOG ============================ */
function modlog(client, guild, { type, userId, mod, reason }) {
  const chId = db.get(`modlog_${guild.id}`, null);
  if (!chId || !guild.channels.cache.has(chId)) return;
  guild.channels.cache.get(chId).send({
    embeds: [base(config.colors.warn).setTitle('📒 Ceza Kaydı').addFields(
      { name: 'Tür', value: `\`${type}\``, inline: true },
      { name: 'Kullanıcı', value: `<@${userId}>`, inline: true },
      { name: 'Yetkili', value: `${mod}`, inline: true },
      { name: 'Sebep', value: reason || 'Belirtilmedi', inline: false },
      { name: 'Tarih', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
    )]
  }).catch(() => {});
}
function addRecord(client, guild, userId, type, mod, reason) {
  const seq = db.add(`sicilseq_${guild.id}`, 1);
  const rec = { id: `#${seq}`, type, reason: reason || 'Belirtilmedi', mod: mod.id, modTag: mod.tag || mod.username || 'Bot', date: Date.now() };
  db.push(`sicil_${guild.id}_${userId}`, rec);
  modlog(client, guild, { type, userId, mod, reason });
  return rec.id;
}
function getRecords(guild, userId) { return db.get(`sicil_${guild.id}_${userId}`, []) || []; }

/* ============================ TICKET HELPERS ============================ */
const CATEGORIES = [
  { value: 'Destek',  label: 'Destek',            desc: 'Genel destek ve yardım talepleri', color: config.colors.primary },
  { value: 'Sikayet', label: 'Şikayet',           desc: 'Oyuncu / üye şikayetleri',          color: config.colors.error },
  { value: 'VIP',     label: 'VIP / Satış',       desc: 'Satın alım ve VIP işlemleri',       color: config.colors.gold },
  { value: 'Basvuru', label: 'Yetkili Başvurusu', desc: 'Staff başvuru talepleri',           color: config.colors.success }
];
const catOf = (v) => CATEGORIES.find(c => c.value === v) || CATEGORIES[0];

async function openTicketModal(interaction, category) {
  const cat = catOf(category);
  const modal = new ModalBuilder().setCustomId(`ticket_modal:${cat.value}`).setTitle(`Ticket • ${cat.label}`);
  const subject = new TextInputBuilder().setCustomId('t_subject').setLabel('Konu').setStyle(TextInputStyle.Short)
    .setRequired(true).setMaxLength(80).setPlaceholder('Talebinizi tek cümleyle özetleyin...');
  const detail = new TextInputBuilder().setCustomId('t_detail').setLabel('Detay').setStyle(TextInputStyle.Paragraph)
    .setRequired(true).setMaxLength(1000).setPlaceholder('Sorununuzu ayrıntılı şekilde anlatın...');
  modal.addComponents(new ActionRowBuilder().addComponents(subject), new ActionRowBuilder().addComponents(detail));
  await interaction.showModal(modal);
}
async function createTicket(client, interaction) {
  const category = interaction.customId.split(':')[1] || 'Destek';
  const subject = interaction.fields.getTextInputValue('t_subject');
  const detail = interaction.fields.getTextInputValue('t_detail');
  const guild = interaction.guild;
  const existing = db.get(`ticket_open_${guild.id}_${interaction.user.id}`, null);
  if (existing && guild.channels.cache.has(existing)) {
    return interaction.reply({ embeds: [err(`Zaten açık bir ticketiniz var: <#${existing}>`)], flags: MessageFlags.Ephemeral });
  }
  const staffId = db.get(`ticket_staff_${guild.id}`, null);
  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'kullanici';
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
  ];
  if (staffId && guild.roles.cache.has(staffId)) {
    overwrites.push({ id: staffId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }
  const channel = await guild.channels.create({
    name: `ticket-${safeName}`, type: ChannelType.GuildText,
    topic: `Ticket | Sahip: ${interaction.user.id} | Kategori: ${category}`,
    permissionOverwrites: overwrites, reason: `Ticket: ${subject}`
  });
  db.set(`ticket_${channel.id}`, { owner: interaction.user.id, category, subject, detail, openedAt: Date.now(), added: [], locked: false });
  db.set(`ticket_open_${guild.id}_${interaction.user.id}`, channel.id);
  const cat = catOf(category);
  const embed = base(cat.color).setTitle(`🎫 ${cat.label} Ticket`)
    .setDescription(`**Konu:** ${subject}\n**Detay:** ${detail}\n\nYetkililerimiz en kısa sürede ilgilenecektir.`)
    .addFields(
      { name: 'Sahip', value: `${interaction.user}`, inline: true },
      { name: 'Kategori', value: cat.label, inline: true },
      { name: 'Oluşturma', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true })
    .setFooter({ text: `Ticket ID: ${channel.id}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('t_close').setLabel('Kapat').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('t_lock').setLabel('Kilitle').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('t_transcript').setLabel('Transkript Al').setStyle(ButtonStyle.Secondary));
  await channel.send({ content: `${interaction.user}${staffId ? ` <@&${staffId}>` : ''}`, embeds: [embed], components: [row] });
  await interaction.reply({ embeds: [ok(`Ticketiniz oluşturuldu: ${channel}`)], flags: MessageFlags.Ephemeral });
}
async function askClose(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('t_close_yes').setLabel('Evet, Kapat').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('t_close_no').setLabel('Vazgeç').setStyle(ButtonStyle.Secondary));
  await interaction.reply({ embeds: [info('Bu ticketi **kapatmak** istediğinize emin misiniz? Transkript log kanalına gönderilecektir.')], components: [row], flags: MessageFlags.Ephemeral });
}
async function closeTicket(interaction, confirmed) {
  if (!confirmed) return interaction.update({ embeds: [info('Kapatma işlemi iptal edildi.')], components: [], flags: MessageFlags.Ephemeral });
  const channel = interaction.channel;
  const meta = db.get(`ticket_${channel.id}`, null);
  const logId = db.get(`ticket_log_${channel.guild.id}`, null);
  const logCh = logId ? channel.guild.channels.cache.get(logId) : null;
  if (logCh) {
    const att = await buildTranscript(channel, meta);
    const emb = base(config.colors.error).setTitle('🔒 Ticket Kapatıldı').addFields(
      { name: 'Sahip', value: meta ? `<@${meta.owner}>` : 'Bilinmiyor', inline: true },
      { name: 'Kategori', value: meta ? catOf(meta.category).label : '-', inline: true },
      { name: 'Konu', value: meta ? meta.subject : '-', inline: false },
      { name: 'Kapatan', value: `${interaction.user}`, inline: true });
    await logCh.send({ embeds: [emb], files: [att] }).catch(() => {});
  }
  if (meta) db.delete(`ticket_open_${channel.guild.id}_${meta.owner}`);
  db.delete(`ticket_${channel.id}`);
  await interaction.update({ embeds: [ok('Ticket kapatılıyor. Transkript log kanalına iletildi.')], components: [] });
  setTimeout(() => channel.delete('Ticket kapatıldı').catch(() => {}), 4000);
}
async function setLock(interaction, lock) {
  const channel = interaction.channel;
  const meta = db.get(`ticket_${channel.id}`, null);
  if (!meta) return interaction.reply({ embeds: [err('Bu kanal bir ticket kanalı değil.')], flags: MessageFlags.Ephemeral });
  const targets = [meta.owner, ...(meta.added || [])];
  for (const uid of targets) await channel.permissionOverwrites.edit(uid, { SendMessages: lock ? false : null }).catch(() => {});
  meta.locked = lock;
  db.set(`ticket_${channel.id}`, meta);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('t_close').setLabel('Kapat').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(lock ? 't_unlock' : 't_lock').setLabel(lock ? 'Kilidi Aç' : 'Kilitle').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('t_transcript').setLabel('Transkript Al').setStyle(ButtonStyle.Secondary));
  await interaction.update({ components: [row] });
  await interaction.followUp({ embeds: [ok(lock ? 'Ticket **kilitlendi.** Kullanıcılar yazamaz.' : 'Ticket kilidi **açıldı.**')], flags: MessageFlags.Ephemeral });
}
async function handleTranscript(interaction) {
  const channel = interaction.channel;
  const meta = db.get(`ticket_${channel.id}`, null);
  const logId = db.get(`ticket_log_${channel.guild.id}`, null);
  const logCh = logId ? channel.guild.channels.cache.get(logId) : null;
  if (!logCh) return interaction.reply({ embeds: [err('Log kanalı ayarlanmamış. `/ticket-setup` kullanın.')], flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const att = await buildTranscript(channel, meta);
  await logCh.send({ content: `📄 **Transkript:** ${channel.name} — isteyen: ${interaction.user}`, files: [att] });
  await interaction.editReply({ embeds: [ok('Transkript log kanalına gönderildi.')] });
}

/* ============================ EMBED MODAL BUILDER ============================ */
async function buildEmbedFromModal(interaction) {
  const channelId = interaction.customId.split(':')[1];
  const channel = interaction.guild.channels.cache.get(channelId) || interaction.channel;
  const title = interaction.fields.getTextInputValue('e_title');
  const desc = interaction.fields.getTextInputValue('e_desc');
  const colorRaw = (interaction.fields.getTextInputValue('e_color') || '').trim();
  const lbl = interaction.fields.getTextInputValue('e_btnlabel');
  const url = interaction.fields.getTextInputValue('e_btnurl');
  let color = config.colors.primary;
  const m = colorRaw.match(/^#?([0-9a-f]{6})$/i);
  if (m) color = parseInt(m[1], 16);
  const emb = base(color);
  if (title) emb.setTitle(title);
  if (desc) emb.setDescription(desc);
  emb.setFooter({ text: `${interaction.user.username} tarafından yayınlandı`, iconURL: interaction.user.displayAvatarURL() });
  const components = [];
  if (lbl && /^https?:\/\//i.test(url || '')) {
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(lbl).setURL(url).setStyle(ButtonStyle.Link)));
  }
  await channel.send({ embeds: [emb], components });
  await interaction.reply({ embeds: [ok(`Embed ${channel} kanalına gönderildi.`)], flags: MessageFlags.Ephemeral });
}

/* ============================ AUTO-MOD VERİ ============================ */
const DEFAULT_WORDS = ['amk', 'aq', 'amq', 'orospu', 'piç', 'pic', 'sik', 'yarrak', 'göt', 'gotun', 'kahpe', 'pezevenk', 'ibne', 'gavat', 'sülük', 'amcık', 'sikik', 'yavşak', 'yavsak', 'oc', 'amk'];
const spamMap = new Map();

/* ============================ KOMUTLAR ============================ */
const commands = [
  /* ---------- TICKET ---------- */
  {
    category: 'Ticket',
    data: new SlashCommandBuilder().setName('ticket-setup').setDescription('Ticket panelini kurar (staff, log, panel).')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addRoleOption(o => o.setName('staff').setDescription('Yetkili rolü').setRequired(true))
      .addChannelOption(o => o.setName('log').setDescription('Transkript/log kanalı').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o => o.setName('panel').setDescription('Panel kanalı (varsayılan: bu kanal)').addChannelTypes(ChannelType.GuildText)),
    async execute(client, interaction) {
      const staff = interaction.options.getRole('staff');
      const log = interaction.options.getChannel('log');
      const panel = interaction.options.getChannel('panel') || interaction.channel;
      db.set(`ticket_staff_${interaction.guild.id}`, staff.id);
      db.set(`ticket_log_${interaction.guild.id}`, log.id);
      const select = new StringSelectMenuBuilder().setCustomId('ticket_select').setPlaceholder('🎫 Ticket kategorisi seçin...')
        .addOptions(CATEGORIES.map(c => ({ label: c.label, value: c.value, description: c.desc })));
      const btn = new ButtonBuilder().setCustomId('ticket_quick').setLabel('Hızlı Destek').setStyle(ButtonStyle.Primary);
      const embed = base(config.colors.primary).setTitle('🎫 Destek Sistemi')
        .setDescription('Aşağıdaki menüden ticket kategorinizi seçin veya **Hızlı Destek** butonunu kullanın.\n\nTicket açtığınızda sadece siz ve yetkililer kanalı görebilir.')
        .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() || undefined });
      await panel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(btn)] });
      await interaction.reply({ embeds: [ok(`Ticket paneli ${panel} kanalına kuruldu. Staff: ${staff} | Log: ${log}`)], flags: MessageFlags.Ephemeral });
    }
  },
  {
    category: 'Ticket',
    data: new SlashCommandBuilder().setName('ticket-add').setDescription('Ticket kanalına kullanıcı ekler.')
      .addUserOption(o => o.setName('kullanici').setDescription('Eklenecek kullanıcı').setRequired(true)),
    async execute(client, interaction) {
      const ch = interaction.channel;
      if (!ch.topic || !ch.topic.startsWith('Ticket |')) return deny(interaction, 'Bu komut yalnızca ticket kanallarında kullanılır.');
      const user = interaction.options.getUser('kullanici');
      const meta = db.get(`ticket_${ch.id}`, null) || { added: [] };
      await ch.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
      if (!meta.added.includes(user.id)) meta.added.push(user.id);
      db.set(`ticket_${ch.id}`, meta);
      await interaction.reply({ embeds: [ok(`${user} tickete eklendi.`)] });
    }
  },
  {
    category: 'Ticket',
    data: new SlashCommandBuilder().setName('ticket-remove').setDescription('Ticket kanalından kullanıcı çıkarır.')
      .addUserOption(o => o.setName('kullanici').setDescription('Çıkarılacak kullanıcı').setRequired(true)),
    async execute(client, interaction) {
      const ch = interaction.channel;
      if (!ch.topic || !ch.topic.startsWith('Ticket |')) return deny(interaction, 'Bu komut yalnızca ticket kanallarında kullanılır.');
      const user = interaction.options.getUser('kullanici');
      const meta = db.get(`ticket_${ch.id}`, null) || { added: [] };
      await ch.permissionOverwrites.edit(user.id, { ViewChannel: false, SendMessages: false });
      meta.added = meta.added.filter(id => id !== user.id);
      db.set(`ticket_${ch.id}`, meta);
      await interaction.reply({ embeds: [ok(`${user} ticketten çıkarıldı.`)] });
    }
  },
  {
    category: 'Ticket',
    data: new SlashCommandBuilder().setName('ticket-close').setDescription('Ticketi kapatma onayı başlatır.'),
    async execute(client, interaction) {
      const ch = interaction.channel;
      if (!ch.topic || !ch.topic.startsWith('Ticket |')) return deny(interaction, 'Bu komut yalnızca ticket kanallarında kullanılır.');
      await askClose(interaction);
    }
  },

  /* ---------- MODERASYON ---------- */
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('ban').setDescription('Kullanıcıyı yasaklar.')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption(o => o.setName('kullanici').setDescription('Yasaklanacak kullanıcı').setRequired(true))
      .addStringOption(o => o.setName('sebep').setDescription('Ban sebebi'))
      .addIntegerOption(o => o.setName('mesaj_sil_gun').setDescription('Silinecek mesaj günü (0-7)').setMinValue(0).setMaxValue(7)),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.BanMembers])) return deny(interaction, 'Yetkin yok: `Üyeleri Yasakla`.');
      const target = await interaction.guild.members.fetch(interaction.options.getUser('kullanici').id).catch(() => null);
      if (!target) return deny(interaction, 'Kullanıcı sunucuda bulunamadı.');
      if (!hierarchyOk(interaction, target)) return deny(interaction, 'Rol hiyerarşisi engelliyor.');
      if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) return deny(interaction, 'Bende ban yetkisi yok.');
      const reason = interaction.options.getString('sebep') || 'Belirtilmedi';
      const days = interaction.options.getInteger('mesaj_sil_gun') ?? 0;
      await target.send({ embeds: [err(`**${interaction.guild.name}** sunucusundan yasaklandın.\nSebep: \`${reason}\``)] }).catch(() => {});
      await interaction.guild.members.ban(target.id, { deleteMessageSeconds: days * 86400, reason });
      addRecord(client, interaction.guild, target.id, 'BAN', interaction.user, reason);
      await interaction.reply({ embeds: [ok(`**${target.user.tag}** yasaklandı. Sebep: \`${reason}\``)] });
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('unban').setDescription('Yasağı kaldırır.')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addStringOption(o => o.setName('kullanici_id').setDescription('Kullanıcı ID').setRequired(true))
      .addStringOption(o => o.setName('sebep').setDescription('Sebep')),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.BanMembers])) return deny(interaction, 'Yetkin yok.');
      const id = interaction.options.getString('kullanici_id');
      if (!/^\d{15,25}$/.test(id)) return deny(interaction, 'Geçersiz kullanıcı ID.');
      try {
        await interaction.guild.members.unban(id, interaction.options.getString('sebep') || 'Unban');
        addRecord(client, interaction.guild, id, 'UNBAN', interaction.user, interaction.options.getString('sebep'));
        await interaction.reply({ embeds: [ok(`<@${id}> kullanıcısının yasağı kaldırıldı.`)] });
      } catch { return deny(interaction, 'Bu ID banlı değil veya bulunamadı.'); }
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('kick').setDescription('Kullanıcıyı sunucudan atar.')
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption(o => o.setName('kullanici').setDescription('Atılacak kullanıcı').setRequired(true))
      .addStringOption(o => o.setName('sebep').setDescription('Sebep')),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.KickMembers])) return deny(interaction, 'Yetkin yok: `Üyeleri At`.');
      const target = await interaction.guild.members.fetch(interaction.options.getUser('kullanici').id).catch(() => null);
      if (!target) return deny(interaction, 'Kullanıcı bulunamadı.');
      if (!hierarchyOk(interaction, target)) return deny(interaction, 'Rol hiyerarşisi engelliyor.');
      const reason = interaction.options.getString('sebep') || 'Belirtilmedi';
      await target.send({ embeds: [err(`**${interaction.guild.name}** sunucusundan atıldın.\nSebep: \`${reason}\``)] }).catch(() => {});
      await target.kick(reason);
      addRecord(client, interaction.guild, target.id, 'KICK', interaction.user, reason);
      await interaction.reply({ embeds: [ok(`**${target.user.tag}** sunucudan atıldı.`)] });
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('timeout').setDescription('Kullanıcıyı süreli susturur.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
      .addIntegerOption(o => o.setName('dakika').setDescription('Süre (dakika)').setRequired(true).setMinValue(1).setMaxValue(40320))
      .addStringOption(o => o.setName('sebep').setDescription('Sebep')),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, 'Yetkin yok.');
      const target = await interaction.guild.members.fetch(interaction.options.getUser('kullanici').id).catch(() => null);
      if (!target) return deny(interaction, 'Kullanıcı bulunamadı.');
      if (!hierarchyOk(interaction, target)) return deny(interaction, 'Rol hiyerarşisi engelliyor.');
      if (!target.moderatable) return deny(interaction, 'Bu üyeye zaman aşımı uygulayamam.');
      const min = interaction.options.getInteger('dakika');
      const reason = interaction.options.getString('sebep') || 'Belirtilmedi';
      await target.timeout(min * 60000, reason);
      addRecord(client, interaction.guild, target.id, 'TIMEOUT', interaction.user, `${min} dk — ${reason}`);
      await interaction.reply({ embeds: [ok(`**${target.user.tag}**, ${min} dakika susturuldu.`)] });
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('untimeout').setDescription('Susturmayı kaldırır.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
      .addStringOption(o => o.setName('sebep').setDescription('Sebep')),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, 'Yetkin yok.');
      const target = await interaction.guild.members.fetch(interaction.options.getUser('kullanici').id).catch(() => null);
      if (!target) return deny(interaction, 'Kullanıcı bulunamadı.');
      if (!target.isCommunicationDisabled()) return deny(interaction, 'Kullanıcı zaten susturulmamış.');
      await target.timeout(null, interaction.options.getString('sebep') || 'Untimeout');
      addRecord(client, interaction.guild, target.id, 'UNTIMEOUT', interaction.user, interaction.options.getString('sebep'));
      await interaction.reply({ embeds: [ok(`**${target.user.tag}** susturması kaldırıldı.`)] });
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('warn').setDescription('Kullanıcıyı uyarır.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
      .addStringOption(o => o.setName('sebep').setDescription('Uyarı sebebi').setRequired(true)),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, 'Yetkin yok.');
      const target = await interaction.guild.members.fetch(interaction.options.getUser('kullanici').id).catch(() => null);
      if (!target) return deny(interaction, 'Kullanıcı bulunamadı.');
      if (!hierarchyOk(interaction, target)) return deny(interaction, 'Rol hiyerarşisi engelliyor.');
      const reason = interaction.options.getString('sebep');
      const recId = addRecord(client, interaction.guild, target.id, 'WARN', interaction.user, reason);
      await target.send({ embeds: [err(`**${interaction.guild.name}** sunucusunda uyarıldın.\nSebep: \`${reason}\` (Kayıt: ${recId})`)] }).catch(() => {});
      await interaction.reply({ embeds: [ok(`**${target.user.tag}** uyarıldı. Kayıt: \`${recId}\``)] });
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('warnings').setDescription('Kullanıcının uyarı listesini gösterir.')
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)),
    async execute(client, interaction) {
      const user = interaction.options.getUser('kullanici');
      const recs = getRecords(interaction.guild, user.id).filter(r => r.type === 'WARN');
      if (!recs.length) return interaction.reply({ embeds: [info(`${user} kullanıcısının uyarısı yok.`)] });
      const emb = base(config.colors.warn).setTitle(`⚠️ ${user.tag} — Uyarılar (${recs.length})`);
      recs.slice(0, 20).forEach(r => emb.addFields({ name: `${r.id} • <t:${Math.floor(r.date / 1000)}:R>`, value: `Sebep: ${r.reason}\nYetkili: ${r.modTag}`, inline: false }));
      await interaction.reply({ embeds: [emb] });
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('clearwarn').setDescription('Kullanıcının uyarılarını siler.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, 'Yetkin yok.');
      const user = interaction.options.getUser('kullanici');
      const recs = getRecords(interaction.guild, user.id);
      db.set(`sicil_${interaction.guild.id}_${user.id}`, recs.filter(r => r.type !== 'WARN'));
      addRecord(client, interaction.guild, user.id, 'CLEARWARN', interaction.user, 'Uyarılar temizlendi');
      await interaction.reply({ embeds: [ok(`${user} kullanıcısının uyarıları temizlendi.`)] });
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('sil').setDescription('Mesajları toplu siler.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption(o => o.setName('miktar').setDescription('1-100 arası').setRequired(true).setMinValue(1).setMaxValue(100))
      .addBooleanOption(o => o.setName('sadece_bot').setDescription('Sadece bot mesajlarını sil')),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageMessages])) return deny(interaction, 'Yetkin yok: `Mesajları Yönet`.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const amount = interaction.options.getInteger('miktar');
      const onlyBots = interaction.options.getBoolean('sadece_bot') || false;
      const fetched = await interaction.channel.messages.fetch({ limit: amount });
      let list = onlyBots ? fetched.filter(m => m.author.bot) : fetched;
      list = list.filter(m => Date.now() - m.createdTimestamp < 1209600000);
      if (list.size === 0) return interaction.editReply({ embeds: [err('Silinecek mesaj bulunamadı (14 günden eskiler toplu silinemez).')] });
      if (list.size === 1) await list.first().delete().catch(() => {});
      else await interaction.channel.bulkDelete(list, true).catch(() => {});
      await interaction.editReply({ embeds: [ok(`**${list.size}** mesaj silindi.${onlyBots ? ' (sadece bot)' : ''}`)] });
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('kilitle').setDescription('Kanalı @everyone için kilitler.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageChannels])) return deny(interaction, 'Yetkin yok.');
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { SendMessages: false });
      await interaction.reply({ embeds: [ok(`🔒 ${interaction.channel} kanalı kilitlendi.`)] });
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('kilit-aç').setDescription('Kanal kilidini açar.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageChannels])) return deny(interaction, 'Yetkin yok.');
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { SendMessages: null });
      await interaction.reply({ embeds: [ok(`🔓 ${interaction.channel} kanalı kilidi açıldı.`)] });
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('isim-değiştir').setDescription('Kullanıcının takma adını değiştirir.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
      .addStringOption(o => o.setName('isim').setDescription('Yeni takma ad (max 32)').setRequired(true).setMaxLength(32)),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageNicknames])) return deny(interaction, 'Yetkin yok: `Takma Adları Yönet`.');
      const target = await interaction.guild.members.fetch(interaction.options.getUser('kullanici').id).catch(() => null);
      if (!target) return deny(interaction, 'Kullanıcı bulunamadı.');
      if (!hierarchyOk(interaction, target)) return deny(interaction, 'Rol hiyerarşisi engelliyor.');
      const newName = interaction.options.getString('isim');
      await target.setNickname(newName, `${interaction.user.tag} tarafından`);
      await interaction.reply({ embeds: [ok(`${target} kullanıcının ismi **${newName}** olarak değiştirildi.`)] });
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('oto-isim').setDescription('Yeni üyelere otomatik isim şablonu uygular.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption(o => o.setName('format').setDescription('Şablon: {tag} ve {isim}. Örn: {tag} | {isim}'))
      .addBooleanOption(o => o.setName('kapat').setDescription('Sistemi kapat')),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, 'Yetkin yok.');
      if (interaction.options.getBoolean('kapat')) { db.delete(`otoisim_${interaction.guild.id}`); return interaction.reply({ embeds: [ok('Oto-isim sistemi kapatıldı.')] }); }
      const fmt = interaction.options.getString('format');
      if (!fmt) return deny(interaction, 'Bir `format` belirt ya da `kapat: True` yap.');
      db.set(`otoisim_${interaction.guild.id}`, fmt);
      await interaction.reply({ embeds: [ok(`Oto-isim şablonu: \`${fmt}\``)] });
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('sicil').setDescription('Kullanıcının ceza geçmişini gösterir.')
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)),
    async execute(client, interaction) {
      const user = interaction.options.getUser('kullanici');
      const recs = getRecords(interaction.guild, user.id);
      const counts = {};
      recs.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
      const emb = base(config.colors.purple).setTitle(`📒 ${user.tag} — Sicil`)
        .setDescription(recs.length ? `Toplam kayıt: **${recs.length}**` : 'Bu kullanıcının sicili temiz. ✅');
      const summary = Object.entries(counts).map(([k, v]) => `\`${k}: ${v}\``).join(' ');
      if (summary) emb.addFields({ name: 'Özet', value: summary, inline: false });
      recs.slice(-5).reverse().forEach(r => emb.addFields({ name: `${r.id} • ${r.type} • <t:${Math.floor(r.date / 1000)}:R>`, value: `${r.reason} — ${r.modTag}`, inline: false }));
      await interaction.reply({ embeds: [emb] });
    }
  },
  {
    category: 'Moderasyon',
    data: new SlashCommandBuilder().setName('modlog').setDescription('Ceza log kanalını ayarlar.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption(o => o.setName('kanal').setDescription('Log kanalı').setRequired(true)),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, 'Yetkin yok.');
      db.set(`modlog_${interaction.guild.id}`, interaction.options.getChannel('kanal').id);
      await interaction.reply({ embeds: [ok(`Modlog kanalı ayarlandı: ${interaction.options.getChannel('kanal')}`)] });
    }
  },

  /* ---------- OTO-MODERASYON ---------- */
  {
    category: 'Oto-Moderasyon',
    data: new SlashCommandBuilder().setName('automod').setDescription('Oto-moderasyon sistemlerini yönetir.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption(o => o.setName('sistem').setDescription('Sistem').setRequired(true)
        .addChoices({ name: 'Küfür Filtresi', value: 'kufur' }, { name: 'Reklam Engeli', value: 'reklam' }, { name: 'Link Engeli', value: 'link' }, { name: 'Caps Engeli', value: 'caps' }, { name: 'Anti-Spam', value: 'spam' }))
      .addBooleanOption(o => o.setName('durum').setDescription('Aç/Kapat').setRequired(true))
      .addStringOption(o => o.setName('kelime_ekle').setDescription('Özel yasaklı kelime')),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, 'Yetkin yok.');
      const sys = interaction.options.getString('sistem');
      const on = interaction.options.getBoolean('durum');
      const word = interaction.options.getString('kelime_ekle');
      const key = `automod_${interaction.guild.id}`;
      const cur = db.get(key, {}) || {};
      cur[sys] = on;
      db.set(key, cur);
      let extra = '';
      if (word) {
        const words = db.get(`automod_words_${interaction.guild.id}`, null) || [];
        if (!words.includes(word.toLowerCase())) words.push(word.toLowerCase());
        db.set(`automod_words_${interaction.guild.id}`, words);
        extra = `\n📝 Yasaklı kelime eklendi: \`${word}\``;
      }
      await interaction.reply({ embeds: [ok(`**${sys.toUpperCase()}** sistemi ${on ? 'AÇILDI ✅' : 'KAPATILDI ❌'}.${extra}`)] });
    }
  },
  {
    category: 'Oto-Moderasyon',
    data: new SlashCommandBuilder().setName('otorol').setDescription('Otomatik rol sistemini ayarlar.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addRoleOption(o => o.setName('uye_rol').setDescription('Yeni üyelere verilecek rol'))
      .addRoleOption(o => o.setName('bot_rol').setDescription('Botlara verilecek rol'))
      .addBooleanOption(o => o.setName('kapat').setDescription('Sistemi kapat')),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, 'Yetkin yok.');
      if (interaction.options.getBoolean('kapat')) { db.delete(`otorol_${interaction.guild.id}`); return interaction.reply({ embeds: [ok('Oto-rol kapatıldı.')] }); }
      const member = interaction.options.getRole('uye_rol');
      const bot = interaction.options.getRole('bot_rol');
      if (!member && !bot) return deny(interaction, 'En az bir rol belirt.');
      db.set(`otorol_${interaction.guild.id}`, { member: member ? member.id : null, bot: bot ? bot.id : null });
      await interaction.reply({ embeds: [ok(`Oto-rol ayarlandı.\n👤 Üye: ${member || '-'}\n🤖 Bot: ${bot || '-'}`)] });
    }
  },
  {
    category: 'Oto-Moderasyon',
    data: new SlashCommandBuilder().setName('oto-tag').setDescription('Yeni üyelerin ismine otomatik tag ekler.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption(o => o.setName('tag').setDescription('Örn: ★ | ').setMaxLength(10))
      .addBooleanOption(o => o.setName('kapat').setDescription('Kapat')),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, 'Yetkin yok.');
      if (interaction.options.getBoolean('kapat')) { db.delete(`ototag_${interaction.guild.id}`); return interaction.reply({ embeds: [ok('Oto-tag kapatıldı.')] }); }
      const tag = interaction.options.getString('tag');
      if (!tag) return deny(interaction, 'Bir tag belirt.');
      db.set(`ototag_${interaction.guild.id}`, tag);
      await interaction.reply({ embeds: [ok(`Oto-tag ayarlandı: \`${tag}\` (örn: ${tag}Oyuncu)`)] });
    }
  },
  {
    category: 'Oto-Moderasyon',
    data: new SlashCommandBuilder().setName('sayac').setDescription('Sayaç sistemini ayarlar.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption(o => o.setName('kanal').setDescription('Sayaç kanalı').addChannelTypes(ChannelType.GuildText))
      .addIntegerOption(o => o.setName('hedef').setDescription('Hedef üye sayısı').setMinValue(1))
      .addBooleanOption(o => o.setName('kapat').setDescription('Kapat')),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, 'Yetkin yok.');
      if (interaction.options.getBoolean('kapat')) { db.delete(`sayac_${interaction.guild.id}`); return interaction.reply({ embeds: [ok('Sayaç kapatıldı.')] }); }
      const ch = interaction.options.getChannel('kanal');
      const target = interaction.options.getInteger('hedef');
      if (!ch || !target) {
        const cur = db.get(`sayac_${interaction.guild.id}`, null);
        if (!cur) return deny(interaction, 'Kanal ve hedef belirt.');
        return interaction.reply({ embeds: [info(`📊 Sayaç: hedef **${cur.target}**, kalan **${Math.max(0, cur.target - interaction.guild.memberCount)}**, kanal: <#${cur.channel}>`)] });
      }
      db.set(`sayac_${interaction.guild.id}`, { channel: ch.id, target });
      await interaction.reply({ embeds: [ok(`Sayaç ayarlandı: hedef **${target}**, kanal: ${ch}`)] });
    }
  },
  {
    category: 'Oto-Moderasyon',
    data: new SlashCommandBuilder().setName('welcome').setDescription('Karşılama ve giriş/çıkış log kanallarını ayarlar.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption(o => o.setName('karşılama').setDescription('Hoş geldin kanalı').addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o => o.setName('log').setDescription('Giriş/çıkış log kanalı').addChannelTypes(ChannelType.GuildText)),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, 'Yetkin yok.');
      const w = interaction.options.getChannel('karşılama');
      const l = interaction.options.getChannel('log');
      if (!w && !l) return deny(interaction, 'En az bir kanal belirt.');
      if (w) db.set(`welcome_${interaction.guild.id}`, w.id);
      if (l) db.set(`welcomelog_${interaction.guild.id}`, l.id);
      await interaction.reply({ embeds: [ok(`Karşılama: ${w || 'değişmedi'} | Log: ${l || 'değişmedi'}`)] });
    }
  },

  /* ---------- EMOJİ ---------- */
  {
    category: 'Emoji',
    data: new SlashCommandBuilder().setName('emoji-ekle').setDescription('Sunucuya emoji ekler.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
      .addStringOption(o => o.setName('isim').setDescription('Emoji adı').setRequired(true))
      .addAttachmentOption(o => o.setName('gorsel').setDescription('Görsel dosyası'))
      .addStringOption(o => o.setName('url').setDescription('Görsel URL'))
      .addStringOption(o => o.setName('emoji').setDescription('Başka sunucudan emoji yapıştır')),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageGuildExpressions])) return deny(interaction, 'Yetkin yok.');
      await interaction.deferReply();
      const name = interaction.options.getString('isim');
      const att = interaction.options.getAttachment('gorsel');
      const url = interaction.options.getString('url');
      const emojiStr = interaction.options.getString('emoji');
      try {
        let image = null;
        if (att) image = Buffer.from(await (await fetch(att.url)).arrayBuffer());
        else if (url) image = Buffer.from(await (await fetch(url)).arrayBuffer());
        else if (emojiStr) {
          const m = /<?(a)?:(\w{2,32}):(\d{17,25})>?/.exec(emojiStr);
          if (!m) throw new Error('Emoji çözümlenemedi');
          image = Buffer.from(await (await fetch(`https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? 'gif' : 'png'}`)).arrayBuffer());
        } else throw new Error('Kaynak yok');
        const emoji = await interaction.guild.emojis.create({ attachment: image, name });
        await interaction.editReply({ embeds: [ok(`Emoji eklendi: ${emoji} (\`${emoji.name}\`)`)] });
      } catch (e) { await interaction.editReply({ embeds: [err(`Emoji eklenemedi: ${e.message}`)] }); }
    }
  },
  {
    category: 'Emoji',
    data: new SlashCommandBuilder().setName('emoji-sil').setDescription('Sunucudan emoji siler.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
      .addStringOption(o => o.setName('emoji').setDescription('Emoji veya adı').setRequired(true)),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageGuildExpressions])) return deny(interaction, 'Yetkin yok.');
      const input = interaction.options.getString('emoji');
      let target = null;
      const m = /<?(a)?:(\w{2,32}):(\d{17,25})>?/.exec(input || '');
      if (m) target = interaction.guild.emojis.cache.get(m[3]);
      if (!target) target = interaction.guild.emojis.cache.find(e => e.name.toLowerCase() === input.toLowerCase());
      if (!target) return deny(interaction, 'Emoji bu sunucuda bulunamadı.');
      await target.delete(`Silen: ${interaction.user.tag}`);
      await interaction.reply({ embeds: [ok(`\`${target.name}\` emojisi silindi.`)] });
    }
  },
  {
    category: 'Emoji',
    data: new SlashCommandBuilder().setName('emoji-bilgi').setDescription('Emoji bilgisi gösterir.')
      .addStringOption(o => o.setName('emoji').setDescription('Emoji veya adı').setRequired(true)),
    async execute(client, interaction) {
      const input = interaction.options.getString('emoji');
      let target = null;
      const m = /<?(a)?:(\w{2,32}):(\d{17,25})>?/.exec(input || '');
      if (m) target = interaction.guild.emojis.cache.get(m[3]);
      if (!target) target = interaction.guild.emojis.cache.find(e => e.name.toLowerCase() === input.toLowerCase());
      if (!target) return deny(interaction, 'Emoji bulunamadı.');
      let size = 'Bilinmiyor';
      try {
        const buf = Buffer.from(await (await fetch(target.url)).arrayBuffer());
        size = `${(buf.length / 1024).toFixed(2)} KB`;
      } catch {}
      const emb = base(config.colors.gold).setThumbnail(target.url).setTitle(`ℹ️ ${target.name}`).addFields(
        { name: 'ID', value: `\`${target.id}\``, inline: true },
        { name: 'Animasyonlu', value: target.animated ? 'Evet' : 'Hayır', inline: true },
        { name: 'Boyut', value: size, inline: true },
        { name: 'Link', value: target.url, inline: false },
        { name: 'Kullanım', value: target.animated ? `<a:${target.name}:${target.id}>` : `<:${target.name}:${target.id}>`, inline: false });
      await interaction.reply({ embeds: [emb] });
    }
  },
  {
    category: 'Emoji',
    data: new SlashCommandBuilder().setName('emoji-toplu').setDescription('Toplu emoji yükler.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
      .addStringOption(o => o.setName('url_listesi').setDescription('Boşlukla ayrılmış görsel URL\'leri'))
      .addAttachmentOption(o => o.setName('ek').setDescription('Tek ek görsel')),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageGuildExpressions])) return deny(interaction, 'Yetkin yok.');
      await interaction.deferReply();
      const urls = (interaction.options.getString('url_listesi') || '').split(/\s+/).filter(u => /^https?:\/\//i.test(u)).slice(0, 10);
      const att = interaction.options.getAttachment('ek');
      if (att) urls.push(att.url);
      if (!urls.length) return interaction.editReply({ embeds: [err('Geçerli URL bulunamadı.')] });
      let added = 0, failed = 0;
      for (const u of urls) {
        try {
          const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
          await interaction.guild.emojis.create({ attachment: buf, name: 'emoji' + Date.now().toString().slice(-5) + added });
          added++;
        } catch { failed++; }
      }
      await interaction.editReply({ embeds: [ok(`Toplu yükleme bitti: ✅ ${added} eklendi, ❌ ${failed} başarısız.`)] });
    }
  },

  /* ---------- GENEL ---------- */
  {
    category: 'Genel',
    data: new SlashCommandBuilder().setName('yardim').setDescription('Tüm komutları listeler.'),
    async execute(client, interaction) {
      const groups = {};
      client.commands.forEach(c => { const cat = c.category || 'Genel'; if (!groups[cat]) groups[cat] = []; groups[cat].push(`\`/${c.data.name}\` — ${c.data.description}`); });
      const emb = base(config.colors.primary).setTitle('📚 BLOOMA Guardian — Yardım')
        .setDescription(`Toplam **${client.commands.size}** slash komutu.`).setThumbnail(client.user.displayAvatarURL());
      Object.entries(groups).forEach(([cat, list]) => emb.addFields({ name: `▸ ${cat} (${list.length})`, value: list.join('\n'), inline: false }));
      emb.setFooter({ text: 'JXRM Studio • Verification Ready' });
      await interaction.reply({ embeds: [emb] });
    }
  },
  {
    category: 'Genel',
    data: new SlashCommandBuilder().setName('sunucu-bilgi').setDescription('Sunucu istatistikleri.'),
    async execute(client, interaction) {
      const g = interaction.guild;
      const owner = await g.fetchOwner().catch(() => null);
      const emb = base(config.colors.gold).setTitle(`🏰 ${g.name}`).setThumbnail(g.iconURL() || '').addFields(
        { name: '👑 Sahip', value: owner ? owner.user.tag : 'Bilinmiyor', inline: true },
        { name: '👥 Üye', value: `${g.memberCount}`, inline: true },
        { name: '📺 Kanal', value: `${g.channels.cache.size}`, inline: true },
        { name: '🎭 Rol', value: `${g.roles.cache.size}`, inline: true },
        { name: '😄 Emoji', value: `${g.emojis.cache.size}`, inline: true },
        { name: '💎 Boost', value: `${g.premiumSubscriptionCount || 0} (Seviye ${g.premiumTier})`, inline: true },
        { name: '📅 Kuruluş', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:F>`, inline: false },
        { name: '🔐 Doğrulama', value: `${g.verificationLevel}`, inline: true });
      await interaction.reply({ embeds: [emb] });
    }
  },
  {
    category: 'Genel',
    data: new SlashCommandBuilder().setName('kullanici-bilgi').setDescription('Kullanıcı bilgisi gösterir.')
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı')),
    async execute(client, interaction) {
      const member = interaction.options.getMember('kullanici') || interaction.member;
      const u = member.user;
      const roles = member.roles.cache.filter(r => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position).map(r => `${r}`).slice(0, 12).join(' ') || 'Yok';
      const emb = base(config.colors.purple).setAuthor({ name: u.tag, iconURL: u.displayAvatarURL({ size: 256 }) })
        .setThumbnail(u.displayAvatarURL({ size: 512 })).addFields(
          { name: 'ID', value: `\`${u.id}\``, inline: true },
          { name: 'Bot mu?', value: u.bot ? 'Evet 🤖' : 'Hayır', inline: true },
          { name: 'Hesap Kurulumu', value: `<t:${Math.floor(u.createdTimestamp / 1000)}:R>`, inline: false },
          { name: 'Sunucuya Katılım', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '-', inline: false },
          { name: `Roller (${member.roles.cache.size - 1})`, value: roles, inline: false });
      await interaction.reply({ embeds: [emb] });
    }
  },
  {
    category: 'Genel',
    data: new SlashCommandBuilder().setName('avatar').setDescription('Kullanıcı avatarını gösterir.')
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı'))
      .addBooleanOption(o => o.setName('sunucu_avatari').setDescription('Sunucu özel avatarı')),
    async execute(client, interaction) {
      const member = interaction.options.getMember('kullanici') || interaction.member;
      const u = member.user;
      const guildAv = interaction.options.getBoolean('sunucu_avatari') ? member.avatarURL({ size: 1024 }) : null;
      const url = guildAv || u.displayAvatarURL({ size: 1024 });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('PNG').setURL(url.replace(/\.(webp|jpeg|jpg)/, '.png')).setStyle(ButtonStyle.Link),
        new ButtonBuilder().setLabel('JPG').setURL(url.replace(/\.(webp|png|jpeg)/, '.jpg')).setStyle(ButtonStyle.Link));
      await interaction.reply({ embeds: [base(config.colors.primary).setTitle(`🖼️ ${u.tag} avatar`).setImage(url)], components: [row] });
    }
  },
  {
    category: 'Genel',
    data: new SlashCommandBuilder().setName('banner').setDescription('Kullanıcı bannerını gösterir.')
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı')),
    async execute(client, interaction) {
      const u = await client.users.fetch(interaction.options.getUser('kullanici')?.id || interaction.user.id, { force: true });
      const url = u.bannerURL({ size: 1024 });
      if (!url) return interaction.reply({ embeds: [info('Bu kullanıcının bannerı yok.')], flags: MessageFlags.Ephemeral });
      await interaction.reply({ embeds: [base(config.colors.purple).setTitle(`fc ${u.tag} banner`).setImage(url)] });
    }
  },
  {
    category: 'Genel',
    data: new SlashCommandBuilder().setName('embed-yaz').setDescription('Modal ile özel embed oluşturur.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addChannelOption(o => o.setName('kanal').setDescription('Hedef kanal').addChannelTypes(ChannelType.GuildText)),
    async execute(client, interaction) {
      if (!hasPerms(interaction, [PermissionFlagsBits.ManageMessages])) return deny(interaction, 'Yetkin yok: `Mesajları Yönet`.');
      const ch = interaction.options.getChannel('kanal') || interaction.channel;
      const modal = new ModalBuilder().setCustomId(`embed_modal:${ch.id}`).setTitle('Embed Oluşturucu');
      const t = new TextInputBuilder().setCustomId('e_title').setLabel('Başlık').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256);
      const d = new TextInputBuilder().setCustomId('e_desc').setLabel('Açıklama').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000);
      const c = new TextInputBuilder().setCustomId('e_color').setLabel('Renk (hex, örn: #5865F2)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7);
      const bl = new TextInputBuilder().setCustomId('e_btnlabel').setLabel('Buton Etiketi (opsiyonel)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(51);
      const bu = new TextInputBuilder().setCustomId('e_btnurl').setLabel('Buton URL (https://...)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(512);
      modal.addComponents(
        new ActionRowBuilder().addComponents(t), new ActionRowBuilder().addComponents(d),
        new ActionRowBuilder().addComponents(c), new ActionRowBuilder().addComponents(bl),
        new ActionRowBuilder().addComponents(bu));
      await interaction.showModal(modal);
    }
  }
];

/* ============================ CLIENT ============================ */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember]
});
client.commands = new Collection();
commands.forEach(c => client.commands.set(c.data.name, c));

/* ============================ READY + DEPLOY ============================ */
client.once('clientReady', async () => {
  // Dinamik Durum Ayarlama Fonksiyonu
  const updatePresence = () => {
    const serverCount = client.guilds.cache.size;
    client.user.setPresence({ 
      activities: [{ 
        name: `${serverCount} Sunucu Tarafından Kullanılıyor`, 
        type: ActivityType.Playing 
      }], 
      status: 'online' 
    });
  };

  updatePresence();
  setInterval(updatePresence, 15 * 60 * 1000); // Her 15 dakikada bir sunucu sayısını günceller

  const body = client.commands.map(c => c.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    if (config.devGuild) await rest.put(Routes.applicationGuildCommands(config.clientId, config.devGuild), { body });
    else await rest.put(Routes.applicationCommands(config.clientId), { body });
    console.log(`[CMD] ${body.length} slash komutu yüklendi.`);
  } catch (e) { console.error('[CMD] Yüklenemedi:', e.message); }
  console.log(`[BOT] ${client.user.tag} çevrimiçi. ${client.guilds.cache.size} sunucu.`);
});

/* ============================ INTERACTION ROUTER ============================ */
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (cmd) await cmd.execute(client, interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
      return await openTicketModal(interaction, interaction.values[0]);
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('ticket_modal:')) return await createTicket(client, interaction);
      if (interaction.customId.startsWith('embed_modal:')) return await buildEmbedFromModal(interaction);
      return;
    }
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id === 'ticket_quick') return await openTicketModal(interaction, 'Destek');
      if (id === 't_close') return await askClose(interaction);
      if (id === 't_close_yes') return await closeTicket(interaction, true);
      if (id === 't_close_no') return await closeTicket(interaction, false);
      if (id === 't_lock') return await setLock(interaction, true);
      if (id === 't_unlock') return await setLock(interaction, false);
      if (id === 't_transcript') return await handleTranscript(interaction);
    }
  } catch (err) {
    console.error('[INTERACTION HATA]', err && err.stack ? err.stack : err);
    const payload = { content: '❌ Beklenmeyen bir hata oluştu. Durum loglandı.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch {}
  }
});

/* ============================ GUILD MEMBER ADD ============================ */
client.on('guildMemberAdd', async (member) => {
  const g = member.guild;
  try {
    const roles = db.get(`otorol_${g.id}`, null);
    if (roles) {
      const roleId = member.user.bot ? roles.bot : roles.member;
      if (roleId && g.roles.cache.has(roleId)) await member.roles.add(roleId, 'Oto-rol sistemi').catch(() => {});
    }
    const tag = db.get(`ototag_${g.id}`, null);
    const fmt = db.get(`otoisim_${g.id}`, null);
    let nick = null;
    if (fmt) nick = fmt.replace('{tag}', tag || '').replace('{isim}', member.user.username);
    else if (tag) nick = tag + member.user.username;
    if (nick) await member.setNickname(nick.slice(0, 32), 'Oto-isim sistemi').catch(() => {});

    const sayac = db.get(`sayac_${g.id}`, null);
    if (sayac && sayac.channel && g.channels.cache.has(sayac.channel)) {
      const kalan = Math.max(0, sayac.target - g.memberCount);
      await g.channels.cache.get(sayac.channel).send({
        embeds: [base(config.colors.success).setDescription(`🎉 **${member.user.tag}** sunucuya katıldı!`)
          .addFields({ name: 'Toplam Üye', value: `${g.memberCount}`, inline: true }, { name: 'Hedef', value: `${sayac.target}`, inline: true }, { name: 'Kalan', value: `${kalan}`, inline: true })]
      }).catch(() => {});
    }
    const wCh = db.get(`welcome_${g.id}`, null);
    if (wCh && g.channels.cache.has(wCh)) {
      await g.channels.cache.get(wCh).send({
        embeds: [base(config.colors.success)
          .setAuthor({ name: 'Yeni Üye!', iconURL: member.user.displayAvatarURL({ size: 256 }) })
          .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
          .setDescription(`**${member}** sunucumuza katıldı! Hoş geldin. 🎉`)
          .addFields({ name: '👥 Üye Sayısı', value: `${g.memberCount}`, inline: true }, { name: '📅 Hesap Kurulumu', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true })
          .setFooter({ text: `ID: ${member.id}` })]
      }).catch(() => {});
    }
    const logCh = db.get(`welcomelog_${g.id}`, null);
    if (logCh && g.channels.cache.has(logCh)) {
      await g.channels.cache.get(logCh).send({
        embeds: [base(config.colors.primary).setTitle('➡️ Üye Girişi')
          .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: 'Kullanıcı', value: `${member} (\`${member.id}\`)`, inline: false },
            { name: 'Hesap Kurulumu', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F> (<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>)`, inline: false },
            { name: 'Toplam Üye', value: `${g.memberCount}`, inline: true })]
      }).catch(() => {});
    }
  } catch (e) { console.error('[MEMBER ADD]', e.message); }
});

/* ============================ GUILD MEMBER REMOVE ============================ */
client.on('guildMemberRemove', async (member) => {
  const g = member.guild;
  try {
    const logCh = db.get(`welcomelog_${g.id}`, null);
    if (logCh && g.channels.cache.has(logCh)) {
      await g.channels.cache.get(logCh).send({
        embeds: [base(config.colors.error).setTitle('⬅️ Üye Çıkışı')
          .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: 'Kullanıcı', value: `${member.user.tag} (\`${member.id}\`)`, inline: false },
            { name: 'Katılma Tarihi', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'Bilinmiyor', inline: false },
            { name: 'Kalan Üye', value: `${g.memberCount}`, inline: true })]
      }).catch(() => {});
    }
    const sayac = db.get(`sayac_${g.id}`, null);
    if (sayac && sayac.channel && g.channels.cache.has(sayac.channel)) {
      const kalan = Math.max(0, sayac.target - g.memberCount);
      await g.channels.cache.get(sayac.channel).send({
        embeds: [base(config.colors.error).setDescription(`😢 **${member.user.tag}** sunucudan ayrıldı.\n📊 Hedefe kalan: **${kalan}** | Toplam: **${g.memberCount}**`)]
      }).catch(() => {});
    }
    db.delete(`ticket_open_${g.id}_${member.id}`);
  } catch (e) { console.error('[MEMBER REMOVE]', e.message); }
});

/* ============================ MESSAGE CREATE (AUTO-MOD) ============================ */
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot || message.webhookId) return;
  const g = message.guild;
  const settings = db.get(`automod_${g.id}`, null) || {};
  if (!Object.values(settings).some(v => v)) return;
  const bypass = message.member.permissions.has(PermissionFlagsBits.ManageMessages) || message.member.permissions.has(PermissionFlagsBits.Administrator);
  if (bypass) return;
  const content = message.content || '';
  const words = db.get(`automod_words_${g.id}`, null) || DEFAULT_WORDS;
  let violation = null;
  if (settings.kufur) { const low = content.toLowerCase(); if (words.some(w => low.includes(w))) violation = 'Küfür Filtresi'; }
  if (!violation && settings.reklam && /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)/i.test(content)) violation = 'Reklam / Davet Linki';
  if (!violation && settings.link && /(https?:\/\/|www\.)/i.test(content)) violation = 'Link Engeli';
  if (!violation && settings.caps) {
    const letters = content.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, '');
    const upper = content.replace(/[^A-ZÇĞİÖŞÜ]/g, '');
    if (content.length >= 8 && letters.length >= 8 && (upper.length / letters.length) > 0.7) violation = 'Caps-Lock Engeli';
  }
  if (!violation && settings.spam) {
    const now = Date.now();
    const arr = (spamMap.get(message.author.id) || []).filter(t => now - t < 3000);
    arr.push(now);
    spamMap.set(message.author.id, arr);
    if (arr.length > 4) { violation = 'Anti-Spam'; spamMap.set(message.author.id, []); }
  }
  if (!violation) return;
  await message.delete().catch(() => {});
  const notice = await message.channel.send({ embeds: [err(`**${message.author}**, oto-moderasyon ihlali: \`${violation}\`. Mesajın silindi.`)] }).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 5000);
  addRecord(client, g, message.author.id, 'AUTOMOD', client.user, `${violation} ihlali`);
  if (violation === 'Anti-Spam') await message.member.timeout(60000, 'Anti-spam otomatik ceza').catch(() => {});
});

/* ============================ EXPRESS KEEP-ALIVE (7/24) ============================ */
const app = express();
app.get('/', (req, res) => res.status(200).json({
  status: 'online',
  bot: client.user ? client.user.tag : 'booting',
  uptime: process.uptime(),
  ping: client.ws.ping,
  servers: client.guilds.cache.size
}));
app.get('/health', (req, res) => res.json({ ok: true }));
app.listen(config.port, () => console.log(`[WEB] Keep-alive :${config.port} ayakta.`));

/* ============================ GLOBAL ERROR HANDLING ============================ */
process.on('unhandledRejection', (e) => console.error('[UNHANDLED REJECTION]', e && e.stack ? e.stack : e));
process.on('uncaughtException', (e) => console.error('[UNCAUGHT EXCEPTION]', e && e.stack ? e.stack : e));
process.on('uncaughtExceptionMonitor', (e) => console.error('[EXCEPTION MONITOR]', e && e.stack ? e.stack : e));
process.on('warning', (w) => console.warn('[WARNING]', w.message));

/* ============================ LOGIN ============================ */
client.login(config.token).catch((e) => { console.error('[LOGIN] Hata:', e.message); process.exit(1); });
