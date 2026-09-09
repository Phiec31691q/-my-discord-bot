require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  REST,
  Routes,
  ActivityType,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  AuditLogEvent,
  MessageFlags
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ============================================================
   CONFIG
============================================================ */

const CONFIG = {
  token: process.env.TOKEN || "",
  clientId: process.env.CLIENT_ID || "",
  devGuildId: process.env.DEV_GUILD_ID || "",
  port: Number(process.env.PORT || 8080),
  owners: (process.env.OWNER_IDS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean),
  colors: {
    main: 0xf5c542,
    dark: 0x111827,
    success: 0x57f287,
    error: 0xed4245,
    warning: 0xfee75c,
    ai: 0x00e5ff,
    guard: 0xe74c3c,
    purple: 0x9d5cff,
    pink: 0xff7eb9,
    blue: 0x3498db,
    green: 0x2ecc71
  }
};

if (!CONFIG.token) console.error("TOKEN .env içinde yok.");
if (!CONFIG.clientId) console.error("CLIENT_ID .env içinde yok.");

/* ============================================================
   JSON DATABASE
============================================================ */

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let DB_CACHE = {};
try {
  DB_CACHE = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
} catch {
  DB_CACHE = {};
}

let dbWriteTimer = null;

function saveDbSoon() {
  if (dbWriteTimer) return;
  dbWriteTimer = setTimeout(() => {
    dbWriteTimer = null;
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(DB_CACHE, null, 2));
    } catch (err) {
      console.error("[DB WRITE ERROR]", err);
    }
  }, 300);
}

const db = {
  get(key, def = null) {
    return Object.prototype.hasOwnProperty.call(DB_CACHE, key) ? DB_CACHE[key] : def;
  },
  set(key, value) {
    DB_CACHE[key] = value;
    saveDbSoon();
    return value;
  },
  delete(key) {
    delete DB_CACHE[key];
    saveDbSoon();
  },
  add(key, value) {
    const current = Number(this.get(key, 0)) || 0;
    return this.set(key, current + value);
  },
  push(key, value) {
    const arr = this.get(key, []);
    if (!Array.isArray(arr)) return this.set(key, [value]);
    arr.push(value);
    return this.set(key, arr);
  },
  startsWith(prefix) {
    return Object.entries(DB_CACHE).filter(([k]) => k.startsWith(prefix));
  }
};

/* ============================================================
   CLIENT
============================================================ */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember]
});

client.commands = new Collection();

/* ============================================================
   HELPERS
============================================================ */

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function cleanText(text, max = 1900) {
  return String(text || "")
    .replace(/@everyone/g, "@\u200beveryone")
    .replace(/@here/g, "@\u200bhere")
    .slice(0, max);
}

function baseEmbed(color = CONFIG.colors.main) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

function jarmEmbed(color = CONFIG.colors.main) {
  const emb = baseEmbed(color);
  if (client.user) {
    emb.setFooter({
      text: "Jarm • JXRM Studio • Developer: 217i",
      iconURL: client.user.displayAvatarURL()
    });
    emb.setThumbnail(client.user.displayAvatarURL({ size: 256 }));
  }
  return emb;
}

function okEmbed(text) {
  return baseEmbed(CONFIG.colors.success).setDescription(`✅ ${text}`);
}

function errEmbed(text) {
  return baseEmbed(CONFIG.colors.error).setDescription(`❌ ${text}`);
}

function infoEmbed(text) {
  return baseEmbed(CONFIG.colors.main).setDescription(text);
}

function hasPerm(interaction, perms) {
  if (!interaction.member) return false;
  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return interaction.member.permissions.has(perms);
}

async function deny(interaction, text) {
  const payload = {
    embeds: [errEmbed(text)],
    flags: MessageFlags.Ephemeral
  };
  if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => {});
  return interaction.reply(payload).catch(() => {});
}

function hierarchyOk(interaction, targetMember) {
  const guild = interaction.guild;
  if (!guild || !targetMember) return false;
  if (targetMember.id === guild.ownerId) return false;
  if (interaction.user.id === guild.ownerId) return true;
  if (!guild.members.me) return false;

  const executorPos = interaction.member.roles.highest.position;
  const targetPos = targetMember.roles.highest.position;
  const botPos = guild.members.me.roles.highest.position;

  if (executorPos <= targetPos) return false;
  if (botPos <= targetPos) return false;
  return true;
}

function progressBar(current, max, size = 12) {
  const percent = max <= 0 ? 0 : Math.max(0, Math.min(1, current / max));
  const filled = Math.round(percent * size);
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/* ============================================================
   TRANSCRIPT
============================================================ */

function htmlEscape(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function createTranscript(channel, meta = {}) {
  const messages = [];
  let before;

  for (let i = 0; i < 5; i++) {
    const options = { limit: 100 };
    if (before) options.before = before;

    const batch = await channel.messages.fetch(options).catch(() => null);
    if (!batch || !batch.size) break;

    messages.push(...batch.values());
    before = batch.lastKey();

    if (batch.size < 100) break;
  }

  messages.reverse();

  const rows = messages.map(msg => {
    const content = msg.content ? htmlEscape(msg.content) : "";
    const attachments = msg.attachments.size
      ? `<br><i>Ekler: ${msg.attachments.map(a => `<a href="${a.url}">${htmlEscape(a.name || a.url)}</a>`).join(", ")}</i>`
      : "";

    return `
      <div class="msg">
        <img class="avatar" src="${msg.author.displayAvatarURL({ extension: "png" })}">
        <div>
          <div><b>${htmlEscape(msg.author.tag)}</b> <span>${new Date(msg.createdTimestamp).toLocaleString("tr-TR")}</span></div>
          <div>${content || "<i>Mesaj içeriği yok.</i>"}${attachments}</div>
        </div>
      </div>
    `;
  }).join("\n");

  const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>Jarm Ticket Transcript</title>
<style>
body{background:#111827;color:#e5e7eb;font-family:Arial,Helvetica,sans-serif;padding:24px}
h1{color:#f5c542}
.card{background:#1f2937;border:1px solid #374151;border-radius:14px;padding:18px;margin-bottom:16px}
.msg{display:flex;gap:12px;border-bottom:1px solid #374151;padding:10px 0}
.avatar{width:42px;height:42px;border-radius:50%}
span{color:#9ca3af;font-size:12px}
a{color:#00e5ff}
</style>
</head>
<body>
<div class="card">
<h1>🎫 Jarm Ticket Transkripti</h1>
<p><b>Kanal:</b> #${htmlEscape(channel.name)}</p>
<p><b>Sahip:</b> ${htmlEscape(meta.owner || "-")}</p>
<p><b>Kategori:</b> ${htmlEscape(meta.category || "-")}</p>
<p><b>Konu:</b> ${htmlEscape(meta.subject || "-")}</p>
<p><b>Tarih:</b> ${new Date().toLocaleString("tr-TR")}</p>
</div>
<div class="card">${rows || "<p>Mesaj bulunamadı.</p>"}</div>
</body>
</html>`;

  return new AttachmentBuilder(Buffer.from(html, "utf8"), {
    name: `transcript-${channel.name}-${Date.now()}.html`
  });
}

/* ============================================================
   MOD RECORDS
============================================================ */

function getRecords(guildId, userId) {
  return db.get(`records_${guildId}_${userId}`, []);
}

async function sendModLog(guild, embed) {
  const logId = db.get(`modlog_${guild.id}`, null);
  if (!logId) return;
  const ch = guild.channels.cache.get(logId);
  if (!ch) return;
  await ch.send({ embeds: [embed] }).catch(() => {});
}

function addRecord(guild, userId, type, moderator, reason) {
  const id = db.add(`recordseq_${guild.id}`, 1);
  const record = {
    id,
    type,
    reason: reason || "Belirtilmedi",
    moderatorId: moderator.id,
    moderatorTag: moderator.tag || moderator.username || "Jarm",
    date: Date.now()
  };

  db.push(`records_${guild.id}_${userId}`, record);

  sendModLog(
    guild,
    baseEmbed(CONFIG.colors.warning)
      .setTitle("📒 Ceza Kaydı")
      .addFields(
        { name: "Kayıt ID", value: `#${id}`, inline: true },
        { name: "Tür", value: `\`${type}\``, inline: true },
        { name: "Kullanıcı", value: `<@${userId}>`, inline: true },
        { name: "Yetkili", value: `${moderator}`, inline: true },
        { name: "Sebep", value: cleanText(reason || "Belirtilmedi", 1000), inline: false },
        { name: "Tarih", value: `<t:${nowSec()}:F>`, inline: false }
      )
  ).catch(() => {});

  return record;
}

/* ============================================================
   AI ENGINE
============================================================ */

const aiMemory = new Map();

const AI_SYSTEM_PROMPT = `
Sen Jarm adlı gelişmiş bir Discord yapay zeka asistanısın.
Geliştiricin 217i, stüdyon JXRM Studio.
Türkçe konuş, kullanıcı başka dil kullanırsa o dilde cevap ver.
Samimi, akıllı, doğal, akıcı, eğlenceli ve yardımcı ol.
Kullanıcıya bazen "kral" diye hitap edebilirsin.
Yasadışı eylemler, +18/NSFW içerik, zararlı talimatlar, nefret söylemi ve öz zarar konularında yardımcı olma; kısa ve kibar reddet.
Bunların dışında yaratıcı, özgür ve detaylı cevap ver.
Discord mesaj formatına uygun cevap ver.
`;

const blockedAiPatterns = [
  /çocuk.*(seks|porno|porn|istismar)/i,
  /(bomba|patlayıcı|silah).*(yap|üret|tarif|nasıl)/i,
  /(uyuşturucu|metamfetamin|eroin).*(yap|üret|tarif|nasıl)/i,
  /(intihar|kendimi öldür|self.?harm)/i,
  /(porno|pornografi|erotik hikaye|seks hikayesi)/i
];

function addAiMemory(userId, role, content) {
  const arr = aiMemory.get(userId) || [];
  arr.push({ role, content: String(content).slice(0, 2500) });
  while (arr.length > 12) arr.shift();
  aiMemory.set(userId, arr);
}

async function callAi(messages) {
  const groqKey = process.env.GROQ_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  if (!groqKey && !openAiKey) return null;

  const usingGroq = Boolean(groqKey);
  const url = usingGroq
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";

  const key = usingGroq ? groqKey : openAiKey;
  const model = process.env.AI_MODEL || (usingGroq ? "llama-3.1-8b-instant" : "gpt-3.5-turbo");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.85,
      max_tokens: 750,
      messages
    })
  }).catch(err => {
    console.error("[AI FETCH ERROR]", err);
    return null;
  });

  if (!res || !res.ok) {
    if (res) console.error("[AI HTTP ERROR]", res.status, await res.text().catch(() => ""));
    return null;
  }

  const json = await res.json().catch(() => null);
  return json?.choices?.[0]?.message?.content || null;
}

async function answerAiMessage(message, question) {
  if (!question.trim()) return;

  if (blockedAiPatterns.some(r => r.test(question))) {
    return message.reply({
      embeds: [errEmbed("Bu konuda yardımcı olamam kral. Zararlı, yasadışı veya +18 içeriklere destek veremem.")]
    }).catch(() => {});
  }

  await message.channel.sendTyping().catch(() => {});

  addAiMemory(message.author.id, "user", question);

  const messages = [
    { role: "system", content: AI_SYSTEM_PROMPT },
    ...(aiMemory.get(message.author.id) || [])
  ];

  const answer = await callAi(messages);

  if (!answer) {
    return message.reply({
      embeds: [errEmbed("AI motoruna ulaşılamadı. Render Environment kısmına `GROQ_API_KEY` eklediğinden emin ol.")]
    }).catch(() => {});
  }

  addAiMemory(message.author.id, "assistant", answer);

  const chunks = [];
  let text = answer;
  while (text.length > 1900) {
    let cut = text.lastIndexOf("\n", 1900);
    if (cut < 500) cut = text.lastIndexOf(" ", 1900);
    if (cut < 500) cut = 1900;
    chunks.push(text.slice(0, cut));
    text = text.slice(cut).trim();
  }
  if (text) chunks.push(text);

  for (const chunk of chunks) {
    await message.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.ai)
          .setAuthor({
            name: `Jarm AI • ${message.author.username}`,
            iconURL: message.author.displayAvatarURL()
          })
          .setDescription(cleanText(chunk, 4000))
      ]
    }).catch(() => {});
  }
}

/* ============================================================
   LEVEL SYSTEM
============================================================ */

const xpCooldown = new Map();

function getXp(guildId, userId) {
  return db.get(`xp_${guildId}_${userId}`, {
    xp: 0,
    level: 0,
    messages: 0
  });
}

function levelFromXp(xp) {
  return Math.floor(0.12 * Math.sqrt(xp));
}

function xpForLevel(level) {
  return Math.ceil(Math.pow(level / 0.12, 2));
}

async function giveXp(message) {
  const key = `${message.guild.id}_${message.author.id}`;
  const last = xpCooldown.get(key) || 0;
  if (Date.now() - last < 60000) return;

  xpCooldown.set(key, Date.now());

  const data = getXp(message.guild.id, message.author.id);
  const oldLevel = data.level;

  data.xp += randomInt(15, 25);
  data.messages += 1;
  data.level = levelFromXp(data.xp);

  db.set(`xp_${message.guild.id}_${message.author.id}`, data);

  if (data.level > oldLevel) {
    const levelRoles = db.get(`levelroles_${message.guild.id}`, {});
    const roleId = levelRoles[String(data.level)];

    if (roleId && message.guild.roles.cache.has(roleId)) {
      await message.member.roles.add(roleId, "Jarm seviye ödülü").catch(() => {});
    }

    await message.channel.send({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setTitle("🎉 Seviye Atladın!")
          .setDescription(`${message.member}, **${data.level}. seviyeye** ulaştın kral!`)
      ]
    }).catch(() => {});
  }
}

/* ============================================================
   TICKET SYSTEM
============================================================ */

const TICKET_CATEGORIES = [
  { label: "Destek", value: "destek", desc: "Genel destek ve yardım", color: CONFIG.colors.main },
  { label: "Şikayet", value: "sikayet", desc: "Üye / olay şikayetleri", color: CONFIG.colors.error },
  { label: "VIP / Satış", value: "vip", desc: "Satış, ödeme ve VIP işlemleri", color: CONFIG.colors.gold },
  { label: "Yetkili Başvurusu", value: "basvuru", desc: "Ekip başvurusu", color: CONFIG.colors.green }
];

function ticketCategory(value) {
  return TICKET_CATEGORIES.find(x => x.value === value) || TICKET_CATEGORIES[0];
}

async function showTicketModal(interaction, categoryValue) {
  const cat = ticketCategory(categoryValue);

  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal:${cat.value}`)
    .setTitle(`Jarm Ticket • ${cat.label}`);

  const subject = new TextInputBuilder()
    .setCustomId("subject")
    .setLabel("Konu")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(80)
    .setRequired(true)
    .setPlaceholder("Sorununun kısa başlığı");

  const detail = new TextInputBuilder()
    .setCustomId("detail")
    .setLabel("Detay")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true)
    .setPlaceholder("Sorununu detaylı şekilde anlat");

  modal.addComponents(
    new ActionRowBuilder().addComponents(subject),
    new ActionRowBuilder().addComponents(detail)
  );

  await interaction.showModal(modal);
}

async function createTicket(interaction) {
  const guild = interaction.guild;
  const categoryValue = interaction.customId.split(":")[1] || "destek";
  const cat = ticketCategory(categoryValue);

  const subject = interaction.fields.getTextInputValue("subject");
  const detail = interaction.fields.getTextInputValue("detail");

  const existing = db.get(`open_ticket_${guild.id}_${interaction.user.id}`, null);
  if (existing && guild.channels.cache.has(existing)) {
    return interaction.reply({
      embeds: [errEmbed(`Zaten açık ticketin var: <#${existing}>`)],
      flags: MessageFlags.Ephemeral
    });
  }

  const staffRoleId = db.get(`ticket_staff_${guild.id}`, null);

  const safeName = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ-]+/gi, "-")
    .slice(0, 20);

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory
      ]
    }
  ];

  if (staffRoleId && guild.roles.cache.has(staffRoleId)) {
    overwrites.push({
      id: staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    });
  }

  const channel = await guild.channels.create({
    name: `ticket-${safeName || "user"}`,
    type: ChannelType.GuildText,
    topic: `Jarm Ticket | Owner: ${interaction.user.id} | Category: ${cat.value}`,
    permissionOverwrites: overwrites,
    reason: "Jarm ticket oluşturuldu"
  });

  const meta = {
    ownerId: interaction.user.id,
    owner: interaction.user.tag,
    category: cat.label,
    subject,
    detail,
    openedAt: Date.now(),
    added: [],
    locked: false
  };

  db.set(`ticket_${channel.id}`, meta);
  db.set(`open_ticket_${guild.id}_${interaction.user.id}`, channel.id);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_close").setLabel("Kapat").setEmoji("🔒").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ticket_lock").setLabel("Kilitle").setEmoji("🔐").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket_transcript").setLabel("Transkript").setEmoji("📄").setStyle(ButtonStyle.Primary)
  );

  await channel.send({
    content: `${interaction.user}${staffRoleId ? ` <@&${staffRoleId}>` : ""}`,
    embeds: [
      jarmEmbed(cat.color)
        .setTitle(`🎫 ${cat.label} Ticket`)
        .setDescription(
          `**Konu:** ${cleanText(subject, 200)}\n` +
          `**Detay:** ${cleanText(detail, 1000)}\n\n` +
          `Yetkililer en kısa sürede ilgilenecek.`
        )
        .addFields(
          { name: "Açan", value: `${interaction.user}`, inline: true },
          { name: "Kategori", value: cat.label, inline: true },
          { name: "Açılış", value: `<t:${nowSec()}:F>`, inline: true }
        )
    ],
    components: [buttons]
  });

  await interaction.reply({
    embeds: [okEmbed(`Ticket oluşturuldu: ${channel}`)],
    flags: MessageFlags.Ephemeral
  });
}

async function askCloseTicket(interaction) {
  await interaction.reply({
    embeds: [infoEmbed("Bu ticket kapatılsın mı? Kapatılırken HTML transkript log kanalına gönderilir.")],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_close_yes").setLabel("Evet, Kapat").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("ticket_close_no").setLabel("Vazgeç").setStyle(ButtonStyle.Secondary)
      )
    ],
    flags: MessageFlags.Ephemeral
  });
}

async function closeTicket(interaction, yes) {
  if (!yes) {
    return interaction.update({
      embeds: [infoEmbed("Ticket kapatma işlemi iptal edildi.")],
      components: []
    });
  }

  const channel = interaction.channel;
  const meta = db.get(`ticket_${channel.id}`, null);
  const logId = db.get(`ticket_log_${channel.guild.id}`, null);
  const logChannel = logId ? channel.guild.channels.cache.get(logId) : null;

  if (logChannel) {
    const file = await createTranscript(channel, meta || {});
    await logChannel.send({
      embeds: [
        jarmEmbed(CONFIG.colors.error)
          .setTitle("🔒 Ticket Kapatıldı")
          .addFields(
            { name: "Kanal", value: `#${channel.name}`, inline: true },
            { name: "Kapatan", value: `${interaction.user}`, inline: true },
            { name: "Sahip", value: meta?.ownerId ? `<@${meta.ownerId}>` : "-", inline: true },
            { name: "Konu", value: meta?.subject || "-", inline: false }
          )
      ],
      files: [file]
    }).catch(() => {});
  }

  if (meta?.ownerId) db.delete(`open_ticket_${channel.guild.id}_${meta.ownerId}`);
  db.delete(`ticket_${channel.id}`);

  await interaction.update({
    embeds: [okEmbed("Ticket kapatılıyor...")],
    components: []
  });

  setTimeout(() => {
    channel.delete("Jarm ticket kapatıldı").catch(() => {});
  }, 4000);
}

async function lockTicket(interaction, lock) {
  const channel = interaction.channel;
  const meta = db.get(`ticket_${channel.id}`, null);

  if (!meta) {
    return interaction.reply({
      embeds: [errEmbed("Bu kanal bir Jarm ticket kanalı değil.")],
      flags: MessageFlags.Ephemeral
    });
  }

  const targetIds = [meta.ownerId, ...(meta.added || [])].filter(Boolean);

  for (const id of targetIds) {
    await channel.permissionOverwrites.edit(id, {
      SendMessages: lock ? false : null
    }).catch(() => {});
  }

  meta.locked = lock;
  db.set(`ticket_${channel.id}`, meta);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_close").setLabel("Kapat").setEmoji("🔒").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(lock ? "ticket_unlock" : "ticket_lock").setLabel(lock ? "Kilidi Aç" : "Kilitle").setEmoji(lock ? "🔓" : "🔐").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket_transcript").setLabel("Transkript").setEmoji("📄").setStyle(ButtonStyle.Primary)
  );

  await interaction.update({ components: [buttons] });
  await interaction.followUp({
    embeds: [okEmbed(lock ? "Ticket kilitlendi." : "Ticket kilidi açıldı.")],
    flags: MessageFlags.Ephemeral
  });
}

async function sendTicketTranscript(interaction) {
  const channel = interaction.channel;
  const meta = db.get(`ticket_${channel.id}`, null);
  const logId = db.get(`ticket_log_${channel.guild.id}`, null);
  const logChannel = logId ? channel.guild.channels.cache.get(logId) : null;

  if (!logChannel) {
    return interaction.reply({
      embeds: [errEmbed("Ticket log kanalı ayarlı değil.")],
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const file = await createTranscript(channel, meta || {});
  await logChannel.send({
    content: `📄 Transkript isteyen: ${interaction.user} | Kanal: ${channel.name}`,
    files: [file]
  }).catch(() => {});

  await interaction.editReply({
    embeds: [okEmbed("Transkript log kanalına gönderildi.")]
  });
}

/* ============================================================
   REGISTRATION SYSTEM
============================================================ */

async function applyRegistration(guild, member, data, gender, staffUser = null) {
  const cfg = db.get(`register_${guild.id}`, null);
  if (!cfg) throw new Error("Kayıt sistemi ayarlı değil.");

  const tag = cfg.tag || "";
  const nick = `${tag ? `${tag} ` : ""}${data.name} | ${data.age}`.slice(0, 32);

  await member.setNickname(nick, "Jarm kayıt sistemi").catch(() => {});

  if (cfg.unregisteredRole && guild.roles.cache.has(cfg.unregisteredRole)) {
    await member.roles.remove(cfg.unregisteredRole, "Jarm kayıt").catch(() => {});
  }

  const rolesToAdd = [];
  if (cfg.memberRole) rolesToAdd.push(cfg.memberRole);
  if (gender === "male" && cfg.maleRole) rolesToAdd.push(cfg.maleRole);
  if (gender === "female" && cfg.femaleRole) rolesToAdd.push(cfg.femaleRole);

  for (const roleId of rolesToAdd) {
    if (guild.roles.cache.has(roleId)) {
      await member.roles.add(roleId, "Jarm kayıt").catch(() => {});
    }
  }

  const stats = db.get(`register_stats_${guild.id}`, { total: 0, male: 0, female: 0 });
  stats.total += 1;
  if (gender === "male") stats.male += 1;
  if (gender === "female") stats.female += 1;
  db.set(`register_stats_${guild.id}`, stats);
  db.delete(`register_pending_${guild.id}_${member.id}`);

  if (cfg.logChannel && guild.channels.cache.has(cfg.logChannel)) {
    await guild.channels.cache.get(cfg.logChannel).send({
      embeds: [
        jarmEmbed(CONFIG.colors.success)
          .setTitle("📝 Kayıt Tamamlandı")
          .setDescription(`${member} başarıyla kayıt oldu.`)
          .addFields(
            { name: "Yeni İsim", value: `\`${nick}\``, inline: true },
            { name: "Cinsiyet", value: gender === "male" ? "♂ Erkek" : "♀ Kadın", inline: true },
            { name: "Yetkili", value: staffUser ? `${staffUser}` : "Kullanıcı formu", inline: true }
          )
      ]
    }).catch(() => {});
  }

  return nick;
}

function registrationModal() {
  const modal = new ModalBuilder()
    .setCustomId("register_modal")
    .setTitle("Jarm Kayıt Formu");

  const nameInput = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("İsmin")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(20)
    .setRequired(true)
    .setPlaceholder("Örn: Arda");

  const ageInput = new TextInputBuilder()
    .setCustomId("age")
    .setLabel("Yaşın")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(2)
    .setRequired(true)
    .setPlaceholder("Örn: 18");

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(ageInput)
  );

  return modal;
}

/* ============================================================
   GUARD
============================================================ */

const guardActions = new Map();
const joinTracker = new Map();

function getGuard(guildId) {
  return db.get(`guard_${guildId}`, {
    enabled: false,
    antiNuke: true,
    antiRaid: true,
    antiRole: true,
    logChannel: null,
    whitelistRoles: [],
    whitelistUsers: []
  });
}

function isGuardWhitelisted(guild, userId) {
  const cfg = getGuard(guild.id);
  if (userId === guild.ownerId) return true;
  if (userId === guild.members.me?.id) return true;
  if (cfg.whitelistUsers.includes(userId)) return true;

  const member = guild.members.cache.get(userId);
  if (!member) return false;

  return member.roles.cache.some(r => cfg.whitelistRoles.includes(r.id));
}

async function guardLog(guild, embed) {
  const cfg = getGuard(guild.id);
  if (!cfg.logChannel) return;
  const ch = guild.channels.cache.get(cfg.logChannel);
  if (!ch) return;
  await ch.send({ embeds: [embed] }).catch(() => {});
}

async function punishGuard(guild, executorId, reason) {
  const member = await guild.members.fetch(executorId).catch(() => null);

  if (member && member.moderatable) {
    await member.roles.set([], `Jarm Guard: ${reason}`).catch(() => {});
    await member.ban({ reason: `Jarm Guard: ${reason}` }).catch(() => {});
  }

  await guardLog(
    guild,
    jarmEmbed(CONFIG.colors.guard)
      .setTitle("🚨 Jarm Guard Müdahalesi")
      .setDescription(`Yetkisiz işlem tespit edildi.\n\n**Kişi:** <@${executorId}>\n**Sebep:** \`${reason}\`\n\nRolleri temizlendi ve ban denendi.`)
  );
}

async function registerGuardAction(guild, executorId, action) {
  if (isGuardWhitelisted(guild, executorId)) return;

  const key = `${guild.id}_${executorId}`;
  const arr = (guardActions.get(key) || []).filter(t => Date.now() - t < 10000);
  arr.push(Date.now());
  guardActions.set(key, arr);

  await guardLog(
    guild,
    jarmEmbed(CONFIG.colors.guard)
      .setTitle("⚠️ Guard Uyarısı")
      .setDescription(`<@${executorId}> tarafından \`${action}\` işlemi algılandı. Son 10 saniye: **${arr.length}/3**`)
  );

  if (arr.length >= 3) {
    guardActions.set(key, []);
    await punishGuard(guild, executorId, action);
  }
}

/* ============================================================
   AUTOMOD
============================================================ */

const defaultBadWords = [
  "amk", "aq", "amq", "orospu", "piç", "pic", "sik", "yarrak", "kahpe",
  "pezevenk", "ibne", "gavat", "amcık", "yavşak", "oc"
];

const spamMap = new Map();

async function runAutomod(message) {
  if (!message.guild || !message.member || message.author.bot) return false;

  const settings = db.get(`automod_${message.guild.id}`, {
    badword: false,
    invite: true,
    link: false,
    caps: false,
    spam: true
  });

  if (!Object.values(settings).some(Boolean)) return false;

  if (
    message.member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    message.member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    return false;
  }

  const content = message.content || "";
  let violation = null;

  if (settings.badword) {
    const words = db.get(`badwords_${message.guild.id}`, defaultBadWords);
    if (words.some(w => content.toLowerCase().includes(w))) violation = "Küfür filtresi";
  }

  if (!violation && settings.invite) {
    if (/(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)/i.test(content)) {
      violation = "Discord davet engeli";
    }
  }

  if (!violation && settings.link) {
    if (/(https?:\/\/|www\.)/i.test(content)) violation = "Link engeli";
  }

  if (!violation && settings.caps) {
    const letters = content.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, "");
    const upper = content.replace(/[^A-ZÇĞİÖŞÜ]/g, "");
    if (content.length >= 10 && letters.length >= 8 && upper.length / letters.length > 0.7) {
      violation = "Caps-lock engeli";
    }
  }

  if (!violation && settings.spam) {
    const key = `${message.guild.id}_${message.author.id}`;
    const recent = (spamMap.get(key) || []).filter(t => Date.now() - t < 3500);
    recent.push(Date.now());
    spamMap.set(key, recent);
    if (recent.length >= 5) {
      violation = "Anti-spam";
      spamMap.set(key, []);
    }
  }

  if (!violation) return false;

  await message.delete().catch(() => {});

  const warnMsg = await message.channel.send({
    embeds: [errEmbed(`${message.author}, oto-moderasyon ihlali: \`${violation}\`. Mesajın silindi.`)]
  }).catch(() => null);

  if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 5000);

  addRecord(message.guild, message.author.id, "AUTOMOD", client.user, violation);

  if (violation === "Anti-spam") {
    await message.member.timeout(60_000, "Jarm anti-spam").catch(() => {});
  }

  return true;
}

/* ============================================================
   MATH SAFE EVAL
============================================================ */

function calcExpression(expr) {
  const clean = String(expr).replace(/\s/g, "");
  if (!/^[0-9+\-*/().%^]+$/.test(clean)) throw new Error("Geçersiz ifade");

  const tokens = clean.match(/\d+\.?\d*|[+\-*/%^()]/g);
  if (!tokens || tokens.join("") !== clean) throw new Error("Geçersiz ifade");

  const prec = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };
  const out = [];
  const ops = [];
  let prev = null;

  for (const token of tokens) {
    if (/^\d/.test(token)) {
      out.push(Number(token));
    } else if (token === "(") {
      ops.push(token);
    } else if (token === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop());
      if (!ops.length) throw new Error("Parantez hatası");
      ops.pop();
    } else {
      if (token === "-" && (prev === null || prev === "(" || Object.prototype.hasOwnProperty.call(prec, prev))) {
        out.push(0);
      }
      while (
        ops.length &&
        ops[ops.length - 1] !== "(" &&
        prec[ops[ops.length - 1]] >= prec[token] &&
        token !== "^"
      ) {
        out.push(ops.pop());
      }
      ops.push(token);
    }
    prev = token;
  }

  while (ops.length) {
    const op = ops.pop();
    if (op === "(") throw new Error("Parantez hatası");
    out.push(op);
  }

  const stack = [];
  for (const item of out) {
    if (typeof item === "number") {
      stack.push(item);
    } else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new Error("İfade hatalı");
      if (item === "+") stack.push(a + b);
      else if (item === "-") stack.push(a - b);
      else if (item === "*") stack.push(a * b);
      else if (item === "/") stack.push(a / b);
      else if (item === "%") stack.push(a % b);
      else if (item === "^") stack.push(Math.pow(a, b));
    }
  }

  if (stack.length !== 1 || !Number.isFinite(stack[0])) throw new Error("Sonuç hatalı");
  return stack[0];
}

/* ============================================================
   SETUP HELPERS
============================================================ */

async function findOrCreateRole(guild, name, color, permissions = []) {
  let role = guild.roles.cache.find(r => r.name === name);
  if (role) return role;

  return guild.roles.create({
    name,
    color,
    permissions,
    reason: "Jarm otomatik sunucu kurulumu"
  });
}

async function findOrCreateCategory(guild, name, overwrites = []) {
  let cat = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
  if (cat) return cat;

  return guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    permissionOverwrites: overwrites,
    reason: "Jarm otomatik sunucu kurulumu"
  });
}

async function findOrCreateTextChannel(guild, parent, name, topic = null, overwrites = []) {
  let ch = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildText);
  if (ch) return ch;

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parent?.id || null,
    topic,
    permissionOverwrites: overwrites,
    reason: "Jarm otomatik sunucu kurulumu"
  });
}

/* ============================================================
   COMMANDS
============================================================ */

const commands = [];

/* -------------------- KURULUM -------------------- */

commands.push({
  category: "Kurulum",
  data: new SlashCommandBuilder()
    .setName("kurulum")
    .setDescription("Sunucuyu profesyonel Jarm sistemiyle A'dan Z'ye kurar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.Administrator])) return deny(interaction, "Bu komut için yönetici yetkisi gerekli.");

    await interaction.deferReply();

    const guild = interaction.guild;
    const everyone = guild.roles.everyone.id;

    const required = [
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ViewChannel
    ];

    for (const perm of required) {
      if (!guild.members.me.permissions.has(perm)) {
        return interaction.editReply({
          embeds: [errEmbed("Kurulum için bende `Rolleri Yönet`, `Kanalları Yönet` ve temel yönetim yetkileri olmalı.")]
        });
      }
    }

    const roles = {};
    roles.owner = await findOrCreateRole(guild, "👑 Jarm Owner", 0xf5c542, [PermissionFlagsBits.Administrator]);
    roles.admin = await findOrCreateRole(guild, "🛡️ Kurmay", 0xe74c3c, [PermissionFlagsBits.Administrator]);
    roles.mod = await findOrCreateRole(guild, "⚔️ Moderatör", 0x3498db, [
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ManageNicknames
    ]);
    roles.support = await findOrCreateRole(guild, "🛠️ Destek Ekibi", 0x2ecc71, [PermissionFlagsBits.ManageMessages]);
    roles.guard = await findOrCreateRole(guild, "🛡️ Guard Whitelist", 0x111827, []);
    roles.vip = await findOrCreateRole(guild, "💎 VIP", 0xf1c40f, []);
    roles.member = await findOrCreateRole(guild, "🌟 Üye", 0x95a5a6, []);
    roles.male = await findOrCreateRole(guild, "♂ Erkek", 0x1f8beb, []);
    roles.female = await findOrCreateRole(guild, "♀ Kadın", 0xff7eb9, []);
    roles.unregistered = await findOrCreateRole(guild, "• Kayıtsız", 0x7f8c8d, []);
    roles.l5 = await findOrCreateRole(guild, "🌱 Seviye 5", 0x2ecc71, []);
    roles.l10 = await findOrCreateRole(guild, "🌿 Seviye 10", 0x27ae60, []);
    roles.l25 = await findOrCreateRole(guild, "🌳 Seviye 25", 0xf39c12, []);
    roles.l50 = await findOrCreateRole(guild, "👑 Seviye 50", 0xe74c3c, []);

    const readOnly = [
      { id: everyone, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] }
    ];

    const publicWrite = [
      { id: everyone, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
    ];

    const staffOnly = [
      { id: everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: roles.admin.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: roles.mod.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: roles.support.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
    ];

    const catInfo = await findOrCreateCategory(guild, "📌 BİLGİLENDİRME", readOnly);
    const catCommunity = await findOrCreateCategory(guild, "🌐 TOPLULUK", publicWrite);
    const catRegister = await findOrCreateCategory(guild, "🚪 KAYIT", readOnly);
    const catSupport = await findOrCreateCategory(guild, "🎫 DESTEK", readOnly);
    const catStaff = await findOrCreateCategory(guild, "🔐 YETKİLİ", staffOnly);

    const chRules = await findOrCreateTextChannel(guild, catInfo, "📋・kurallar", "Sunucu kuralları");
    const chAnnouncements = await findOrCreateTextChannel(guild, catInfo, "📢・duyurular", "Resmi duyurular");
    const chCounter = await findOrCreateTextChannel(guild, catInfo, "📊・sayaç", "Üye sayacı");
    const chChat = await findOrCreateTextChannel(guild, catCommunity, "💬・sohbet", "Genel sohbet");
    const chAi = await findOrCreateTextChannel(guild, catCommunity, "🤖・jarm-ai", "Jarm AI sohbet kanalı");
    const chMedia = await findOrCreateTextChannel(guild, catCommunity, "🖼️・medya", "Medya paylaşımı");
    const chGame = await findOrCreateTextChannel(guild, catCommunity, "🎮・oyun-sohbet", "Oyun sohbeti");
    const chWelcome = await findOrCreateTextChannel(guild, catRegister, "👋・hoşgeldin", "Kayıt girişi");
    const chRegLog = await findOrCreateTextChannel(guild, catRegister, "📝・kayıt-log", "Kayıt logları", staffOnly);
    const chTicket = await findOrCreateTextChannel(guild, catSupport, "🎫・destek-talebi", "Ticket paneli");
    const chTicketLog = await findOrCreateTextChannel(guild, catSupport, "📄・ticket-log", "Ticket transkript logları", staffOnly);
    const chModLog = await findOrCreateTextChannel(guild, catStaff, "📚・mod-log", "Moderasyon logları", staffOnly);
    const chGuardLog = await findOrCreateTextChannel(guild, catStaff, "🚨・guard-log", "Guard logları", staffOnly);
    await findOrCreateTextChannel(guild, catStaff, "🛡️・yetkili-sohbet", "Yetkili sohbeti", staffOnly);

    db.set(`ticket_staff_${guild.id}`, roles.support.id);
    db.set(`ticket_log_${guild.id}`, chTicketLog.id);
    db.set(`modlog_${guild.id}`, chModLog.id);
    db.set(`welcome_${guild.id}`, chWelcome.id);
    db.set(`welcomelog_${guild.id}`, chRegLog.id);
    db.set(`ai_channels_${guild.id}`, [chAi.id]);
    db.set(`otorole_${guild.id}`, {
      member: roles.unregistered.id,
      bot: roles.vip.id
    });
    db.set(`register_${guild.id}`, {
      unregisteredRole: roles.unregistered.id,
      maleRole: roles.male.id,
      femaleRole: roles.female.id,
      memberRole: roles.member.id,
      tag: "✦",
      logChannel: chRegLog.id
    });
    db.set(`automod_${guild.id}`, {
      badword: true,
      invite: true,
      link: false,
      caps: false,
      spam: true
    });
    db.set(`guard_${guild.id}`, {
      enabled: true,
      antiNuke: true,
      antiRaid: true,
      antiRole: true,
      logChannel: chGuardLog.id,
      whitelistRoles: [roles.admin.id, roles.guard.id],
      whitelistUsers: []
    });
    db.set(`levelroles_${guild.id}`, {
      "5": roles.l5.id,
      "10": roles.l10.id,
      "25": roles.l25.id,
      "50": roles.l50.id
    });
    db.set(`counter_${guild.id}`, {
      channel: chCounter.id,
      target: 500
    });

    await chRules.send({
      embeds: [
        jarmEmbed(CONFIG.colors.error)
          .setTitle("📋 Sunucu Kuralları")
          .setDescription(
            "1. Saygı zorunludur.\n" +
            "2. Reklam ve davet linki yasaktır.\n" +
            "3. Spam, flood ve caps yasaktır.\n" +
            "4. +18/NSFW içerik yasaktır.\n" +
            "5. Yetkililere saygılı olun.\n" +
            "6. Kanal amacı dışında kullanım yapmayın.\n" +
            "7. Kuralları ihlal edenlere Jarm moderasyon sistemi işlem uygular."
          )
      ]
    }).catch(() => {});

    await chWelcome.send({
      embeds: [
        jarmEmbed(CONFIG.colors.success)
          .setTitle("👋 Jarm Kayıt Kapısı")
          .setDescription(
            "Sunucuya hoş geldin!\n\n" +
            "Kayıt olmak için aşağıdaki butona bas, formu doldur ve cinsiyet seçimini yap.\n" +
            "**Oy yok, bekleme yok, anında kayıt.**"
          )
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("register_start")
            .setLabel("Kayıt Ol")
            .setEmoji("📝")
            .setStyle(ButtonStyle.Success)
        )
      ]
    }).catch(() => {});

    await chTicket.send({
      embeds: [
        jarmEmbed(CONFIG.colors.main)
          .setTitle("🎫 Jarm Destek Merkezi")
          .setDescription("Destek talebi açmak için aşağıdaki menüden kategori seç.")
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("ticket_select")
            .setPlaceholder("Ticket kategorisi seç")
            .addOptions(TICKET_CATEGORIES.map(c => ({
              label: c.label,
              value: c.value,
              description: c.desc
            })))
        )
      ]
    }).catch(() => {});

    await chAi.send({
      embeds: [
        jarmEmbed(CONFIG.colors.ai)
          .setTitle("🤖 Jarm AI Sohbet")
          .setDescription("Bu kanalda mesaj yazarak ya da herhangi bir kanalda **@Jarm** etiketleyerek gerçek AI sohbet motorunu kullanabilirsin.")
      ]
    }).catch(() => {});

    await chAnnouncements.send({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setTitle("📢 Jarm Kurulumu Tamamlandı")
          .setDescription("Sunucu altyapısı, kayıt, ticket, AI, guard, automod ve level sistemleri aktif edildi.")
      ]
    }).catch(() => {});

    await interaction.editReply({
      embeds: [
        jarmEmbed(CONFIG.colors.success)
          .setTitle("🏗️ Kurulum Tamamlandı")
          .setDescription(
            "Jarm profesyonel sunucu sistemi kuruldu.\n\n" +
            "✅ Roller\n" +
            "✅ Kanallar\n" +
            "✅ Kayıt paneli\n" +
            "✅ Ticket paneli\n" +
            "✅ AI sohbet kanalı\n" +
            "✅ Guard sistemi\n" +
            "✅ Automod\n" +
            "✅ Level sistemi"
          )
      ]
    });
  }
});

/* -------------------- TICKET COMMANDS -------------------- */

commands.push({
  category: "Ticket",
  data: new SlashCommandBuilder()
    .setName("ticket-setup")
    .setDescription("Ticket paneli kurar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(o => o.setName("staff").setDescription("Yetkili rolü").setRequired(true))
    .addChannelOption(o => o.setName("log").setDescription("Ticket log kanalı").setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption(o => o.setName("panel").setDescription("Panel kanalı").addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yönet yetkisi gerekli.");

    const staff = interaction.options.getRole("staff");
    const log = interaction.options.getChannel("log");
    const panel = interaction.options.getChannel("panel") || interaction.channel;

    db.set(`ticket_staff_${interaction.guild.id}`, staff.id);
    db.set(`ticket_log_${interaction.guild.id}`, log.id);

    await panel.send({
      embeds: [
        jarmEmbed(CONFIG.colors.main)
          .setTitle("🎫 Jarm Destek Merkezi")
          .setDescription("Aşağıdaki menüden ticket kategorini seç.")
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("ticket_select")
            .setPlaceholder("Kategori seç")
            .addOptions(TICKET_CATEGORIES.map(c => ({
              label: c.label,
              value: c.value,
              description: c.desc
            })))
        )
      ]
    });

    await interaction.reply({
      embeds: [okEmbed(`Ticket paneli ${panel} kanalına kuruldu.`)],
      flags: MessageFlags.Ephemeral
    });
  }
});

commands.push({
  category: "Ticket",
  data: new SlashCommandBuilder()
    .setName("ticket-add")
    .setDescription("Ticket kanalına kullanıcı ekler.")
    .addUserOption(o => o.setName("kullanici").setDescription("Eklenecek kullanıcı").setRequired(true)),
  async execute(interaction) {
    const meta = db.get(`ticket_${interaction.channel.id}`, null);
    if (!meta) return deny(interaction, "Bu kanal ticket kanalı değil.");

    const user = interaction.options.getUser("kullanici");

    await interaction.channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    });

    if (!meta.added.includes(user.id)) meta.added.push(user.id);
    db.set(`ticket_${interaction.channel.id}`, meta);

    await interaction.reply({ embeds: [okEmbed(`${user} ticket kanalına eklendi.`)] });
  }
});

commands.push({
  category: "Ticket",
  data: new SlashCommandBuilder()
    .setName("ticket-remove")
    .setDescription("Ticket kanalından kullanıcı çıkarır.")
    .addUserOption(o => o.setName("kullanici").setDescription("Çıkarılacak kullanıcı").setRequired(true)),
  async execute(interaction) {
    const meta = db.get(`ticket_${interaction.channel.id}`, null);
    if (!meta) return deny(interaction, "Bu kanal ticket kanalı değil.");

    const user = interaction.options.getUser("kullanici");

    await interaction.channel.permissionOverwrites.edit(user.id, {
      ViewChannel: false,
      SendMessages: false
    });

    meta.added = meta.added.filter(id => id !== user.id);
    db.set(`ticket_${interaction.channel.id}`, meta);

    await interaction.reply({ embeds: [okEmbed(`${user} ticket kanalından çıkarıldı.`)] });
  }
});

commands.push({
  category: "Ticket",
  data: new SlashCommandBuilder()
    .setName("ticket-close")
    .setDescription("Bulunduğun ticket kanalını kapatır."),
  async execute(interaction) {
    const meta = db.get(`ticket_${interaction.channel.id}`, null);
    if (!meta) return deny(interaction, "Bu kanal ticket kanalı değil.");
    await askCloseTicket(interaction);
  }
});

/* -------------------- REGISTER COMMANDS -------------------- */

commands.push({
  category: "Kayıt",
  data: new SlashCommandBuilder()
    .setName("kayit-sistem")
    .setDescription("Kayıt sistemini ayarlar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(o => o.setName("kayitsiz").setDescription("Kayıtsız rolü").setRequired(true))
    .addRoleOption(o => o.setName("erkek").setDescription("Erkek rolü").setRequired(true))
    .addRoleOption(o => o.setName("kadin").setDescription("Kadın rolü").setRequired(true))
    .addRoleOption(o => o.setName("uye").setDescription("Üye rolü").setRequired(true))
    .addChannelOption(o => o.setName("log").setDescription("Kayıt log kanalı").addChannelTypes(ChannelType.GuildText))
    .addStringOption(o => o.setName("tag").setDescription("İsim tagı, örn: ✦").setMaxLength(5)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yönet yetkisi gerekli.");

    db.set(`register_${interaction.guild.id}`, {
      unregisteredRole: interaction.options.getRole("kayitsiz").id,
      maleRole: interaction.options.getRole("erkek").id,
      femaleRole: interaction.options.getRole("kadin").id,
      memberRole: interaction.options.getRole("uye").id,
      logChannel: interaction.options.getChannel("log")?.id || null,
      tag: interaction.options.getString("tag") || ""
    });

    await interaction.reply({ embeds: [okEmbed("Kayıt sistemi ayarlandı.")] });
  }
});

commands.push({
  category: "Kayıt",
  data: new SlashCommandBuilder()
    .setName("kayit-panel")
    .setDescription("Butonlu kayıt paneli gönderir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName("kanal").setDescription("Panel kanalı").addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yönet yetkisi gerekli.");

    const channel = interaction.options.getChannel("kanal") || interaction.channel;

    await channel.send({
      embeds: [
        jarmEmbed(CONFIG.colors.success)
          .setTitle("📝 Jarm Kayıt Sistemi")
          .setDescription("Kayıt olmak için aşağıdaki butona bas ve formu doldur.")
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("register_start")
            .setLabel("Kayıt Ol")
            .setEmoji("📝")
            .setStyle(ButtonStyle.Success)
        )
      ]
    });

    await interaction.reply({
      embeds: [okEmbed(`Kayıt paneli ${channel} kanalına gönderildi.`)],
      flags: MessageFlags.Ephemeral
    });
  }
});

commands.push({
  category: "Kayıt",
  data: new SlashCommandBuilder()
    .setName("kayit")
    .setDescription("Yetkili manuel kayıt yapar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption(o => o.setName("kullanici").setDescription("Kayıt edilecek üye").setRequired(true))
    .addStringOption(o => o.setName("isim").setDescription("İsim").setRequired(true).setMaxLength(20))
    .addIntegerOption(o => o.setName("yas").setDescription("Yaş").setRequired(true).setMinValue(8).setMaxValue(99))
    .addStringOption(o => o.setName("cinsiyet").setDescription("Cinsiyet").setRequired(true).addChoices(
      { name: "Erkek", value: "male" },
      { name: "Kadın", value: "female" }
    )),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageNicknames])) return deny(interaction, "Takma adları yönet yetkisi gerekli.");

    const member = await interaction.guild.members.fetch(interaction.options.getUser("kullanici").id).catch(() => null);
    if (!member) return deny(interaction, "Üye bulunamadı.");

    const data = {
      name: interaction.options.getString("isim"),
      age: interaction.options.getInteger("yas")
    };

    try {
      const nick = await applyRegistration(
        interaction.guild,
        member,
        data,
        interaction.options.getString("cinsiyet"),
        interaction.user
      );

      await interaction.reply({ embeds: [okEmbed(`${member} başarıyla kayıt edildi: \`${nick}\``)] });
    } catch (err) {
      await interaction.reply({ embeds: [errEmbed(err.message)] });
    }
  }
});

commands.push({
  category: "Kayıt",
  data: new SlashCommandBuilder()
    .setName("kayit-bilgi")
    .setDescription("Kayıt istatistiklerini gösterir."),
  async execute(interaction) {
    const stats = db.get(`register_stats_${interaction.guild.id}`, { total: 0, male: 0, female: 0 });

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.main)
          .setTitle("📝 Kayıt İstatistikleri")
          .addFields(
            { name: "Toplam", value: String(stats.total), inline: true },
            { name: "Erkek", value: String(stats.male), inline: true },
            { name: "Kadın", value: String(stats.female), inline: true }
          )
      ]
    });
  }
});

/* -------------------- AI COMMANDS -------------------- */

commands.push({
  category: "AI",
  data: new SlashCommandBuilder()
    .setName("ai-sor")
    .setDescription("Jarm AI'a soru sorar.")
    .addStringOption(o => o.setName("soru").setDescription("Sorun").setRequired(true).setMaxLength(1000)),
  async execute(interaction) {
    await interaction.deferReply();

    const question = interaction.options.getString("soru");

    if (blockedAiPatterns.some(r => r.test(question))) {
      return interaction.editReply({ embeds: [errEmbed("Bu konuda yardımcı olamam.")] });
    }

    addAiMemory(interaction.user.id, "user", question);

    const answer = await callAi([
      { role: "system", content: AI_SYSTEM_PROMPT },
      ...(aiMemory.get(interaction.user.id) || [])
    ]);

    if (!answer) {
      return interaction.editReply({
        embeds: [errEmbed("AI motoruna ulaşılamadı. `GROQ_API_KEY` veya `OPENAI_API_KEY` kontrol et.")]
      });
    }

    addAiMemory(interaction.user.id, "assistant", answer);

    await interaction.editReply({
      embeds: [
        jarmEmbed(CONFIG.colors.ai)
          .setAuthor({ name: `Jarm AI • ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
          .setDescription(cleanText(answer, 4000))
      ]
    });
  }
});

commands.push({
  category: "AI",
  data: new SlashCommandBuilder()
    .setName("ai-kanal")
    .setDescription("AI sohbet kanallarını yönetir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName("islem").setDescription("İşlem").setRequired(true).addChoices(
      { name: "ekle", value: "add" },
      { name: "sil", value: "remove" },
      { name: "liste", value: "list" }
    ))
    .addChannelOption(o => o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yönet yetkisi gerekli.");

    const action = interaction.options.getString("islem");
    const channel = interaction.options.getChannel("kanal") || interaction.channel;
    let list = db.get(`ai_channels_${interaction.guild.id}`, []);

    if (action === "add") {
      if (!list.includes(channel.id)) list.push(channel.id);
      db.set(`ai_channels_${interaction.guild.id}`, list);
      return interaction.reply({ embeds: [okEmbed(`${channel} AI kanalı olarak ayarlandı.`)] });
    }

    if (action === "remove") {
      list = list.filter(id => id !== channel.id);
      db.set(`ai_channels_${interaction.guild.id}`, list);
      return interaction.reply({ embeds: [okEmbed(`${channel} AI kanal listesinden çıkarıldı.`)] });
    }

    return interaction.reply({
      embeds: [infoEmbed(list.length ? list.map(id => `<#${id}>`).join("\n") : "AI kanalı ayarlı değil.")]
    });
  }
});

/* -------------------- GUARD COMMAND -------------------- */

commands.push({
  category: "Guard",
  data: new SlashCommandBuilder()
    .setName("guard")
    .setDescription("Jarm guard sistemini yönetir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("islem").setDescription("İşlem").setRequired(true).addChoices(
      { name: "durum", value: "status" },
      { name: "ac", value: "on" },
      { name: "kapat", value: "off" },
      { name: "log", value: "log" },
      { name: "whitelist-rol-ekle", value: "roleadd" },
      { name: "whitelist-rol-sil", value: "roleremove" }
    ))
    .addChannelOption(o => o.setName("kanal").setDescription("Guard log kanalı").addChannelTypes(ChannelType.GuildText))
    .addRoleOption(o => o.setName("rol").setDescription("Whitelist rolü")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.Administrator])) return deny(interaction, "Yönetici yetkisi gerekli.");

    const cfg = getGuard(interaction.guild.id);
    const action = interaction.options.getString("islem");

    if (action === "on") {
      cfg.enabled = true;
      db.set(`guard_${interaction.guild.id}`, cfg);
      return interaction.reply({ embeds: [okEmbed("Guard sistemi açıldı.")] });
    }

    if (action === "off") {
      cfg.enabled = false;
      db.set(`guard_${interaction.guild.id}`, cfg);
      return interaction.reply({ embeds: [okEmbed("Guard sistemi kapatıldı.")] });
    }

    if (action === "log") {
      const ch = interaction.options.getChannel("kanal");
      if (!ch) return deny(interaction, "Log kanalı belirt.");
      cfg.logChannel = ch.id;
      db.set(`guard_${interaction.guild.id}`, cfg);
      return interaction.reply({ embeds: [okEmbed(`Guard log kanalı ${ch} olarak ayarlandı.`)] });
    }

    if (action === "roleadd") {
      const role = interaction.options.getRole("rol");
      if (!role) return deny(interaction, "Rol belirt.");
      if (!cfg.whitelistRoles.includes(role.id)) cfg.whitelistRoles.push(role.id);
      db.set(`guard_${interaction.guild.id}`, cfg);
      return interaction.reply({ embeds: [okEmbed(`${role} guard whitelist'e eklendi.`)] });
    }

    if (action === "roleremove") {
      const role = interaction.options.getRole("rol");
      if (!role) return deny(interaction, "Rol belirt.");
      cfg.whitelistRoles = cfg.whitelistRoles.filter(id => id !== role.id);
      db.set(`guard_${interaction.guild.id}`, cfg);
      return interaction.reply({ embeds: [okEmbed(`${role} guard whitelist'ten çıkarıldı.`)] });
    }

    return interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.guard)
          .setTitle("🛡️ Jarm Guard Durumu")
          .addFields(
            { name: "Aktif", value: cfg.enabled ? "✅ Açık" : "❌ Kapalı", inline: true },
            { name: "Anti-Nuke", value: cfg.antiNuke ? "✅" : "❌", inline: true },
            { name: "Anti-Raid", value: cfg.antiRaid ? "✅" : "❌", inline: true },
            { name: "Sağ Tık Rol Koruma", value: cfg.antiRole ? "✅" : "❌", inline: true },
            { name: "Log", value: cfg.logChannel ? `<#${cfg.logChannel}>` : "Yok", inline: true },
            { name: "Whitelist Roller", value: cfg.whitelistRoles.length ? cfg.whitelistRoles.map(id => `<@&${id}>`).join("\n") : "Yok", inline: false }
          )
      ]
    });
  }
});

/* -------------------- MODERATION COMMANDS -------------------- */

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Kullanıcıyı banlar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true))
    .addStringOption(o => o.setName("sebep").setDescription("Sebep"))
    .addIntegerOption(o => o.setName("gun").setDescription("Mesaj silme günü 0-7").setMinValue(0).setMaxValue(7)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.BanMembers])) return deny(interaction, "Ban yetkin yok.");

    const user = interaction.options.getUser("kullanici");
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const reason = interaction.options.getString("sebep") || "Belirtilmedi";
    const days = interaction.options.getInteger("gun") || 0;

    if (member && !hierarchyOk(interaction, member)) return deny(interaction, "Rol hiyerarşisi nedeniyle işlem yapılamaz.");

    await interaction.guild.members.ban(user.id, {
      deleteMessageSeconds: days * 86400,
      reason
    });

    addRecord(interaction.guild, user.id, "BAN", interaction.user, reason);

    await interaction.reply({ embeds: [okEmbed(`${user.tag} banlandı.`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Kullanıcının banını kaldırır.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName("kullanici_id").setDescription("Kullanıcı ID").setRequired(true))
    .addStringOption(o => o.setName("sebep").setDescription("Sebep")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.BanMembers])) return deny(interaction, "Ban yetkin yok.");

    const id = interaction.options.getString("kullanici_id");
    const reason = interaction.options.getString("sebep") || "Belirtilmedi";

    await interaction.guild.members.unban(id, reason).catch(() => null);

    addRecord(interaction.guild, id, "UNBAN", interaction.user, reason);

    await interaction.reply({ embeds: [okEmbed(`<@${id}> banı kaldırıldı.`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kullanıcıyı sunucudan atar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true))
    .addStringOption(o => o.setName("sebep").setDescription("Sebep")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.KickMembers])) return deny(interaction, "Kick yetkin yok.");

    const member = await interaction.guild.members.fetch(interaction.options.getUser("kullanici").id).catch(() => null);
    if (!member) return deny(interaction, "Üye bulunamadı.");
    if (!hierarchyOk(interaction, member)) return deny(interaction, "Rol hiyerarşisi nedeniyle işlem yapılamaz.");

    const reason = interaction.options.getString("sebep") || "Belirtilmedi";

    await member.kick(reason);
    addRecord(interaction.guild, member.id, "KICK", interaction.user, reason);

    await interaction.reply({ embeds: [okEmbed(`${member.user.tag} sunucudan atıldı.`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Kullanıcıya timeout uygular.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true))
    .addIntegerOption(o => o.setName("dakika").setDescription("Dakika").setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName("sebep").setDescription("Sebep")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, "Timeout yetkin yok.");

    const member = await interaction.guild.members.fetch(interaction.options.getUser("kullanici").id).catch(() => null);
    if (!member) return deny(interaction, "Üye bulunamadı.");
    if (!hierarchyOk(interaction, member)) return deny(interaction, "Rol hiyerarşisi nedeniyle işlem yapılamaz.");
    if (!member.moderatable) return deny(interaction, "Bu kullanıcıya timeout atamıyorum.");

    const minutes = interaction.options.getInteger("dakika");
    const reason = interaction.options.getString("sebep") || "Belirtilmedi";

    await member.timeout(minutes * 60_000, reason);
    addRecord(interaction.guild, member.id, "TIMEOUT", interaction.user, `${minutes} dakika • ${reason}`);

    await interaction.reply({ embeds: [okEmbed(`${member} ${minutes} dakika susturuldu.`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Timeout kaldırır.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, "Timeout yetkin yok.");

    const member = await interaction.guild.members.fetch(interaction.options.getUser("kullanici").id).catch(() => null);
    if (!member) return deny(interaction, "Üye bulunamadı.");

    await member.timeout(null, "Jarm untimeout");

    addRecord(interaction.guild, member.id, "UNTIMEOUT", interaction.user, "Timeout kaldırıldı");

    await interaction.reply({ embeds: [okEmbed(`${member} timeout kaldırıldı.`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Kullanıcıyı uyarır.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true))
    .addStringOption(o => o.setName("sebep").setDescription("Sebep").setRequired(true)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, "Moderasyon yetkin yok.");

    const user = interaction.options.getUser("kullanici");
    const reason = interaction.options.getString("sebep");

    const record = addRecord(interaction.guild, user.id, "WARN", interaction.user, reason);

    await interaction.reply({ embeds: [okEmbed(`${user} uyarıldı. Kayıt: #${record.id}`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Kullanıcının uyarılarını gösterir.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true)),
  async execute(interaction) {
    const user = interaction.options.getUser("kullanici");
    const records = getRecords(interaction.guild.id, user.id).filter(r => r.type === "WARN");

    if (!records.length) {
      return interaction.reply({ embeds: [infoEmbed(`${user} kullanıcısının uyarısı yok.`)] });
    }

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.warning)
          .setTitle(`⚠️ ${user.tag} Uyarıları`)
          .setDescription(records.slice(-15).map(r => `**#${r.id}** • ${cleanText(r.reason, 80)} • <t:${Math.floor(r.date / 1000)}:R>`).join("\n"))
      ]
    });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("clearwarn")
    .setDescription("Kullanıcının uyarılarını temizler.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, "Moderasyon yetkin yok.");

    const user = interaction.options.getUser("kullanici");
    const records = getRecords(interaction.guild.id, user.id).filter(r => r.type !== "WARN");
    db.set(`records_${interaction.guild.id}_${user.id}`, records);

    addRecord(interaction.guild, user.id, "CLEARWARN", interaction.user, "Uyarılar temizlendi");

    await interaction.reply({ embeds: [okEmbed(`${user} uyarıları temizlendi.`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("sicil")
    .setDescription("Kullanıcının ceza geçmişini gösterir.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true)),
  async execute(interaction) {
    const user = interaction.options.getUser("kullanici");
    const records = getRecords(interaction.guild.id, user.id);

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.purple)
          .setTitle(`📒 ${user.tag} Sicil`)
          .setDescription(
            records.length
              ? records.slice(-15).reverse().map(r => `**#${r.id}** • \`${r.type}\` • ${cleanText(r.reason, 80)} • ${r.moderatorTag}`).join("\n")
              : "Sicil temiz. ✅"
          )
      ]
    });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("sil")
    .setDescription("Mesaj temizler.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName("miktar").setDescription("1-100").setRequired(true).setMinValue(1).setMaxValue(100))
    .addBooleanOption(o => o.setName("sadece_bot").setDescription("Sadece bot mesajları")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageMessages])) return deny(interaction, "Mesajları yönet yetkin yok.");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const amount = interaction.options.getInteger("miktar");
    const onlyBot = interaction.options.getBoolean("sadece_bot") || false;

    const fetched = await interaction.channel.messages.fetch({ limit: amount });
    let list = onlyBot ? fetched.filter(m => m.author.bot) : fetched;
    list = list.filter(m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);

    if (!list.size) return interaction.editReply({ embeds: [errEmbed("Silinecek uygun mesaj yok.")] });

    await interaction.channel.bulkDelete(list, true).catch(async () => {
      for (const msg of list.values()) await msg.delete().catch(() => {});
    });

    await interaction.editReply({ embeds: [okEmbed(`${list.size} mesaj silindi.`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("kilitle")
    .setDescription("Kanalı kilitler.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageChannels])) return deny(interaction, "Kanal yönet yetkin yok.");

    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, {
      SendMessages: false
    });

    await interaction.reply({ embeds: [okEmbed("Kanal kilitlendi. 🔒")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("kilit-ac")
    .setDescription("Kanal kilidini açar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageChannels])) return deny(interaction, "Kanal yönet yetkin yok.");

    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, {
      SendMessages: null
    });

    await interaction.reply({ embeds: [okEmbed("Kanal kilidi açıldı. 🔓")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("modlog")
    .setDescription("Moderasyon log kanalını ayarlar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName("kanal").setDescription("Log kanalı").setRequired(true).addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yönet yetkisi gerekli.");

    const channel = interaction.options.getChannel("kanal");
    db.set(`modlog_${interaction.guild.id}`, channel.id);

    await interaction.reply({ embeds: [okEmbed(`Modlog kanalı ${channel} olarak ayarlandı.`)] });
  }
});

/* -------------------- AUTOMOD / SYSTEM COMMANDS -------------------- */

commands.push({
  category: "Sistem",
  data: new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Otomatik moderasyon sistemlerini yönetir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName("sistem").setDescription("Sistem").setRequired(true).addChoices(
      { name: "küfür", value: "badword" },
      { name: "davet", value: "invite" },
      { name: "link", value: "link" },
      { name: "caps", value: "caps" },
      { name: "spam", value: "spam" }
    ))
    .addBooleanOption(o => o.setName("durum").setDescription("Aç/Kapat").setRequired(true))
    .addStringOption(o => o.setName("kelime").setDescription("Küfür filtresine özel kelime ekle")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yönet yetkisi gerekli.");

    const system = interaction.options.getString("sistem");
    const status = interaction.options.getBoolean("durum");
    const word = interaction.options.getString("kelime");

    const settings = db.get(`automod_${interaction.guild.id}`, {
      badword: false,
      invite: true,
      link: false,
      caps: false,
      spam: true
    });

    settings[system] = status;
    db.set(`automod_${interaction.guild.id}`, settings);

    if (word) {
      const list = db.get(`badwords_${interaction.guild.id}`, defaultBadWords);
      if (!list.includes(word.toLowerCase())) list.push(word.toLowerCase());
      db.set(`badwords_${interaction.guild.id}`, list);
    }

    await interaction.reply({
      embeds: [okEmbed(`Automod sistemi güncellendi: \`${system}\` = ${status ? "Açık" : "Kapalı"}${word ? `\nKelime eklendi: \`${word}\`` : ""}`)]
    });
  }
});

commands.push({
  category: "Sistem",
  data: new SlashCommandBuilder()
    .setName("otorol")
    .setDescription("Otomatik rol sistemini ayarlar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(o => o.setName("uye_rol").setDescription("Yeni üye rolü"))
    .addRoleOption(o => o.setName("bot_rol").setDescription("Bot rolü"))
    .addBooleanOption(o => o.setName("kapat").setDescription("Sistemi kapat")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yönet yetkisi gerekli.");

    if (interaction.options.getBoolean("kapat")) {
      db.delete(`otorole_${interaction.guild.id}`);
      return interaction.reply({ embeds: [okEmbed("Otorol sistemi kapatıldı.")] });
    }

    const memberRole = interaction.options.getRole("uye_rol");
    const botRole = interaction.options.getRole("bot_rol");

    db.set(`otorole_${interaction.guild.id}`, {
      member: memberRole?.id || null,
      bot: botRole?.id || null
    });

    await interaction.reply({ embeds: [okEmbed("Otorol sistemi ayarlandı.")] });
  }
});

commands.push({
  category: "Sistem",
  data: new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Karşılama ve giriş/çıkış log kanallarını ayarlar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName("kanal").setDescription("Karşılama kanalı").addChannelTypes(ChannelType.GuildText))
    .addChannelOption(o => o.setName("log").setDescription("Giriş/çıkış log kanalı").addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yönet yetkisi gerekli.");

    const channel = interaction.options.getChannel("kanal");
    const log = interaction.options.getChannel("log");

    if (channel) db.set(`welcome_${interaction.guild.id}`, channel.id);
    if (log) db.set(`welcomelog_${interaction.guild.id}`, log.id);

    await interaction.reply({ embeds: [okEmbed("Welcome sistemi güncellendi.")] });
  }
});

commands.push({
  category: "Sistem",
  data: new SlashCommandBuilder()
    .setName("sayac")
    .setDescription("Sayaç sistemini ayarlar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName("kanal").setDescription("Sayaç kanalı").addChannelTypes(ChannelType.GuildText))
    .addIntegerOption(o => o.setName("hedef").setDescription("Hedef üye sayısı").setMinValue(1))
    .addBooleanOption(o => o.setName("kapat").setDescription("Sayaç kapat")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yönet yetkisi gerekli.");

    if (interaction.options.getBoolean("kapat")) {
      db.delete(`counter_${interaction.guild.id}`);
      return interaction.reply({ embeds: [okEmbed("Sayaç kapatıldı.")] });
    }

    const channel = interaction.options.getChannel("kanal");
    const target = interaction.options.getInteger("hedef");

    if (!channel || !target) {
      const cfg = db.get(`counter_${interaction.guild.id}`, null);
      if (!cfg) return interaction.reply({ embeds: [infoEmbed("Sayaç sistemi ayarlı değil.")] });
      return interaction.reply({
        embeds: [infoEmbed(`Sayaç hedefi: **${cfg.target}** | Kalan: **${Math.max(0, cfg.target - interaction.guild.memberCount)}** | Kanal: <#${cfg.channel}>`)]
      });
    }

    db.set(`counter_${interaction.guild.id}`, {
      channel: channel.id,
      target
    });

    await interaction.reply({ embeds: [okEmbed(`Sayaç ayarlandı: ${channel} • hedef ${target}`)] });
  }
});

/* -------------------- LEVEL COMMANDS -------------------- */

commands.push({
  category: "Level",
  data: new SlashCommandBuilder()
    .setName("level")
    .setDescription("Seviye kartını gösterir.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı")),
  async execute(interaction) {
    const user = interaction.options.getUser("kullanici") || interaction.user;
    const data = getXp(interaction.guild.id, user.id);

    const currentLevelXp = xpForLevel(data.level);
    const nextLevelXp = xpForLevel(data.level + 1);
    const progress = data.xp - currentLevelXp;
    const needed = nextLevelXp - currentLevelXp;

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setAuthor({ name: `${user.username} • Seviye Kartı`, iconURL: user.displayAvatarURL() })
          .setThumbnail(user.displayAvatarURL({ size: 512 }))
          .addFields(
            { name: "Seviye", value: String(data.level), inline: true },
            { name: "XP", value: String(data.xp), inline: true },
            { name: "Mesaj", value: String(data.messages), inline: true },
            { name: "İlerleme", value: `${progressBar(progress, needed)} ${Math.round((progress / needed) * 100)}%`, inline: false }
          )
      ]
    });
  }
});

commands.push({
  category: "Level",
  data: new SlashCommandBuilder()
    .setName("liderlik")
    .setDescription("Sunucu seviye liderliğini gösterir."),
  async execute(interaction) {
    const rows = db.startsWith(`xp_${interaction.guild.id}_`)
      .map(([key, value]) => ({
        userId: key.split("_")[2],
        ...value
      }))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 10);

    if (!rows.length) return interaction.reply({ embeds: [infoEmbed("Henüz seviye verisi yok.")] });

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setTitle("🏆 Seviye Liderliği")
          .setDescription(rows.map((r, i) => `**${i + 1}.** <@${r.userId}> • Level **${r.level}** • **${r.xp} XP**`).join("\n"))
      ]
    });
  }
});

commands.push({
  category: "Level",
  data: new SlashCommandBuilder()
    .setName("level-rol")
    .setDescription("Seviye ödül rolü ayarlar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addIntegerOption(o => o.setName("seviye").setDescription("Seviye").setRequired(true).setMinValue(1))
    .addRoleOption(o => o.setName("rol").setDescription("Rol, boş bırakırsan siler")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageRoles])) return deny(interaction, "Rolleri yönet yetkisi gerekli.");

    const level = interaction.options.getInteger("seviye");
    const role = interaction.options.getRole("rol");
    const roles = db.get(`levelroles_${interaction.guild.id}`, {});

    if (role) roles[String(level)] = role.id;
    else delete roles[String(level)];

    db.set(`levelroles_${interaction.guild.id}`, roles);

    await interaction.reply({
      embeds: [okEmbed(role ? `Level ${level} ödül rolü ${role} oldu.` : `Level ${level} ödül rolü silindi.`)]
    });
  }
});

/* -------------------- EXTRA COMMANDS -------------------- */

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("yardim").setDescription("Komut listesini gösterir."),
  async execute(interaction) {
    const groups = {};
    for (const cmd of client.commands.values()) {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category].push(`\`/${cmd.data.name}\``);
    }

    const emb = jarmEmbed(CONFIG.colors.main)
      .setTitle("📚 Jarm Yardım Menüsü")
      .setDescription(`Toplam **${client.commands.size}** slash komut aktif.`);

    for (const [cat, list] of Object.entries(groups)) {
      emb.addFields({ name: `▸ ${cat}`, value: list.join(" "), inline: false });
    }

    await interaction.reply({ embeds: [emb] });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("ping").setDescription("Bot gecikmesini gösterir."),
  async execute(interaction) {
    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.ai)
          .setTitle("🏓 Pong!")
          .setDescription(`WebSocket ping: **${client.ws.ping}ms**`)
      ]
    });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("hakkinda").setDescription("Jarm hakkında bilgi verir."),
  async execute(interaction) {
    const uptime = Math.floor(process.uptime());
    const d = Math.floor(uptime / 86400);
    const h = Math.floor((uptime % 86400) / 3600);
    const m = Math.floor((uptime % 3600) / 60);

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.main)
          .setTitle("🛡️ Jarm Bot Hakkında")
          .setDescription(
            "**Jarm**, 217i tarafından geliştirilen gelişmiş Discord yönetim botudur.\n\n" +
            "Ticket, kayıt, moderasyon, guard, AI sohbet, level, automod ve yardımcı sistemleri tek çatı altında sunar."
          )
          .addFields(
            { name: "Developer", value: "217i", inline: true },
            { name: "Studio", value: "JXRM Studio", inline: true },
            { name: "Altyapı", value: "Discord.js v14 • Node.js • Express", inline: false },
            { name: "Uptime", value: `${d}g ${h}s ${m}d`, inline: true },
            { name: "Sunucu", value: String(client.guilds.cache.size), inline: true },
            { name: "Komut", value: String(client.commands.size), inline: true }
          )
      ]
    });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("sunucu-bilgi").setDescription("Sunucu bilgilerini gösterir."),
  async execute(interaction) {
    const guild = interaction.guild;
    const owner = await guild.fetchOwner().catch(() => null);

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setTitle(`🏰 ${guild.name}`)
          .setThumbnail(guild.iconURL({ size: 512 }) || client.user.displayAvatarURL())
          .addFields(
            { name: "Sahip", value: owner ? `${owner}` : "Bilinmiyor", inline: true },
            { name: "Üye", value: String(guild.memberCount), inline: true },
            { name: "Kanal", value: String(guild.channels.cache.size), inline: true },
            { name: "Rol", value: String(guild.roles.cache.size), inline: true },
            { name: "Emoji", value: String(guild.emojis.cache.size), inline: true },
            { name: "Boost", value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
            { name: "Kuruluş", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: false }
          )
      ]
    });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder()
    .setName("kullanici-bilgi")
    .setDescription("Kullanıcı bilgilerini gösterir.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı")),
  async execute(interaction) {
    const member = interaction.options.getMember("kullanici") || interaction.member;
    const user = member.user;
    const roles = member.roles.cache
      .filter(r => r.id !== interaction.guild.id)
      .sort((a, b) => b.position - a.position)
      .map(r => `${r}`)
      .slice(0, 15)
      .join(" ") || "Yok";

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.purple)
          .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
          .setThumbnail(user.displayAvatarURL({ size: 512 }))
          .addFields(
            { name: "ID", value: `\`${user.id}\``, inline: true },
            { name: "Bot", value: user.bot ? "Evet" : "Hayır", inline: true },
            { name: "Hesap", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: "Katılım", value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "Bilinmiyor", inline: true },
            { name: "Roller", value: roles, inline: false }
          )
      ]
    });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Kullanıcı avatarını gösterir.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı")),
  async execute(interaction) {
    const user = interaction.options.getUser("kullanici") || interaction.user;
    const url = user.displayAvatarURL({ size: 1024 });

    await interaction.reply({
      embeds: [baseEmbed(CONFIG.colors.main).setTitle(`🖼️ ${user.username} Avatar`).setImage(url)],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel("Avatarı Aç").setURL(url).setStyle(ButtonStyle.Link)
        )
      ]
    });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder()
    .setName("banner")
    .setDescription("Kullanıcı bannerını gösterir.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı")),
  async execute(interaction) {
    const user = await client.users.fetch(interaction.options.getUser("kullanici")?.id || interaction.user.id, { force: true });
    const url = user.bannerURL({ size: 1024 });

    if (!url) {
      return interaction.reply({
        embeds: [infoEmbed("Bu kullanıcının bannerı yok.")],
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.reply({
      embeds: [baseEmbed(CONFIG.colors.purple).setTitle(`🎇 ${user.username} Banner`).setImage(url)]
    });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder()
    .setName("embed-yaz")
    .setDescription("Modal ile özel embed oluşturur.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName("kanal").setDescription("Hedef kanal").addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageMessages])) return deny(interaction, "Mesajları yönet yetkisi gerekli.");

    const channel = interaction.options.getChannel("kanal") || interaction.channel;

    const modal = new ModalBuilder()
      .setCustomId(`embed_modal:${channel.id}`)
      .setTitle("Jarm Embed Oluşturucu");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("title").setLabel("Başlık").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("desc").setLabel("Açıklama").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("color").setLabel("Renk HEX, örn: #f5c542").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("button").setLabel("Buton: Etiket | https://link").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300)
      )
    );

    await interaction.showModal(modal);
  }
});

commands.push({
  category: "Eğlence",
  data: new SlashCommandBuilder().setName("yazitura").setDescription("Yazı tura atar."),
  async execute(interaction) {
    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setTitle("🪙 Yazı Tura")
          .setDescription(`Sonuç: **${Math.random() < 0.5 ? "YAZI" : "TURA"}**`)
      ]
    });
  }
});

commands.push({
  category: "Eğlence",
  data: new SlashCommandBuilder()
    .setName("zar")
    .setDescription("Zar atar.")
    .addIntegerOption(o => o.setName("yuz").setDescription("Zar yüzü").setMinValue(2).setMaxValue(1000)),
  async execute(interaction) {
    const sides = interaction.options.getInteger("yuz") || 6;
    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.main)
          .setTitle("🎲 Zar")
          .setDescription(`d${sides} sonucu: **${randomInt(1, sides)}**`)
      ]
    });
  }
});

commands.push({
  category: "Eğlence",
  data: new SlashCommandBuilder()
    .setName("8ball")
    .setDescription("Sihirli küreye soru sorar.")
    .addStringOption(o => o.setName("soru").setDescription("Sorun").setRequired(true)),
  async execute(interaction) {
    const answers = [
      "Kesinlikle evet.",
      "Bence hayır kral.",
      "Zaman gösterecek.",
      "Şansın yüksek.",
      "Buna evren bile şaşırdı.",
      "Olabilir ama dikkatli ol.",
      "Net değil, tekrar dene.",
      "Jarm buna evet diyor."
    ];

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.purple)
          .setTitle("🎱 8Ball")
          .setDescription(`**Soru:** ${cleanText(interaction.options.getString("soru"), 500)}\n**Cevap:** ${answers[Math.floor(Math.random() * answers.length)]}`)
      ]
    });
  }
});

commands.push({
  category: "Eğlence",
  data: new SlashCommandBuilder()
    .setName("ship")
    .setDescription("İki kullanıcıyı shipler.")
    .addUserOption(o => o.setName("kisi1").setDescription("1. kişi").setRequired(true))
    .addUserOption(o => o.setName("kisi2").setDescription("2. kişi").setRequired(true)),
  async execute(interaction) {
    const a = interaction.options.getUser("kisi1");
    const b = interaction.options.getUser("kisi2");
    const hash = crypto.createHash("md5").update(a.id + b.id).digest();
    const percent = hash.readUInt16BE(0) % 101;

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.pink)
          .setTitle("💘 Ship Metre")
          .setDescription(`${a} ❤️ ${b}\n${progressBar(percent, 100)} **%${percent}** uyum!`)
      ]
    });
  }
});

commands.push({
  category: "Araçlar",
  data: new SlashCommandBuilder()
    .setName("matematik")
    .setDescription("Güvenli matematik hesabı yapar.")
    .addStringOption(o => o.setName("islem").setDescription("Örn: (5+3)*2").setRequired(true)),
  async execute(interaction) {
    try {
      const expr = interaction.options.getString("islem");
      const result = calcExpression(expr);

      await interaction.reply({
        embeds: [
          jarmEmbed(CONFIG.colors.ai)
            .setTitle("🧮 Matematik")
            .setDescription(`\`${expr} = ${result}\``)
        ]
      });
    } catch {
      await interaction.reply({ embeds: [errEmbed("Geçersiz matematik ifadesi.")] });
    }
  }
});

commands.push({
  category: "Araçlar",
  data: new SlashCommandBuilder()
    .setName("sifre")
    .setDescription("Güçlü şifre üretir.")
    .addIntegerOption(o => o.setName("uzunluk").setDescription("8-64").setMinValue(8).setMaxValue(64)),
  async execute(interaction) {
    const length = interaction.options.getInteger("uzunluk") || 16;
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
    const bytes = crypto.randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];

    await interaction.reply({
      embeds: [jarmEmbed(CONFIG.colors.green).setTitle("🔐 Güçlü Şifre").setDescription(`\`${out}\``)],
      flags: MessageFlags.Ephemeral
    });
  }
});

commands.push({
  category: "Araçlar",
  data: new SlashCommandBuilder()
    .setName("renk")
    .setDescription("Rastgele renk üretir."),
  async execute(interaction) {
    const hex = crypto.randomBytes(3).toString("hex").toUpperCase();

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(parseInt(hex, 16))
          .setTitle("🎨 Rastgele Renk")
          .setDescription(`#${hex}`)
          .setThumbnail(`https://singlecolorimage.com/get/${hex}/256x256`)
      ]
    });
  }
});

commands.push({
  category: "Araçlar",
  data: new SlashCommandBuilder()
    .setName("hatirlat")
    .setDescription("Hatırlatıcı kurar.")
    .addIntegerOption(o => o.setName("dakika").setDescription("Dakika").setRequired(true).setMinValue(1).setMaxValue(10080))
    .addStringOption(o => o.setName("metin").setDescription("Hatırlatma metni").setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    const minutes = interaction.options.getInteger("dakika");
    const text = interaction.options.getString("metin");

    const list = db.get("reminders", []);
    list.push({
      userId: interaction.user.id,
      time: Date.now() + minutes * 60_000,
      text
    });
    db.set("reminders", list);

    await interaction.reply({
      embeds: [okEmbed(`${minutes} dakika sonra hatırlatacağım: \`${cleanText(text, 200)}\``)],
      flags: MessageFlags.Ephemeral
    });
  }
});

commands.push({
  category: "Araçlar",
  data: new SlashCommandBuilder()
    .setName("afk")
    .setDescription("AFK moduna geçersin.")
    .addStringOption(o => o.setName("sebep").setDescription("Sebep").setMaxLength(200)),
  async execute(interaction) {
    const reason = interaction.options.getString("sebep") || "Belirtilmedi";
    db.set(`afk_${interaction.guild.id}_${interaction.user.id}`, {
      reason,
      since: Date.now()
    });

    await interaction.reply({ embeds: [okEmbed(`AFK oldun: \`${cleanText(reason, 200)}\``)] });
  }
});

const snipes = new Map();

commands.push({
  category: "Araçlar",
  data: new SlashCommandBuilder()
    .setName("snipe")
    .setDescription("Kanalda silinen son mesajı gösterir."),
  async execute(interaction) {
    const data = snipes.get(interaction.channel.id);
    if (!data) return interaction.reply({ embeds: [infoEmbed("Bu kanalda silinen mesaj bulunamadı.")] });

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.purple)
          .setTitle("🕵️ Snipe")
          .setDescription(`**${data.author}:** ${cleanText(data.content || "İçerik yok", 1000)}`)
          .setFooter({ text: new Date(data.time).toLocaleString("tr-TR") })
      ]
    });
  }
});

commands.push({
  category: "Araçlar",
  data: new SlashCommandBuilder()
    .setName("profil")
    .setDescription("Detaylı profil kartı gösterir.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı")),
  async execute(interaction) {
    const member = interaction.options.getMember("kullanici") || interaction.member;
    const user = member.user;
    const xp = getXp(interaction.guild.id, user.id);
    const records = getRecords(interaction.guild.id, user.id);
    const warnings = records.filter(r => r.type === "WARN").length;

    const badges = [];
    if (user.bot) badges.push("🤖 Bot");
    if (CONFIG.owners.includes(user.id)) badges.push("👑 Developer");
    if (warnings === 0) badges.push("😇 Temiz Sicil");
    if (xp.level >= 10) badges.push("🏆 Level 10+");
    if (xp.level >= 25) badges.push("💎 Level 25+");

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.purple)
          .setAuthor({ name: `${user.username} Profil Kartı`, iconURL: user.displayAvatarURL() })
          .setThumbnail(user.displayAvatarURL({ size: 512 }))
          .addFields(
            { name: "ID", value: `\`${user.id}\``, inline: true },
            { name: "Level", value: String(xp.level), inline: true },
            { name: "XP", value: String(xp.xp), inline: true },
            { name: "Uyarı", value: String(warnings), inline: true },
            { name: "Hesap", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: "Katılım", value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "-", inline: true },
            { name: "Rozetler", value: badges.join(" • ") || "Yok", inline: false }
          )
      ]
    });
  }
});

/* ============================================================
   COMMAND REGISTER COLLECTION
============================================================ */

for (const cmd of commands) {
  client.commands.set(cmd.data.name, cmd);
}

/* ============================================================
   INTERACTION HANDLER
============================================================ */

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;
      await cmd.execute(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "ticket_select") {
        await showTicketModal(interaction, interaction.values[0]);
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("ticket_modal:")) {
        await createTicket(interaction);
        return;
      }

      if (interaction.customId === "register_modal") {
        const name = interaction.fields.getTextInputValue("name").trim();
        const ageRaw = interaction.fields.getTextInputValue("age").trim();
        const age = Number(ageRaw);

        if (!name || !Number.isInteger(age) || age < 8 || age > 99) {
          return interaction.reply({
            embeds: [errEmbed("İsim veya yaş geçersiz. Yaş 8-99 arasında olmalı.")],
            flags: MessageFlags.Ephemeral
          });
        }

        db.set(`register_pending_${interaction.guild.id}_${interaction.user.id}`, {
          name,
          age
        });

        await interaction.reply({
          embeds: [
            jarmEmbed(CONFIG.colors.success)
              .setTitle("📝 Kayıt Formu Alındı")
              .setDescription(`İsim: \`${name}\`\nYaş: \`${age}\`\n\nŞimdi cinsiyet seçimini yap.`)
          ],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId("register_male").setLabel("Erkek").setEmoji("♂").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId("register_female").setLabel("Kadın").setEmoji("♀").setStyle(ButtonStyle.Secondary)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (interaction.customId.startsWith("embed_modal:")) {
        const channelId = interaction.customId.split(":")[1];
        const channel = interaction.guild.channels.cache.get(channelId) || interaction.channel;

        const title = interaction.fields.getTextInputValue("title");
        const desc = interaction.fields.getTextInputValue("desc");
        const colorRaw = interaction.fields.getTextInputValue("color");
        const buttonRaw = interaction.fields.getTextInputValue("button");

        let color = CONFIG.colors.main;
        const match = String(colorRaw || "").match(/^#?([0-9a-f]{6})$/i);
        if (match) color = parseInt(match[1], 16);

        const emb = baseEmbed(color);
        if (title) emb.setTitle(cleanText(title, 256));
        if (desc) emb.setDescription(cleanText(desc, 4000));
        emb.setFooter({ text: `${interaction.user.username} tarafından gönderildi`, iconURL: interaction.user.displayAvatarURL() });

        const components = [];
        if (buttonRaw && buttonRaw.includes("|")) {
          const [label, url] = buttonRaw.split("|").map(x => x.trim());
          if (label && /^https?:\/\//i.test(url || "")) {
            components.push(
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel(label.slice(0, 80)).setURL(url).setStyle(ButtonStyle.Link)
              )
            );
          }
        }

        await channel.send({ embeds: [emb], components });
        await interaction.reply({
          embeds: [okEmbed(`Embed ${channel} kanalına gönderildi.`)],
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "ticket_close") return askCloseTicket(interaction);
      if (interaction.customId === "ticket_close_yes") return closeTicket(interaction, true);
      if (interaction.customId === "ticket_close_no") return closeTicket(interaction, false);
      if (interaction.customId === "ticket_lock") return lockTicket(interaction, true);
      if (interaction.customId === "ticket_unlock") return lockTicket(interaction, false);
      if (interaction.customId === "ticket_transcript") return sendTicketTranscript(interaction);

      if (interaction.customId === "register_start") {
        await interaction.showModal(registrationModal());
        return;
      }

      if (interaction.customId === "register_male" || interaction.customId === "register_female") {
        const data = db.get(`register_pending_${interaction.guild.id}_${interaction.user.id}`, null);
        if (!data) {
          return interaction.update({
            embeds: [errEmbed("Kayıt formu bulunamadı. Lütfen tekrar form doldur.")],
            components: []
          });
        }

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) return;

        try {
          const nick = await applyRegistration(
            interaction.guild,
            member,
            data,
            interaction.customId === "register_male" ? "male" : "female",
            null
          );

          await interaction.update({
            embeds: [
              jarmEmbed(CONFIG.colors.success)
                .setTitle("🎉 Kayıt Başarılı")
                .setDescription(`Hoş geldin **${nick}**! Rolün verildi.`)
            ],
            components: []
          });
        } catch (err) {
          await interaction.update({
            embeds: [errEmbed(err.message)],
            components: []
          });
        }
        return;
      }
    }
  } catch (err) {
    console.error("[INTERACTION ERROR]", err);

    const payload = {
      embeds: [errEmbed("Beklenmeyen bir hata oluştu. Hata loglandı.")],
      flags: MessageFlags.Ephemeral
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

/* ============================================================
   MESSAGE EVENTS
============================================================ */

client.on("messageCreate", async message => {
  try {
    if (!message.guild || message.author.bot) return;

    const afk = db.get(`afk_${message.guild.id}_${message.author.id}`, null);
    if (afk) {
      db.delete(`afk_${message.guild.id}_${message.author.id}`);
      await message.reply({
        embeds: [okEmbed(`AFK modundan çıktın. Sebep: \`${cleanText(afk.reason, 150)}\``)]
      }).catch(() => {});
    }

    for (const user of message.mentions.users.values()) {
      const userAfk = db.get(`afk_${message.guild.id}_${user.id}`, null);
      if (userAfk) {
        await message.reply({
          embeds: [infoEmbed(`🛌 ${user} şu an AFK: \`${cleanText(userAfk.reason, 150)}\` • <t:${Math.floor(userAfk.since / 1000)}:R>`)]
        }).catch(() => {});
      }
    }

    const automodBlocked = await runAutomod(message);
    if (automodBlocked) return;

    const aiChannels = db.get(`ai_channels_${message.guild.id}`, []);
    const mentionedBot = message.mentions.users.has(client.user.id);
    const inAiChannel = aiChannels.includes(message.channel.id);

    if (mentionedBot || inAiChannel) {
      const question = message.content
        .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
        .trim();

      if (question) {
        await answerAiMessage(message, question);
        return;
      }
    }

    await giveXp(message);
  } catch (err) {
    console.error("[MESSAGE ERROR]", err);
  }
});

client.on("messageDelete", message => {
  if (!message.guild || message.author?.bot) return;
  snipes.set(message.channel.id, {
    author: message.author.tag,
    content: message.content || "",
    time: Date.now()
  });
});

/* ============================================================
   MEMBER EVENTS
============================================================ */

client.on("guildMemberAdd", async member => {
  try {
    const guild = member.guild;

    const roleCfg = db.get(`otorole_${guild.id}`, null);
    if (roleCfg) {
      const roleId = member.user.bot ? roleCfg.bot : roleCfg.member;
      if (roleId && guild.roles.cache.has(roleId)) {
        await member.roles.add(roleId, "Jarm otorol").catch(() => {});
      }
    }

    const guard = getGuard(guild.id);
    if (guard.enabled && guard.antiRaid) {
      const joins = (joinTracker.get(guild.id) || []).filter(t => Date.now() - t < 10000);
      joins.push(Date.now());
      joinTracker.set(guild.id, joins);

      if (joins.length >= 8) {
        await guardLog(
          guild,
          jarmEmbed(CONFIG.colors.guard)
            .setTitle("🚨 Raid Şüphesi")
            .setDescription(`10 saniye içinde **${joins.length}** giriş algılandı. Yeni gelen üyeye timeout deneniyor.`)
        );
        await member.timeout(10 * 60_000, "Jarm anti-raid").catch(() => {});
      }
    }

    const counter = db.get(`counter_${guild.id}`, null);
    if (counter && guild.channels.cache.has(counter.channel)) {
      await guild.channels.cache.get(counter.channel).send({
        embeds: [
          baseEmbed(CONFIG.colors.success)
            .setDescription(`🎉 **${member.user.tag}** sunucuya katıldı. Üye: **${guild.memberCount}/${counter.target}**`)
        ]
      }).catch(() => {});
    }

    const welcomeId = db.get(`welcome_${guild.id}`, null);
    if (welcomeId && guild.channels.cache.has(welcomeId)) {
      await guild.channels.cache.get(welcomeId).send({
        embeds: [
          jarmEmbed(CONFIG.colors.success)
            .setTitle("👋 Hoş Geldin")
            .setDescription(`${member} sunucuya katıldı!\n\nHesap oluşturma: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\nÜye sayısı: **${guild.memberCount}**`)
            .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("register_start")
              .setLabel("Kayıt Ol")
              .setEmoji("📝")
              .setStyle(ButtonStyle.Success)
          )
        ]
      }).catch(() => {});
    }

    const logId = db.get(`welcomelog_${guild.id}`, null);
    if (logId && guild.channels.cache.has(logId)) {
      await guild.channels.cache.get(logId).send({
        embeds: [
          baseEmbed(CONFIG.colors.green)
            .setTitle("➡️ Üye Girişi")
            .setDescription(`${member} giriş yaptı.`)
            .addFields(
              { name: "ID", value: `\`${member.id}\``, inline: true },
              { name: "Hesap", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
              { name: "Üye Sayısı", value: String(guild.memberCount), inline: true }
            )
        ]
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[GUILD MEMBER ADD ERROR]", err);
  }
});

client.on("guildMemberRemove", async member => {
  try {
    const guild = member.guild;

    db.delete(`register_pending_${guild.id}_${member.id}`);
    db.delete(`open_ticket_${guild.id}_${member.id}`);

    const logId = db.get(`welcomelog_${guild.id}`, null);
    if (logId && guild.channels.cache.has(logId)) {
      await guild.channels.cache.get(logId).send({
        embeds: [
          baseEmbed(CONFIG.colors.error)
            .setTitle("⬅️ Üye Çıkışı")
            .setDescription(`**${member.user.tag}** sunucudan ayrıldı.`)
            .addFields(
              { name: "ID", value: `\`${member.id}\``, inline: true },
              { name: "Kalan Üye", value: String(guild.memberCount), inline: true }
            )
        ]
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[GUILD MEMBER REMOVE ERROR]", err);
  }
});

/* ============================================================
   GUARD EVENTS
============================================================ */

client.on("channelDelete", async channel => {
  try {
    if (!channel.guild) return;
    const cfg = getGuard(channel.guild.id);
    if (!cfg.enabled || !cfg.antiNuke) return;

    const logs = await channel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelDelete,
      limit: 1
    }).catch(() => null);

    const entry = logs?.entries?.first();
    if (!entry?.executor) return;

    await registerGuardAction(channel.guild, entry.executor.id, "channelDelete");
  } catch (err) {
    console.error("[GUARD channelDelete]", err);
  }
});

client.on("channelCreate", async channel => {
  try {
    if (!channel.guild) return;
    const cfg = getGuard(channel.guild.id);
    if (!cfg.enabled || !cfg.antiNuke) return;

    const logs = await channel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelCreate,
      limit: 1
    }).catch(() => null);

    const entry = logs?.entries?.first();
    if (!entry?.executor) return;

    await registerGuardAction(channel.guild, entry.executor.id, "channelCreate");
  } catch (err) {
    console.error("[GUARD channelCreate]", err);
  }
});

client.on("roleDelete", async role => {
  try {
    const cfg = getGuard(role.guild.id);
    if (!cfg.enabled || !cfg.antiNuke) return;

    const logs = await role.guild.fetchAuditLogs({
      type: AuditLogEvent.RoleDelete,
      limit: 1
    }).catch(() => null);

    const entry = logs?.entries?.first();
    if (!entry?.executor) return;

    await registerGuardAction(role.guild, entry.executor.id, "roleDelete");
  } catch (err) {
    console.error("[GUARD roleDelete]", err);
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const cfg = getGuard(newMember.guild.id);
    if (!cfg.enabled || !cfg.antiRole) return;

    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    if (!addedRoles.size) return;

    const logs = await newMember.guild.fetchAuditLogs({
      type: AuditLogEvent.MemberRoleUpdate,
      limit: 1
    }).catch(() => null);

    const entry = logs?.entries?.first();
    if (!entry?.executor) return;

    if (isGuardWhitelisted(newMember.guild, entry.executor.id)) return;

    await newMember.roles.remove(addedRoles.map(r => r.id), "Jarm Guard: yetkisiz rol ekleme").catch(() => {});
    await registerGuardAction(newMember.guild, entry.executor.id, "unauthorizedRoleAdd");
  } catch (err) {
    console.error("[GUARD memberUpdate]", err);
  }
});

/* ============================================================
   REMINDERS
============================================================ */

setInterval(async () => {
  try {
    const reminders = db.get("reminders", []);
    if (!Array.isArray(reminders) || !reminders.length) return;

    const due = reminders.filter(r => r.time <= Date.now());
    if (!due.length) return;

    db.set("reminders", reminders.filter(r => r.time > Date.now()));

    for (const item of due) {
      const user = await client.users.fetch(item.userId).catch(() => null);
      if (!user) continue;

      await user.send({
        embeds: [
          jarmEmbed(CONFIG.colors.warning)
            .setTitle("⏰ Hatırlatma")
            .setDescription(cleanText(item.text, 1000))
        ]
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[REMINDER ERROR]", err);
  }
}, 20_000);

/* ============================================================
   READY / DEPLOY COMMANDS
============================================================ */

client.once("ready", async () => {
  console.log(`[BOT] ${client.user.tag} aktif.`);

  client.user.setPresence({
    status: "online",
    activities: [
      {
        name: "Jarm • /yardim",
        type: ActivityType.Watching
      }
    ]
  });

  const body = client.commands.map(cmd => cmd.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(CONFIG.token);

  try {
    if (CONFIG.devGuildId) {
      await rest.put(
        Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.devGuildId),
        { body }
      );
      console.log(`[COMMANDS] ${body.length} komut test sunucusuna yüklendi.`);
    } else {
      await rest.put(
        Routes.applicationCommands(CONFIG.clientId),
        { body }
      );
      console.log(`[COMMANDS] ${body.length} komut globale yüklendi.`);
    }
  } catch (err) {
    console.error("[COMMAND DEPLOY ERROR]", err);
  }
});

/* ============================================================
   EXPRESS SERVER
============================================================ */

const app = express();

app.get("/", (req, res) => {
  res.json({
    status: "online",
    bot: client.user ? client.user.tag : "starting",
    uptime: process.uptime(),
    guilds: client.guilds.cache.size,
    ping: client.ws.ping
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(CONFIG.port, () => {
  console.log(`[WEB] Express server ${CONFIG.port} portunda çalışıyor.`);
});

/* ============================================================
   GLOBAL ERROR HANDLING
============================================================ */

process.on("unhandledRejection", err => {
  console.error("[UNHANDLED REJECTION]", err);
});

process.on("uncaughtException", err => {
  console.error("[UNCAUGHT EXCEPTION]", err);
});

process.on("warning", warning => {
  console.warn("[PROCESS WARNING]", warning.message);
});

/* ============================================================
   LOGIN
============================================================ */

client.login(CONFIG.token).catch(err => {
  console.error("[LOGIN ERROR]", err);
  process.exit(1);
});