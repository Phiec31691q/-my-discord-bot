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
   JARM v4 — CONFIG
============================================================ */

const CONFIG = {
  token: process.env.TOKEN || "",
  clientId: process.env.CLIENT_ID || "",
  devGuildId: process.env.DEV_GUILD_ID || "",
  port: Number(process.env.PORT || 8080),
  owners: (process.env.OWNER_IDS || "").split(",").map(x => x.trim()).filter(Boolean),
  colors: {
    main: 0xf5c542,
    success: 0x57f287,
    error: 0xed4245,
    warning: 0xfee75c,
    ai: 0x00e5ff,
    guard: 0xe74c3c,
    purple: 0x9d5cff,
    pink: 0xff7eb9,
    green: 0x2ecc71,
    gold: 0xffb830
  }
};

if (!CONFIG.token) console.error("[CONFIG] TOKEN eksik.");
if (!CONFIG.clientId) console.error("[CONFIG] CLIENT_ID eksik.");

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
  const payload = { embeds: [errEmbed(text)], flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => {});
  return interaction.reply(payload).catch(() => {});
}

function hierarchyOk(interaction, targetMember) {
  const guild = interaction.guild;
  if (!guild || !targetMember) return false;
  if (targetMember.id === guild.ownerId) return false;
  if (interaction.user.id === guild.ownerId) return true;
  if (!guild.members.me) return false;
  if (interaction.member.roles.highest.position <= targetMember.roles.highest.position) return false;
  if (guild.members.me.roles.highest.position <= targetMember.roles.highest.position) return false;
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

function fetchWithTimeout(url, options = {}, ms = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, Object.assign({}, options, { signal: controller.signal }))
    .finally(() => clearTimeout(timer));
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
      ? `<br><i>Ek: ${msg.attachments.map(a => htmlEscape(a.name || a.url)).join(", ")}</i>`
      : "";

    return `<div style="border-bottom:1px solid #374151;padding:8px 0"><b>${htmlEscape(msg.author.tag)}</b> <span style="color:#9ca3af;font-size:12px">${new Date(msg.createdTimestamp).toLocaleString("tr-TR")}</span><br>${content || "<i>İçerik yok</i>"}${attachments}</div>`;
  }).join("\n");

  const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>Jarm Transcript</title></head>
<body style="background:#111827;color:#e5e7eb;font-family:Arial,sans-serif;padding:24px">
<h1 style="color:#f5c542">🎫 Jarm Ticket Transkripti</h1>
<p>Kanal: #${htmlEscape(channel.name)} | Sahip: ${htmlEscape(meta.owner || "-")} | Kategori: ${htmlEscape(meta.category || "-")}</p>
<p>Konu: ${htmlEscape(meta.subject || "-")} | Tarih: ${new Date().toLocaleString("tr-TR")}</p>
<hr>
${rows || "<p>Mesaj yok.</p>"}
</body></html>`;

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
        { name: "Kayıt", value: `#${id}`, inline: true },
        { name: "Tür", value: `\`${type}\``, inline: true },
        { name: "Kullanıcı", value: `<@${userId}>`, inline: true },
        { name: "Yetkili", value: `${moderator}`, inline: true },
        { name: "Sebep", value: cleanText(reason || "Belirtilmedi", 1000), inline: false }
      )
  ).catch(() => {});

  return record;
}

/* ============================================================
   AI ENGINE — GROQ / OPENAI / FREE KEYLESS FALLBACK
============================================================ */

const aiMemory = new Map();

const AI_SYSTEM_PROMPT = `
Sen Jarm adlı gelişmiş bir Discord yapay zeka asistanısın.
Geliştiricin 217i, stüdyon JXRM Studio.
Türkçe konuş; kullanıcı başka dil kullanırsa o dilde cevap ver.
Samimi, akıllı, doğal, akıcı ve yardımcı ol. Kullanıcıya bazen "kral" diye hitap edebilirsin.
Yasadışı eylemler, +18/NSFW içerik, zararlı talimatlar, nefret söylemi ve öz zarar konularında yardımcı olma; kısa ve kibarca reddet.
Bunların dışında her konuda özgür, yaratıcı ve detaylı cevap ver.
Discord mesaj formatına uygun yaz.
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

async function callOpenAiCompatible(url, key, model, messages) {
  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, temperature: 0.85, max_tokens: 750, messages })
    });

    if (!res.ok) return null;

    const json = await res.json().catch(() => null);
    return json?.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

async function callFreeAi(messages) {
  try {
    const res = await fetchWithTimeout("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai", messages })
    }, 35000);

    if (res && res.ok) {
      const text = await res.text().catch(() => "");
      if (text) {
        try {
          const json = JSON.parse(text);
          const content = json?.choices?.[0]?.message?.content;
          if (content) return content;
        } catch {
          if (text.trim().length > 1) return text.trim();
        }
      }
    }
  } catch {
    /* fallback'e geç */
  }

  try {
    const system = messages.find(m => m.role === "system")?.content || "";
    const history = messages.filter(m => m.role !== "system").slice(-6);

    const prompt = [
      system,
      "",
      ...history.map(m => `${m.role === "user" ? "Kullanıcı" : "Jarm"}: ${m.content}`),
      "",
      "Jarm:"
    ].join("\n");

    const res = await fetchWithTimeout(
      `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=openai`,
      {},
      35000
    );

    if (!res || !res.ok) return null;

    const text = await res.text().catch(() => "");
    return text && text.trim().length > 1 ? text.trim() : null;
  } catch {
    return null;
  }
}

async function callAi(messages) {
  if (process.env.GROQ_API_KEY) {
    const out = await callOpenAiCompatible(
      "https://api.groq.com/openai/v1/chat/completions",
      process.env.GROQ_API_KEY,
      process.env.AI_MODEL || "llama-3.1-8b-instant",
      messages
    );
    if (out) return out;
  }

  if (process.env.OPENAI_API_KEY) {
    const out = await callOpenAiCompatible(
      "https://api.openai.com/v1/chat/completions",
      process.env.OPENAI_API_KEY,
      process.env.AI_MODEL || "gpt-3.5-turbo",
      messages
    );
    if (out) return out;
  }

  return callFreeAi(messages);
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
      embeds: [
        errEmbed(
          "Şu an ücretsiz AI motoruna ulaşılamadı (yoğun olabilir), 10-20 saniye sonra tekrar dene.\n\n" +
          "Kesintisiz AI için Render Environment'a ücretsiz `GROQ_API_KEY` ekleyebilirsin: console.groq.com → API Keys → Create."
        )
      ]
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
          .setAuthor({ name: `Jarm AI • ${message.author.username}`, iconURL: message.author.displayAvatarURL() })
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
  return db.get(`xp_${guildId}_${userId}`, { xp: 0, level: 0, messages: 0 });
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
   TICKET SYSTEM — DUPLICATE-PROOF
============================================================ */

const TICKET_CREATING = new Set();

const TICKET_CATEGORIES = [
  { label: "Destek", value: "destek", desc: "Genel destek ve yardım", color: CONFIG.colors.main },
  { label: "Şikayet", value: "sikayet", desc: "Üye / olay şikayetleri", color: CONFIG.colors.error },
  { label: "VIP / Satış", value: "vip", desc: "Satış, ödeme ve VIP", color: CONFIG.colors.gold },
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

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("subject")
        .setLabel("Konu")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(80)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("detail")
        .setLabel("Detay")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

function findOpenTicketChannel(guild, userId) {
  const storedId = db.get(`open_ticket_${guild.id}_${userId}`, null);
  if (storedId && storedId !== "pending") {
    const ch = guild.channels.cache.get(storedId);
    if (ch) return ch;
  }

  return guild.channels.cache.find(
    c => c.type === ChannelType.GuildText && (c.topic || "").includes(`Owner: ${userId}`)
  ) || null;
}

async function createTicket(interaction) {
  const guild = interaction.guild;
  const userId = interaction.user.id;

  if (TICKET_CREATING.has(userId)) {
    return interaction.reply({
      embeds: [infoEmbed("Ticket işlemin zaten devam ediyor, lütfen tekrar deneme.")],
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }

  const existing = findOpenTicketChannel(guild, userId);
  if (existing) {
    db.set(`open_ticket_${guild.id}_${userId}`, existing.id);
    return interaction.reply({
      embeds: [errEmbed(`Zaten açık bir ticketin var: ${existing}`)],
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }

  const categoryValue = interaction.customId.split(":")[1] || "destek";
  const cat = ticketCategory(categoryValue);
  const subject = interaction.fields.getTextInputValue("subject");
  const detail = interaction.fields.getTextInputValue("detail");

  TICKET_CREATING.add(userId);
  db.set(`open_ticket_${guild.id}_${userId}`, "pending");

  try {
    const staffRoleId = db.get(`ticket_staff_${guild.id}`, null);

    const safeName = interaction.user.username
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gi, "-")
      .slice(0, 20) || "user";

    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: userId,
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
      name: `ticket-${safeName}`,
      type: ChannelType.GuildText,
      topic: `Jarm Ticket | Owner: ${userId} | Category: ${cat.value}`,
      permissionOverwrites: overwrites,
      reason: "Jarm ticket"
    });

    const meta = {
      ownerId: userId,
      owner: interaction.user.tag,
      category: cat.label,
      subject,
      detail,
      openedAt: Date.now(),
      added: [],
      locked: false
    };

    db.set(`ticket_${channel.id}`, meta);
    db.set(`open_ticket_${guild.id}_${userId}`, channel.id);

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ticket_close").setLabel("Kapat").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("ticket_lock").setLabel("Kilitle").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ticket_transcript").setLabel("Transkript").setStyle(ButtonStyle.Primary)
    );

    await channel.send({
      content: `${interaction.user}${staffRoleId ? ` <@&${staffRoleId}>` : ""}`,
      embeds: [
        jarmEmbed(cat.color)
          .setTitle(`🎫 ${cat.label} Ticket`)
          .setDescription(`**Konu:** ${cleanText(subject, 200)}\n**Detay:** ${cleanText(detail, 1000)}`)
          .addFields(
            { name: "Açan", value: `${interaction.user}`, inline: true },
            { name: "Kategori", value: cat.label, inline: true },
            { name: "Tarih", value: `<t:${nowSec()}:F>`, inline: true }
          )
      ],
      components: [buttons]
    });

    await interaction.reply({
      embeds: [okEmbed(`Ticket oluşturuldu: ${channel}`)],
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  } catch (err) {
    console.error("[TICKET CREATE ERROR]", err);
    db.delete(`open_ticket_${guild.id}_${userId}`);
    await interaction.reply({
      embeds: [errEmbed(`Ticket oluşturulamadı: ${err.message}`)],
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  } finally {
    TICKET_CREATING.delete(userId);
  }
}

async function askCloseTicket(interaction) {
  await interaction.reply({
    embeds: [infoEmbed("Ticket kapatılsın mı? Transkript log kanalına gönderilir.")],
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
      embeds: [infoEmbed("Kapatma iptal edildi.")],
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
            { name: "Sahip", value: meta?.ownerId ? `<@${meta.ownerId}>` : "-", inline: true }
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

  setTimeout(() => channel.delete("Jarm ticket kapatıldı").catch(() => {}), 4000);
}

async function lockTicket(interaction, lock) {
  const channel = interaction.channel;
  const meta = db.get(`ticket_${channel.id}`, null);

  if (!meta) {
    return interaction.reply({
      embeds: [errEmbed("Bu kanal ticket kanalı değil.")],
      flags: MessageFlags.Ephemeral
    });
  }

  const targets = [meta.ownerId, ...(meta.added || [])].filter(Boolean);

  for (const id of targets) {
    await channel.permissionOverwrites.edit(id, { SendMessages: lock ? false : null }).catch(() => {});
  }

  meta.locked = lock;
  db.set(`ticket_${channel.id}`, meta);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_close").setLabel("Kapat").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(lock ? "ticket_unlock" : "ticket_lock").setLabel(lock ? "Kilidi Aç" : "Kilitle").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket_transcript").setLabel("Transkript").setStyle(ButtonStyle.Primary)
  );

  await interaction.update({ components: [buttons] });
  await interaction.followUp({
    embeds: [okEmbed(lock ? "Ticket kilitlendi." : "Kilit açıldı.")],
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
  await logChannel.send({ content: `📄 Transkript: ${channel.name} • İsteyen: ${interaction.user}`, files: [file] }).catch(() => {});

  await interaction.editReply({ embeds: [okEmbed("Transkript gönderildi.")] });
}

/* ============================================================
   REGISTRATION
============================================================ */

async function applyRegistration(guild, member, data, gender, staffUser = null) {
  const cfg = db.get(`register_${guild.id}`, null);
  if (!cfg) throw new Error("Kayıt sistemi ayarlı değil. /kayit-sistem veya /kurulum kullan.");

  const tag = cfg.tag || "";
  const nick = `${tag ? tag + " " : ""}${data.name} | ${data.age}`.slice(0, 32);

  await member.setNickname(nick, "Jarm kayıt").catch(() => {});

  if (cfg.unregisteredRole && guild.roles.cache.has(cfg.unregisteredRole)) {
    await member.roles.remove(cfg.unregisteredRole, "Jarm kayıt").catch(() => {});
  }

  const add = [];
  if (cfg.memberRole) add.push(cfg.memberRole);
  if (gender === "male" && cfg.maleRole) add.push(cfg.maleRole);
  if (gender === "female" && cfg.femaleRole) add.push(cfg.femaleRole);

  for (const roleId of add) {
    if (guild.roles.cache.has(roleId)) await member.roles.add(roleId, "Jarm kayıt").catch(() => {});
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
          .setDescription(`${member} kayıt oldu.`)
          .addFields(
            { name: "İsim", value: `\`${nick}\``, inline: true },
            { name: "Cinsiyet", value: gender === "male" ? "♂ Erkek" : "♀ Kadın", inline: true },
            { name: "Yetkili", value: staffUser ? `${staffUser}` : "Form", inline: true }
          )
      ]
    }).catch(() => {});
  }

  return nick;
}

function registrationModal() {
  const modal = new ModalBuilder().setCustomId("register_modal").setTitle("Jarm Kayıt Formu");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("name").setLabel("İsmin").setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("age").setLabel("Yaşın").setStyle(TextInputStyle.Short).setMaxLength(2).setRequired(true)
    )
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
      .setTitle("🚨 Guard Müdahalesi")
      .setDescription(`Yetkisiz işlem: \`${reason}\`\nKişi: <@${executorId}>\nRolleri temizlendi, ban denendi.`)
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
      .setDescription(`<@${executorId}> • \`${action}\` • 10sn içinde ${arr.length}/3`)
  );

  if (arr.length >= 3) {
    guardActions.set(key, []);
    await punishGuard(guild, executorId, action);
  }
}

/* ============================================================
   AUTOMOD
============================================================ */

const defaultBadWords = ["amk", "aq", "amq", "orospu", "piç", "pic", "sik", "yarrak", "kahpe", "pezevenk", "ibne", "gavat", "amcık", "yavşak", "oc"];
const spamMap = new Map();

async function runAutomod(message) {
  if (!message.guild || !message.member || message.author.bot) return false;

  const settings = db.get(`automod_${message.guild.id}`, { badword: false, invite: true, link: false, caps: false, spam: true });
  if (!Object.values(settings).some(Boolean)) return false;

  if (
    message.member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    message.member.permissions.has(PermissionFlagsBits.Administrator)
  ) return false;

  const content = message.content || "";
  let violation = null;

  if (settings.badword) {
    const words = db.get(`badwords_${message.guild.id}`, defaultBadWords);
    if (words.some(w => content.toLowerCase().includes(w))) violation = "Küfür filtresi";
  }

  if (!violation && settings.invite && /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)/i.test(content)) {
    violation = "Davet engeli";
  }

  if (!violation && settings.link && /(https?:\/\/|www\.)/i.test(content)) violation = "Link engeli";

  if (!violation && settings.caps) {
    const letters = content.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, "");
    const upper = content.replace(/[^A-ZÇĞİÖŞÜ]/g, "");
    if (content.length >= 10 && letters.length >= 8 && upper.length / letters.length > 0.7) violation = "Caps engeli";
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
    embeds: [errEmbed(`${message.author}, automod ihlali: \`${violation}\`. Mesaj silindi.`)]
  }).catch(() => null);

  if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 5000);

  addRecord(message.guild, message.author.id, "AUTOMOD", client.user, violation);

  if (violation === "Anti-spam") await message.member.timeout(60000, "Jarm anti-spam").catch(() => {});

  return true;
}

/* ============================================================
   SAFE MATH
============================================================ */

function calcExpression(expr) {
  const clean = String(expr).replace(/\s/g, "");
  if (!/^[0-9+\-*/().%^]+$/.test(clean)) throw new Error("Geçersiz");

  const tokens = clean.match(/\d+\.?\d*|[+\-*/%^()]/g);
  if (!tokens || tokens.join("") !== clean) throw new Error("Geçersiz");

  const prec = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };
  const out = [];
  const ops = [];
  let prev = null;

  for (const token of tokens) {
    if (/^\d/.test(token)) out.push(Number(token));
    else if (token === "(") ops.push(token);
    else if (token === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop());
      if (!ops.length) throw new Error("Parantez");
      ops.pop();
    } else {
      if (token === "-" && (prev === null || prev === "(" || Object.prototype.hasOwnProperty.call(prec, prev))) out.push(0);
      while (ops.length && ops[ops.length - 1] !== "(" && prec[ops[ops.length - 1]] >= prec[token] && token !== "^") out.push(ops.pop());
      ops.push(token);
    }
    prev = token;
  }

  while (ops.length) {
    const op = ops.pop();
    if (op === "(") throw new Error("Parantez");
    out.push(op);
  }

  const stack = [];
  for (const item of out) {
    if (typeof item === "number") stack.push(item);
    else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new Error("Hata");
      if (item === "+") stack.push(a + b);
      else if (item === "-") stack.push(a - b);
      else if (item === "*") stack.push(a * b);
      else if (item === "/") stack.push(a / b);
      else if (item === "%") stack.push(a % b);
      else stack.push(Math.pow(a, b));
    }
  }

  if (stack.length !== 1 || !Number.isFinite(stack[0])) throw new Error("Hata");
  return stack[0];
}

/* ============================================================
   SETUP HELPERS
============================================================ */

async function findOrCreateRole(guild, name, color, permissions = []) {
  let role = guild.roles.cache.find(r => r.name === name);
  if (role) return role;
  return guild.roles.create({ name, color, permissions, reason: "Jarm kurulum" });
}

async function findOrCreateCategory(guild, name, overwrites = []) {
  let cat = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
  if (cat) return cat;
  return guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites, reason: "Jarm kurulum" });
}

async function findOrCreateTextChannel(guild, parent, name, topic = null, overwrites = []) {
  let ch = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildText);
  if (ch) return ch;
  return guild.channels.create({ name, type: ChannelType.GuildText, parent: parent?.id || null, topic, permissionOverwrites: overwrites, reason: "Jarm kurulum" });
}

/* ============================================================
   COMMANDS
============================================================ */

const commands = [];

commands.push({
  category: "Kurulum",
  data: new SlashCommandBuilder()
    .setName("kurulum")
    .setDescription("Sunucuyu Jarm sistemiyle baştan kurar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.Administrator])) return deny(interaction, "Yönetici gerekli.");

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
        return interaction.editReply({ embeds: [errEmbed("Bana Rolleri Yönet + Kanalları Yönet yetkisi ver.")] });
      }
    }

    const roles = {};
    roles.admin = await findOrCreateRole(guild, "🛡️ Kurmay", 0xe74c3c, [PermissionFlagsBits.Administrator]);
    roles.mod = await findOrCreateRole(guild, "⚔️ Moderatör", 0x3498db, [PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageNicknames]);
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

    const readOnly = [{ id: everyone, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] }];
    const publicWrite = [{ id: everyone, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }];
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

    const chRules = await findOrCreateTextChannel(guild, catInfo, "📋・kurallar", "Kurallar");
    const chAnnounce = await findOrCreateTextChannel(guild, catInfo, "📢・duyurular", "Duyurular");
    const chCounter = await findOrCreateTextChannel(guild, catInfo, "📊・sayaç", "Sayaç");
    await findOrCreateTextChannel(guild, catCommunity, "💬・sohbet", "Genel sohbet");
    const chAi = await findOrCreateTextChannel(guild, catCommunity, "🤖・jarm-ai", "AI sohbet");
    await findOrCreateTextChannel(guild, catCommunity, "🖼️・medya", "Medya");
    await findOrCreateTextChannel(guild, catCommunity, "🎮・oyun", "Oyun sohbeti");
    const chWelcome = await findOrCreateTextChannel(guild, catRegister, "👋・hoşgeldin", "Giriş");
    const chRegLog = await findOrCreateTextChannel(guild, catRegister, "📝・kayıt-log", "Kayıt log", staffOnly);
    const chTicket = await findOrCreateTextChannel(guild, catSupport, "🎫・destek-talebi", "Ticket paneli");
    const chTicketLog = await findOrCreateTextChannel(guild, catSupport, "📄・ticket-log", "Ticket log", staffOnly);
    const chModLog = await findOrCreateTextChannel(guild, catStaff, "📚・mod-log", "Mod log", staffOnly);
    const chGuardLog = await findOrCreateTextChannel(guild, catStaff, "🚨・guard-log", "Guard log", staffOnly);
    await findOrCreateTextChannel(guild, catStaff, "🛡️・yetkili-sohbet", "Yetkili", staffOnly);

    db.set(`ticket_staff_${guild.id}`, roles.support.id);
    db.set(`ticket_log_${guild.id}`, chTicketLog.id);
    db.set(`modlog_${guild.id}`, chModLog.id);
    db.set(`welcome_${guild.id}`, chWelcome.id);
    db.set(`welcomelog_${guild.id}`, chRegLog.id);
    db.set(`ai_channels_${guild.id}`, [chAi.id]);
    db.set(`otorole_${guild.id}`, { member: roles.unregistered.id, bot: roles.vip.id });
    db.set(`register_${guild.id}`, {
      unregisteredRole: roles.unregistered.id,
      maleRole: roles.male.id,
      femaleRole: roles.female.id,
      memberRole: roles.member.id,
      tag: "✦",
      logChannel: chRegLog.id
    });
    db.set(`automod_${guild.id}`, { badword: true, invite: true, link: false, caps: false, spam: true });
    db.set(`guard_${guild.id}`, {
      enabled: true,
      antiNuke: true,
      antiRaid: true,
      antiRole: true,
      logChannel: chGuardLog.id,
      whitelistRoles: [roles.admin.id, roles.guard.id],
      whitelistUsers: []
    });
    db.set(`levelroles_${guild.id}`, { "5": roles.l5.id, "10": roles.l10.id, "25": roles.l25.id, "50": roles.l50.id });
    db.set(`counter_${guild.id}`, { channel: chCounter.id, target: 500 });

    await chRules.send({
      embeds: [
        jarmEmbed(CONFIG.colors.error)
          .setTitle("📋 Sunucu Kuralları")
          .setDescription("1. Saygı zorunlu.\n2. Reklam/davet yasak.\n3. Spam ve caps yasak.\n4. NSFW yasak.\n5. Yetkiliye saygı.\n6. Kanal amacına uygun kullanım.")
      ]
    }).catch(() => {});

    await chWelcome.send({
      embeds: [
        jarmEmbed(CONFIG.colors.success)
          .setTitle("👋 Jarm Kayıt Kapısı")
          .setDescription("Butona bas, formu doldur, cinsiyetini seç. Anında kayıt.")
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("register_start").setLabel("Kayıt Ol").setStyle(ButtonStyle.Success)
        )
      ]
    }).catch(() => {});

    await chTicket.send({
      embeds: [jarmEmbed(CONFIG.colors.main).setTitle("🎫 Jarm Destek Merkezi").setDescription("Kategori seçerek ticket aç.")],
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("ticket_select")
            .setPlaceholder("Kategori seç")
            .addOptions(TICKET_CATEGORIES.map(c => ({ label: c.label, value: c.value, description: c.desc })))
        )
      ]
    }).catch(() => {});

    await chAi.send({
      embeds: [jarmEmbed(CONFIG.colors.ai).setTitle("🤖 Jarm AI").setDescription("Bu kanalda yaz ya da herhangi yerde @Jarm et; AI cevap versin.")]
    }).catch(() => {});

    await chAnnounce.send({
      embeds: [jarmEmbed(CONFIG.colors.gold).setTitle("📢 Kurulum Tamam").setDescription("Tüm Jarm sistemleri aktif.")]
    }).catch(() => {});

    await interaction.editReply({
      embeds: [jarmEmbed(CONFIG.colors.success).setTitle("🏗️ Kurulum Tamamlandı").setDescription("Roller, kanallar, ticket, kayıt, AI, guard, automod ve level hazır.")]
    });
  }
});

commands.push({
  category: "Ticket",
  data: new SlashCommandBuilder()
    .setName("ticket-setup")
    .setDescription("Ticket paneli kurar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(o => o.setName("staff").setDescription("Yetkili rolü").setRequired(true))
    .addChannelOption(o => o.setName("log").setDescription("Log kanalı").setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption(o => o.setName("panel").setDescription("Panel kanalı").addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yönet gerekli.");

    const staff = interaction.options.getRole("staff");
    const log = interaction.options.getChannel("log");
    const panel = interaction.options.getChannel("panel") || interaction.channel;

    db.set(`ticket_staff_${interaction.guild.id}`, staff.id);
    db.set(`ticket_log_${interaction.guild.id}`, log.id);

    await panel.send({
      embeds: [jarmEmbed(CONFIG.colors.main).setTitle("🎫 Destek Merkezi").setDescription("Kategori seç.")],
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("ticket_select")
            .setPlaceholder("Kategori seç")
            .addOptions(TICKET_CATEGORIES.map(c => ({ label: c.label, value: c.value, description: c.desc })))
        )
      ]
    });

    await interaction.reply({ embeds: [okEmbed("Panel kuruldu.")], flags: MessageFlags.Ephemeral });
  }
});

commands.push({
  category: "Ticket",
  data: new SlashCommandBuilder()
    .setName("ticket-add")
    .setDescription("Ticket'a kullanıcı ekler.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true)),
  async execute(interaction) {
    const meta = db.get(`ticket_${interaction.channel.id}`, null);
    if (!meta) return deny(interaction, "Ticket kanalı değil.");

    const user = interaction.options.getUser("kullanici");

    await interaction.channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    });

    if (!meta.added.includes(user.id)) meta.added.push(user.id);
    db.set(`ticket_${interaction.channel.id}`, meta);

    await interaction.reply({ embeds: [okEmbed(`${user} eklendi.`)] });
  }
});

commands.push({
  category: "Ticket",
  data: new SlashCommandBuilder()
    .setName("ticket-remove")
    .setDescription("Ticket'tan kullanıcı çıkarır.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true)),
  async execute(interaction) {
    const meta = db.get(`ticket_${interaction.channel.id}`, null);
    if (!meta) return deny(interaction, "Ticket kanalı değil.");

    const user = interaction.options.getUser("kullanici");

    await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: false, SendMessages: false });

    meta.added = meta.added.filter(id => id !== user.id);
    db.set(`ticket_${interaction.channel.id}`, meta);

    await interaction.reply({ embeds: [okEmbed(`${user} çıkarıldı.`)] });
  }
});

commands.push({
  category: "Ticket",
  data: new SlashCommandBuilder().setName("ticket-close").setDescription("Ticket kapatır."),
  async execute(interaction) {
    const meta = db.get(`ticket_${interaction.channel.id}`, null);
    if (!meta) return deny(interaction, "Ticket kanalı değil.");
    await askCloseTicket(interaction);
  }
});

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
    .addChannelOption(o => o.setName("log").setDescription("Log kanalı").addChannelTypes(ChannelType.GuildText))
    .addStringOption(o => o.setName("tag").setDescription("Tag").setMaxLength(5)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yönet gerekli.");

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
    .setDescription("Kayıt paneli gönderir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yönet gerekli.");

    const channel = interaction.options.getChannel("kanal") || interaction.channel;

    await channel.send({
      embeds: [jarmEmbed(CONFIG.colors.success).setTitle("📝 Kayıt Sistemi").setDescription("Butona bas ve formu doldur.")],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("register_start").setLabel("Kayıt Ol").setStyle(ButtonStyle.Success)
        )
      ]
    });

    await interaction.reply({ embeds: [okEmbed(`Panel ${channel} kanalına gönderildi.`)], flags: MessageFlags.Ephemeral });
  }
});

commands.push({
  category: "Kayıt",
  data: new SlashCommandBuilder()
    .setName("kayit")
    .setDescription("Manuel kayıt.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption(o => o.setName("kullanici").setDescription("Üye").setRequired(true))
    .addStringOption(o => o.setName("isim").setDescription("İsim").setRequired(true).setMaxLength(20))
    .addIntegerOption(o => o.setName("yas").setDescription("Yaş").setRequired(true).setMinValue(8).setMaxValue(99))
    .addStringOption(o => o.setName("cinsiyet").setDescription("Cinsiyet").setRequired(true).addChoices({ name: "Erkek", value: "male" }, { name: "Kadın", value: "female" })),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageNicknames])) return deny(interaction, "Takma ad yönetimi gerekli.");

    const member = await interaction.guild.members.fetch(interaction.options.getUser("kullanici").id).catch(() => null);
    if (!member) return deny(interaction, "Üye yok.");

    try {
      const nick = await applyRegistration(
        interaction.guild,
        member,
        { name: interaction.options.getString("isim"), age: interaction.options.getInteger("yas") },
        interaction.options.getString("cinsiyet"),
        interaction.user
      );
      await interaction.reply({ embeds: [okEmbed(`${member} kayıt edildi: \`${nick}\``)] });
    } catch (err) {
      await interaction.reply({ embeds: [errEmbed(err.message)] });
    }
  }
});

commands.push({
  category: "Kayıt",
  data: new SlashCommandBuilder().setName("kayit-bilgi").setDescription("Kayıt istatistikleri."),
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

commands.push({
  category: "AI",
  data: new SlashCommandBuilder()
    .setName("ai-sor")
    .setDescription("Jarm AI'a soru sor.")
    .addStringOption(o => o.setName("soru").setDescription("Soru").setRequired(true).setMaxLength(1000)),
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
        embeds: [errEmbed("Ücretsiz AI motoru şu an yanıt vermedi. Biraz sonra tekrar dene veya GROQ_API_KEY ekle.")]
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
    .setDescription("AI kanallarını yönet.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName("islem").setDescription("İşlem").setRequired(true).addChoices({ name: "ekle", value: "add" }, { name: "sil", value: "remove" }, { name: "liste", value: "list" }))
    .addChannelOption(o => o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yönet gerekli.");

    const action = interaction.options.getString("islem");
    const channel = interaction.options.getChannel("kanal") || interaction.channel;
    let list = db.get(`ai_channels_${interaction.guild.id}`, []);

    if (action === "add") {
      if (!list.includes(channel.id)) list.push(channel.id);
      db.set(`ai_channels_${interaction.guild.id}`, list);
      return interaction.reply({ embeds: [okEmbed(`${channel} AI kanalı oldu.`)] });
    }

    if (action === "remove") {
      list = list.filter(id => id !== channel.id);
      db.set(`ai_channels_${interaction.guild.id}`, list);
      return interaction.reply({ embeds: [okEmbed("AI kanalı kaldırıldı.")] });
    }

    return interaction.reply({ embeds: [infoEmbed(list.length ? list.map(id => `<#${id}>`).join("\n") : "AI kanalı yok.")] });
  }
});

commands.push({
  category: "Guard",
  data: new SlashCommandBuilder()
    .setName("guard")
    .setDescription("Guard yönetimi.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("islem").setDescription("İşlem").setRequired(true).addChoices(
      { name: "durum", value: "status" },
      { name: "ac", value: "on" },
      { name: "kapat", value: "off" },
      { name: "log", value: "log" },
      { name: "whitelist-ekle", value: "roleadd" },
      { name: "whitelist-sil", value: "roleremove" }
    ))
    .addChannelOption(o => o.setName("kanal").setDescription("Log kanalı").addChannelTypes(ChannelType.GuildText))
    .addRoleOption(o => o.setName("rol").setDescription("Rol")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.Administrator])) return deny(interaction, "Yönetici gerekli.");

    const cfg = getGuard(interaction.guild.id);
    const action = interaction.options.getString("islem");

    if (action === "on") {
      cfg.enabled = true;
      db.set(`guard_${interaction.guild.id}`, cfg);
      return interaction.reply({ embeds: [okEmbed("Guard açıldı.")] });
    }

    if (action === "off") {
      cfg.enabled = false;
      db.set(`guard_${interaction.guild.id}`, cfg);
      return interaction.reply({ embeds: [okEmbed("Guard kapatıldı.")] });
    }

    if (action === "log") {
      const ch = interaction.options.getChannel("kanal");
      if (!ch) return deny(interaction, "Kanal belirt.");
      cfg.logChannel = ch.id;
      db.set(`guard_${interaction.guild.id}`, cfg);
      return interaction.reply({ embeds: [okEmbed(`Guard log: ${ch}`)] });
    }

    if (action === "roleadd") {
      const role = interaction.options.getRole("rol");
      if (!role) return deny(interaction, "Rol belirt.");
      if (!cfg.whitelistRoles.includes(role.id)) cfg.whitelistRoles.push(role.id);
      db.set(`guard_${interaction.guild.id}`, cfg);
      return interaction.reply({ embeds: [okEmbed(`${role} whitelist'e eklendi.`)] });
    }

    if (action === "roleremove") {
      const role = interaction.options.getRole("rol");
      if (!role) return deny(interaction, "Rol belirt.");
      cfg.whitelistRoles = cfg.whitelistRoles.filter(id => id !== role.id);
      db.set(`guard_${interaction.guild.id}`, cfg);
      return interaction.reply({ embeds: [okEmbed(`${role} çıkarıldı.`)] });
    }

    return interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.guard)
          .setTitle("🛡️ Guard Durumu")
          .addFields(
            { name: "Aktif", value: cfg.enabled ? "✅" : "❌", inline: true },
            { name: "Log", value: cfg.logChannel ? `<#${cfg.logChannel}>` : "Yok", inline: true },
            { name: "Whitelist", value: cfg.whitelistRoles.length ? cfg.whitelistRoles.map(id => `<@&${id}>`).join("\n") : "Yok", inline: false }
          )
      ]
    });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true))
    .addStringOption(o => o.setName("sebep").setDescription("Sebep"))
    .addIntegerOption(o => o.setName("gun").setDescription("Mesaj silme günü").setMinValue(0).setMaxValue(7)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.BanMembers])) return deny(interaction, "Ban yetkisi yok.");

    const user = interaction.options.getUser("kullanici");
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member && !hierarchyOk(interaction, member)) return deny(interaction, "Hiyerarşi engeli.");

    const reason = interaction.options.getString("sebep") || "Belirtilmedi";
    const days = interaction.options.getInteger("gun") || 0;

    await interaction.guild.members.ban(user.id, { deleteMessageSeconds: days * 86400, reason });
    addRecord(interaction.guild, user.id, "BAN", interaction.user, reason);

    await interaction.reply({ embeds: [okEmbed(`${user.tag} banlandı.`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Ban kaldır.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName("kullanici_id").setDescription("ID").setRequired(true)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.BanMembers])) return deny(interaction, "Ban yetkisi yok.");

    const id = interaction.options.getString("kullanici_id");
    await interaction.guild.members.unban(id, "Jarm unban").catch(() => null);
    addRecord(interaction.guild, id, "UNBAN", interaction.user, "Unban");

    await interaction.reply({ embeds: [okEmbed(`<@${id}> banı kaldırıldı.`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick.")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true))
    .addStringOption(o => o.setName("sebep").setDescription("Sebep")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.KickMembers])) return deny(interaction, "Kick yetkisi yok.");

    const member = await interaction.guild.members.fetch(interaction.options.getUser("kullanici").id).catch(() => null);
    if (!member) return deny(interaction, "Üye yok.");
    if (!hierarchyOk(interaction, member)) return deny(interaction, "Hiyerarşi engeli.");

    const reason = interaction.options.getString("sebep") || "Belirtilmedi";
    await member.kick(reason);
    addRecord(interaction.guild, member.id, "KICK", interaction.user, reason);

    await interaction.reply({ embeds: [okEmbed(`${member.user.tag} atıldı.`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true))
    .addIntegerOption(o => o.setName("dakika").setDescription("Dakika").setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName("sebep").setDescription("Sebep")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, "Timeout yetkisi yok.");

    const member = await interaction.guild.members.fetch(interaction.options.getUser("kullanici").id).catch(() => null);
    if (!member) return deny(interaction, "Üye yok.");
    if (!hierarchyOk(interaction, member)) return deny(interaction, "Hiyerarşi engeli.");
    if (!member.moderatable) return deny(interaction, "Uygulanamaz.");

    const minutes = interaction.options.getInteger("dakika");
    const reason = interaction.options.getString("sebep") || "Belirtilmedi";

    await member.timeout(minutes * 60000, reason);
    addRecord(interaction.guild, member.id, "TIMEOUT", interaction.user, `${minutes}dk ${reason}`);

    await interaction.reply({ embeds: [okEmbed(`${member} ${minutes}dk susturuldu.`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Timeout kaldır.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, "Yetki yok.");

    const member = await interaction.guild.members.fetch(interaction.options.getUser("kullanici").id).catch(() => null);
    if (!member) return deny(interaction, "Üye yok.");

    await member.timeout(null, "Jarm untimeout");
    addRecord(interaction.guild, member.id, "UNTIMEOUT", interaction.user, "Kaldırıldı");

    await interaction.reply({ embeds: [okEmbed("Timeout kaldırıldı.")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Uyarı ver.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true))
    .addStringOption(o => o.setName("sebep").setDescription("Sebep").setRequired(true)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, "Yetki yok.");

    const user = interaction.options.getUser("kullanici");
    const record = addRecord(interaction.guild, user.id, "WARN", interaction.user, interaction.options.getString("sebep"));

    await interaction.reply({ embeds: [okEmbed(`${user} uyarıldı. #${record.id}`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Uyarıları listele.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true)),
  async execute(interaction) {
    const user = interaction.options.getUser("kullanici");
    const records = getRecords(interaction.guild.id, user.id).filter(r => r.type === "WARN");

    if (!records.length) return interaction.reply({ embeds: [infoEmbed("Uyarı yok.")] });

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.warning)
          .setTitle(`⚠️ ${user.tag}`)
          .setDescription(records.slice(-15).map(r => `#${r.id} • ${cleanText(r.reason, 80)} • <t:${Math.floor(r.date / 1000)}:R>`).join("\n"))
      ]
    });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("clearwarn")
    .setDescription("Uyarıları temizle.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, "Yetki yok.");

    const user = interaction.options.getUser("kullanici");
    db.set(`records_${interaction.guild.id}_${user.id}`, getRecords(interaction.guild.id, user.id).filter(r => r.type !== "WARN"));
    addRecord(interaction.guild, user.id, "CLEARWARN", interaction.user, "Temizlendi");

    await interaction.reply({ embeds: [okEmbed("Uyarılar temizlendi.")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("sicil")
    .setDescription("Sicil göster.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true)),
  async execute(interaction) {
    const user = interaction.options.getUser("kullanici");
    const records = getRecords(interaction.guild.id, user.id);

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.purple)
          .setTitle(`📒 ${user.tag} Sicil`)
          .setDescription(records.length ? records.slice(-15).reverse().map(r => `#${r.id} • \`${r.type}\` • ${cleanText(r.reason, 80)}`).join("\n") : "Sicil temiz ✅")
      ]
    });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("sil")
    .setDescription("Mesaj sil.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName("miktar").setDescription("1-100").setRequired(true).setMinValue(1).setMaxValue(100))
    .addBooleanOption(o => o.setName("sadece_bot").setDescription("Sadece bot")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageMessages])) return deny(interaction, "Yetki yok.");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const amount = interaction.options.getInteger("miktar");
    const onlyBot = interaction.options.getBoolean("sadece_bot") || false;

    const fetched = await interaction.channel.messages.fetch({ limit: amount });
    let list = onlyBot ? fetched.filter(m => m.author.bot) : fetched;
    list = list.filter(m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);

    if (!list.size) return interaction.editReply({ embeds: [errEmbed("Silinecek mesaj yok.")] });

    await interaction.channel.bulkDelete(list, true).catch(async () => {
      for (const msg of list.values()) await msg.delete().catch(() => {});
    });

    await interaction.editReply({ embeds: [okEmbed(`${list.size} mesaj silindi.`)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder().setName("kilitle").setDescription("Kanalı kilitle.").setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageChannels])) return deny(interaction, "Yetki yok.");
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { SendMessages: false });
    await interaction.reply({ embeds: [okEmbed("Kanal kilitlendi 🔒")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder().setName("kilit-ac").setDescription("Kilit aç.").setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageChannels])) return deny(interaction, "Yetki yok.");
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { SendMessages: null });
    await interaction.reply({ embeds: [okEmbed("Kilit açıldı 🔓")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("modlog")
    .setDescription("Modlog kanalı ayarla.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName("kanal").setDescription("Kanal").setRequired(true).addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Yetki yok.");
    db.set(`modlog_${interaction.guild.id}`, interaction.options.getChannel("kanal").id);
    await interaction.reply({ embeds: [okEmbed("Modlog ayarlandı.")] });
  }
});

commands.push({
  category: "Sistem",
  data: new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Automod yönet.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName("sistem").setDescription("Sistem").setRequired(true).addChoices(
      { name: "küfür", value: "badword" },
      { name: "davet", value: "invite" },
      { name: "link", value: "link" },
      { name: "caps", value: "caps" },
      { name: "spam", value: "spam" }
    ))
    .addBooleanOption(o => o.setName("durum").setDescription("Durum").setRequired(true))
    .addStringOption(o => o.setName("kelime").setDescription("Özel kelime")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Yetki yok.");

    const system = interaction.options.getString("sistem");
    const status = interaction.options.getBoolean("durum");
    const word = interaction.options.getString("kelime");

    const settings = db.get(`automod_${interaction.guild.id}`, { badword: false, invite: true, link: false, caps: false, spam: true });
    settings[system] = status;
    db.set(`automod_${interaction.guild.id}`, settings);

    if (word) {
      const list = db.get(`badwords_${interaction.guild.id}`, defaultBadWords);
      if (!list.includes(word.toLowerCase())) list.push(word.toLowerCase());
      db.set(`badwords_${interaction.guild.id}`, list);
    }

    await interaction.reply({ embeds: [okEmbed(`\`${system}\` = ${status ? "Açık" : "Kapalı"}`)] });
  }
});

commands.push({
  category: "Sistem",
  data: new SlashCommandBuilder()
    .setName("otorol")
    .setDescription("Otorol ayarla.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(o => o.setName("uye_rol").setDescription("Üye rolü"))
    .addRoleOption(o => o.setName("bot_rol").setDescription("Bot rolü"))
    .addBooleanOption(o => o.setName("kapat").setDescription("Kapat")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Yetki yok.");

    if (interaction.options.getBoolean("kapat")) {
      db.delete(`otorole_${interaction.guild.id}`);
      return interaction.reply({ embeds: [okEmbed("Otorol kapandı.")] });
    }

    db.set(`otorole_${interaction.guild.id}`, {
      member: interaction.options.getRole("uye_rol")?.id || null,
      bot: interaction.options.getRole("bot_rol")?.id || null
    });

    await interaction.reply({ embeds: [okEmbed("Otorol ayarlandı.")] });
  }
});

commands.push({
  category: "Sistem",
  data: new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Welcome kanalları.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName("kanal").setDescription("Karşılama").addChannelTypes(ChannelType.GuildText))
    .addChannelOption(o => o.setName("log").setDescription("Log").addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Yetki yok.");

    const channel = interaction.options.getChannel("kanal");
    const log = interaction.options.getChannel("log");

    if (channel) db.set(`welcome_${interaction.guild.id}`, channel.id);
    if (log) db.set(`welcomelog_${interaction.guild.id}`, log.id);

    await interaction.reply({ embeds: [okEmbed("Welcome güncellendi.")] });
  }
});

commands.push({
  category: "Sistem",
  data: new SlashCommandBuilder()
    .setName("sayac")
    .setDescription("Sayaç ayarla.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText))
    .addIntegerOption(o => o.setName("hedef").setDescription("Hedef").setMinValue(1))
    .addBooleanOption(o => o.setName("kapat").setDescription("Kapat")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Yetki yok.");

    if (interaction.options.getBoolean("kapat")) {
      db.delete(`counter_${interaction.guild.id}`);
      return interaction.reply({ embeds: [okEmbed("Sayaç kapandı.")] });
    }

    const channel = interaction.options.getChannel("kanal");
    const target = interaction.options.getInteger("hedef");

    if (!channel || !target) {
      const cfg = db.get(`counter_${interaction.guild.id}`, null);
      if (!cfg) return interaction.reply({ embeds: [infoEmbed("Sayaç ayarlı değil.")] });
      return interaction.reply({ embeds: [infoEmbed(`Hedef ${cfg.target} • Kalan ${Math.max(0, cfg.target - interaction.guild.memberCount)}`)] });
    }

    db.set(`counter_${interaction.guild.id}`, { channel: channel.id, target });
    await interaction.reply({ embeds: [okEmbed(`Sayaç: ${channel} • ${target}`)] });
  }
});

commands.push({
  category: "Level",
  data: new SlashCommandBuilder()
    .setName("level")
    .setDescription("Seviye kartı.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı")),
  async execute(interaction) {
    const user = interaction.options.getUser("kullanici") || interaction.user;
    const data = getXp(interaction.guild.id, user.id);

    const cur = data.xp - xpForLevel(data.level);
    const need = xpForLevel(data.level + 1) - xpForLevel(data.level);

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setAuthor({ name: `${user.username} • Level`, iconURL: user.displayAvatarURL() })
          .setThumbnail(user.displayAvatarURL({ size: 512 }))
          .addFields(
            { name: "Seviye", value: String(data.level), inline: true },
            { name: "XP", value: String(data.xp), inline: true },
            { name: "Mesaj", value: String(data.messages), inline: true },
            { name: "İlerleme", value: `${progressBar(cur, need)} %${Math.round((cur / need) * 100)}`, inline: false }
          )
      ]
    });
  }
});

commands.push({
  category: "Level",
  data: new SlashCommandBuilder().setName("liderlik").setDescription("Level liderliği."),
  async execute(interaction) {
    const rows = db.startsWith(`xp_${interaction.guild.id}_`)
      .map(([key, value]) => Object.assign({ userId: key.split("_")[2] }, value))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 10);

    if (!rows.length) return interaction.reply({ embeds: [infoEmbed("Veri yok.")] });

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setTitle("🏆 Liderlik")
          .setDescription(rows.map((r, i) => `**${i + 1}.** <@${r.userId}> • Lv ${r.level} • ${r.xp} XP`).join("\n"))
      ]
    });
  }
});

commands.push({
  category: "Level",
  data: new SlashCommandBuilder()
    .setName("level-rol")
    .setDescription("Seviye rolü ayarla.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addIntegerOption(o => o.setName("seviye").setDescription("Seviye").setRequired(true).setMinValue(1))
    .addRoleOption(o => o.setName("rol").setDescription("Rol")),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageRoles])) return deny(interaction, "Yetki yok.");

    const level = interaction.options.getInteger("seviye");
    const role = interaction.options.getRole("rol");
    const roles = db.get(`levelroles_${interaction.guild.id}`, {});

    if (role) roles[String(level)] = role.id;
    else delete roles[String(level)];

    db.set(`levelroles_${interaction.guild.id}`, roles);

    await interaction.reply({ embeds: [okEmbed("Level rolü güncellendi.")] });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("yardim").setDescription("Yardım."),
  async execute(interaction) {
    const groups = {};
    for (const cmd of client.commands.values()) {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category].push(`\`/${cmd.data.name}\``);
    }

    const emb = jarmEmbed(CONFIG.colors.main).setTitle("📚 Jarm Yardım").setDescription(`Toplam ${client.commands.size} komut.`);
    for (const [cat, list] of Object.entries(groups)) emb.addFields({ name: `▸ ${cat}`, value: list.join(" "), inline: false });

    await interaction.reply({ embeds: [emb] });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("ping").setDescription("Ping."),
  async execute(interaction) {
    await interaction.reply({ embeds: [jarmEmbed(CONFIG.colors.ai).setTitle("🏓 Pong").setDescription(`WS: **${client.ws.ping}ms**`)] });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("hakkinda").setDescription("Jarm hakkında."),
  async execute(interaction) {
    const uptime = Math.floor(process.uptime());

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.main)
          .setTitle("🛡️ Jarm Hakkında")
          .setDescription("217i tarafından geliştirilen gelişmiş Discord botu.")
          .addFields(
            { name: "Developer", value: "217i", inline: true },
            { name: "Studio", value: "JXRM Studio", inline: true },
            { name: "Uptime", value: `${Math.floor(uptime / 3600)}s ${Math.floor((uptime % 3600) / 60)}d`, inline: true },
            { name: "Sunucu", value: String(client.guilds.cache.size), inline: true },
            { name: "Komut", value: String(client.commands.size), inline: true }
          )
      ]
    });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("sunucu-bilgi").setDescription("Sunucu bilgisi."),
  async execute(interaction) {
    const guild = interaction.guild;
    const owner = await guild.fetchOwner().catch(() => null);

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setTitle(`🏰 ${guild.name}`)
          .setThumbnail(guild.iconURL({ size: 512 }) || client.user.displayAvatarURL())
          .addFields(
            { name: "Sahip", value: owner ? `${owner}` : "-", inline: true },
            { name: "Üye", value: String(guild.memberCount), inline: true },
            { name: "Kanal", value: String(guild.channels.cache.size), inline: true },
            { name: "Rol", value: String(guild.roles.cache.size), inline: true },
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
    .setDescription("Kullanıcı bilgisi.")
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
            { name: "Hesap", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: "Katılım", value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "-", inline: true },
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
    .setDescription("Avatar.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı")),
  async execute(interaction) {
    const user = interaction.options.getUser("kullanici") || interaction.user;
    const url = user.displayAvatarURL({ size: 1024 });

    await interaction.reply({
      embeds: [baseEmbed(CONFIG.colors.main).setTitle(`🖼️ ${user.username}`).setImage(url)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Aç").setURL(url).setStyle(ButtonStyle.Link))]
    });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder()
    .setName("banner")
    .setDescription("Banner.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı")),
  async execute(interaction) {
    const user = await client.users.fetch(interaction.options.getUser("kullanici")?.id || interaction.user.id, { force: true });
    const url = user.bannerURL({ size: 1024 });

    if (!url) return interaction.reply({ embeds: [infoEmbed("Banner yok.")], flags: MessageFlags.Ephemeral });

    await interaction.reply({ embeds: [baseEmbed(CONFIG.colors.purple).setTitle(`🎇 ${user.username}`).setImage(url)] });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder()
    .setName("embed-yaz")
    .setDescription("Embed oluştur.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText)),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageMessages])) return deny(interaction, "Yetki yok.");

    const channel = interaction.options.getChannel("kanal") || interaction.channel;

    const modal = new ModalBuilder().setCustomId(`embed_modal:${channel.id}`).setTitle("Embed Oluşturucu");

    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("title").setLabel("Başlık").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("desc").setLabel("Açıklama").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("color").setLabel("Renk #hex").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("button").setLabel("Buton: Etiket | https://...").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300))
    );

    await interaction.showModal(modal);
  }
});

commands.push({
  category: "Eğlence",
  data: new SlashCommandBuilder().setName("yazitura").setDescription("Yazı tura."),
  async execute(interaction) {
    await interaction.reply({ embeds: [jarmEmbed(CONFIG.colors.gold).setTitle("🪙 Yazı Tura").setDescription(`Sonuç: **${Math.random() < 0.5 ? "YAZI" : "TURA"}**`)] });
  }
});

commands.push({
  category: "Eğlence",
  data: new SlashCommandBuilder()
    .setName("zar")
    .setDescription("Zar.")
    .addIntegerOption(o => o.setName("yuz").setDescription("Yüz").setMinValue(2).setMaxValue(1000)),
  async execute(interaction) {
    const sides = interaction.options.getInteger("yuz") || 6;
    await interaction.reply({ embeds: [jarmEmbed(CONFIG.colors.main).setTitle("🎲 Zar").setDescription(`d${sides}: **${randomInt(1, sides)}**`)] });
  }
});

commands.push({
  category: "Eğlence",
  data: new SlashCommandBuilder()
    .setName("8ball")
    .setDescription("8ball.")
    .addStringOption(o => o.setName("soru").setDescription("Soru").setRequired(true)),
  async execute(interaction) {
    const answers = ["Evet.", "Hayır.", "Belki.", "Kesinlikle evet.", "Bence hayır.", "Zaman gösterecek.", "Jarm evet diyor."];
    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.purple)
          .setTitle("🎱 8Ball")
          .setDescription(`S: ${cleanText(interaction.options.getString("soru"), 400)}\nC: ${answers[Math.floor(Math.random() * answers.length)]}`)
      ]
    });
  }
});

commands.push({
  category: "Eğlence",
  data: new SlashCommandBuilder()
    .setName("ship")
    .setDescription("Ship.")
    .addUserOption(o => o.setName("kisi1").setDescription("1").setRequired(true))
    .addUserOption(o => o.setName("kisi2").setDescription("2").setRequired(true)),
  async execute(interaction) {
    const a = interaction.options.getUser("kisi1");
    const b = interaction.options.getUser("kisi2");
    const hash = crypto.createHash("md5").update(a.id + b.id).digest();
    const percent = hash.readUInt16BE(0) % 101;

    await interaction.reply({
      embeds: [jarmEmbed(CONFIG.colors.pink).setTitle("💘 Ship").setDescription(`${a} ❤️ ${b}\n${progressBar(percent, 100)} %${percent}`)]
    });
  }
});

commands.push({
  category: "Araçlar",
  data: new SlashCommandBuilder()
    .setName("matematik")
    .setDescription("Hesap.")
    .addStringOption(o => o.setName("islem").setDescription("İşlem").setRequired(true)),
  async execute(interaction) {
    try {
      const expr = interaction.options.getString("islem");
      await interaction.reply({ embeds: [jarmEmbed(CONFIG.colors.ai).setTitle("🧮 Matematik").setDescription(`\`${expr} = ${calcExpression(expr)}\``)] });
    } catch {
      await interaction.reply({ embeds: [errEmbed("Geçersiz işlem.")] });
    }
  }
});

commands.push({
  category: "Araçlar",
  data: new SlashCommandBuilder()
    .setName("sifre")
    .setDescription("Şifre üret.")
    .addIntegerOption(o => o.setName("uzunluk").setDescription("8-64").setMinValue(8).setMaxValue(64)),
  async execute(interaction) {
    const length = interaction.options.getInteger("uzunluk") || 16;
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
    const bytes = crypto.randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];

    await interaction.reply({ embeds: [jarmEmbed(CONFIG.colors.green).setTitle("🔐 Şifre").setDescription(`\`${out}\``)], flags: MessageFlags.Ephemeral });
  }
});

commands.push({
  category: "Araçlar",
  data: new SlashCommandBuilder().setName("renk").setDescription("Rastgele renk."),
  async execute(interaction) {
    const hex = crypto.randomBytes(3).toString("hex").toUpperCase();

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(parseInt(hex, 16))
          .setTitle("🎨 Renk")
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
    .setDescription("Hatırlatıcı.")
    .addIntegerOption(o => o.setName("dakika").setDescription("Dakika").setRequired(true).setMinValue(1).setMaxValue(10080))
    .addStringOption(o => o.setName("metin").setDescription("Metin").setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    const minutes = interaction.options.getInteger("dakika");
    const text = interaction.options.getString("metin");

    db.push("reminders", { userId: interaction.user.id, time: Date.now() + minutes * 60000, text });

    await interaction.reply({ embeds: [okEmbed(`${minutes} dk sonra: ${cleanText(text, 200)}`)], flags: MessageFlags.Ephemeral });
  }
});

commands.push({
  category: "Araçlar",
  data: new SlashCommandBuilder()
    .setName("afk")
    .setDescription("AFK ol.")
    .addStringOption(o => o.setName("sebep").setDescription("Sebep").setMaxLength(200)),
  async execute(interaction) {
    const reason = interaction.options.getString("sebep") || "Belirtilmedi";
    db.set(`afk_${interaction.guild.id}_${interaction.user.id}`, { reason, since: Date.now() });
    await interaction.reply({ embeds: [okEmbed(`AFK: ${cleanText(reason, 150)}`)] });
  }
});

const snipes = new Map();

commands.push({
  category: "Araçlar",
  data: new SlashCommandBuilder().setName("snipe").setDescription("Silinen son mesaj."),
  async execute(interaction) {
    const data = snipes.get(interaction.channel.id);
    if (!data) return interaction.reply({ embeds: [infoEmbed("Silinen mesaj yok.")] });

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.purple)
          .setTitle("🕵️ Snipe")
          .setDescription(`**${data.author}:** ${cleanText(data.content || "İçerik yok", 1000)}`)
      ]
    });
  }
});

commands.push({
  category: "Araçlar",
  data: new SlashCommandBuilder()
    .setName("profil")
    .setDescription("Profil kartı.")
    .addUserOption(o => o.setName("kullanici").setDescription("Kullanıcı")),
  async execute(interaction) {
    const member = interaction.options.getMember("kullanici") || interaction.member;
    const user = member.user;
    const xp = getXp(interaction.guild.id, user.id);
    const warnings = getRecords(interaction.guild.id, user.id).filter(r => r.type === "WARN").length;

    const badges = [];
    if (user.bot) badges.push("🤖");
    if (CONFIG.owners.includes(user.id)) badges.push("👑");
    if (warnings === 0) badges.push("😇");
    if (xp.level >= 10) badges.push("🏆");

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.purple)
          .setAuthor({ name: `${user.username} Profil`, iconURL: user.displayAvatarURL() })
          .setThumbnail(user.displayAvatarURL({ size: 512 }))
          .addFields(
            { name: "Level", value: String(xp.level), inline: true },
            { name: "XP", value: String(xp.xp), inline: true },
            { name: "Uyarı", value: String(warnings), inline: true },
            { name: "Rozet", value: badges.join(" ") || "-", inline: false }
          )
      ]
    });
  }
});

for (const cmd of commands) {
  client.commands.set(cmd.data.name, cmd);
}

/* ============================================================
   INTERACTION HANDLER — DUPLICATE-PROOF
============================================================ */

const PROCESSED_INTERACTIONS = new Set();

setInterval(() => {
  if (PROCESSED_INTERACTIONS.size > 3000) PROCESSED_INTERACTIONS.clear();
}, 60000);

client.on("interactionCreate", async interaction => {
  if (PROCESSED_INTERACTIONS.has(interaction.id)) return;
  PROCESSED_INTERACTIONS.add(interaction.id);

  try {
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_select") {
      await showTicketModal(interaction, interaction.values[0]);
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("ticket_modal:")) {
        await createTicket(interaction);
        return;
      }

      if (interaction.customId === "register_modal") {
        const name = interaction.fields.getTextInputValue("name").trim();
        const age = Number(interaction.fields.getTextInputValue("age").trim());

        if (!name || !Number.isInteger(age) || age < 8 || age > 99) {
          return interaction.reply({ embeds: [errEmbed("İsim/yaş geçersiz.")], flags: MessageFlags.Ephemeral });
        }

        db.set(`register_pending_${interaction.guild.id}_${interaction.user.id}`, { name, age });

        return interaction.reply({
          embeds: [jarmEmbed(CONFIG.colors.success).setTitle("📝 Form Alındı").setDescription(`İsim: ${name}\nYaş: ${age}\nCinsiyet seç:`)],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId("register_male").setLabel("Erkek").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId("register_female").setLabel("Kadın").setStyle(ButtonStyle.Secondary)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
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
        emb.setFooter({ text: `${interaction.user.username} gönderdi`, iconURL: interaction.user.displayAvatarURL() });

        const components = [];
        if (buttonRaw && buttonRaw.includes("|")) {
          const parts = buttonRaw.split("|");
          const label = (parts[0] || "").trim();
          const url = (parts[1] || "").trim();
          if (label && /^https?:\/\//i.test(url)) {
            components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(label.slice(0, 80)).setURL(url).setStyle(ButtonStyle.Link)));
          }
        }

        await channel.send({ embeds: [emb], components });
        return interaction.reply({ embeds: [okEmbed("Embed gönderildi.")], flags: MessageFlags.Ephemeral });
      }
    }

    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === "ticket_close") return askCloseTicket(interaction);
      if (id === "ticket_close_yes") return closeTicket(interaction, true);
      if (id === "ticket_close_no") return closeTicket(interaction, false);
      if (id === "ticket_lock") return lockTicket(interaction, true);
      if (id === "ticket_unlock") return lockTicket(interaction, false);
      if (id === "ticket_transcript") return sendTicketTranscript(interaction);

      if (id === "register_start") {
        await interaction.showModal(registrationModal());
        return;
      }

      if (id === "register_male" || id === "register_female") {
        const data = db.get(`register_pending_${interaction.guild.id}_${interaction.user.id}`, null);
        if (!data) {
          return interaction.update({ embeds: [errEmbed("Form bulunamadı, tekrar doldur.")], components: [] });
        }

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) return;

        try {
          const nick = await applyRegistration(interaction.guild, member, data, id === "register_male" ? "male" : "female", null);
          await interaction.update({
            embeds: [jarmEmbed(CONFIG.colors.success).setTitle("🎉 Kayıt Başarılı").setDescription(`Hoş geldin **${nick}**`)],
            components: []
          });
        } catch (err) {
          await interaction.update({ embeds: [errEmbed(err.message)], components: [] });
        }
        return;
      }
    }
  } catch (err) {
    console.error("[INTERACTION ERROR]", err);

    const payload = { embeds: [errEmbed("Hata oluştu, loglandı.")], flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

/* ============================================================
   MESSAGE / MEMBER / GUARD EVENTS
============================================================ */

client.on("messageCreate", async message => {
  try {
    if (!message.guild || message.author.bot) return;

    const afk = db.get(`afk_${message.guild.id}_${message.author.id}`, null);
    if (afk) {
      db.delete(`afk_${message.guild.id}_${message.author.id}`);
      await message.reply({ embeds: [okEmbed(`AFK'dan çıktın: ${cleanText(afk.reason, 120)}`)] }).catch(() => {});
    }

    for (const user of message.mentions.users.values()) {
      const userAfk = db.get(`afk_${message.guild.id}_${user.id}`, null);
      if (userAfk) {
        await message.reply({ embeds: [infoEmbed(`🛌 ${user} AFK: ${cleanText(userAfk.reason, 120)}`)] }).catch(() => {});
      }
    }

    const blocked = await runAutomod(message);
    if (blocked) return;

    const aiChannels = db.get(`ai_channels_${message.guild.id}`, []);
    const mentioned = message.mentions.users.has(client.user.id);

    if (mentioned || aiChannels.includes(message.channel.id)) {
      const question = message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
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
  snipes.set(message.channel.id, { author: message.author.tag, content: message.content || "", time: Date.now() });
});

client.on("guildMemberAdd", async member => {
  try {
    const guild = member.guild;

    const roleCfg = db.get(`otorole_${guild.id}`, null);
    if (roleCfg) {
      const roleId = member.user.bot ? roleCfg.bot : roleCfg.member;
      if (roleId && guild.roles.cache.has(roleId)) await member.roles.add(roleId, "Jarm otorol").catch(() => {});
    }

    const guard = getGuard(guild.id);
    if (guard.enabled && guard.antiRaid) {
      const joins = (joinTracker.get(guild.id) || []).filter(t => Date.now() - t < 10000);
      joins.push(Date.now());
      joinTracker.set(guild.id, joins);

      if (joins.length >= 8) {
        await guardLog(guild, jarmEmbed(CONFIG.colors.guard).setTitle("🚨 Raid şüphesi").setDescription(`${joins.length} hızlı giriş.`));
        await member.timeout(10 * 60000, "Jarm anti-raid").catch(() => {});
      }
    }

    const counter = db.get(`counter_${guild.id}`, null);
    if (counter && guild.channels.cache.has(counter.channel)) {
      await guild.channels.cache.get(counter.channel).send({
        embeds: [baseEmbed(CONFIG.colors.success).setDescription(`🎉 ${member.user.tag} katıldı • **${guild.memberCount}/${counter.target}**`)]
      }).catch(() => {});
    }

    const welcomeId = db.get(`welcome_${guild.id}`, null);
    if (welcomeId && guild.channels.cache.has(welcomeId)) {
      await guild.channels.cache.get(welcomeId).send({
        embeds: [
          jarmEmbed(CONFIG.colors.success)
            .setTitle("👋 Hoş Geldin")
            .setDescription(`${member} katıldı • ${guild.memberCount} üye`)
            .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("register_start").setLabel("Kayıt Ol").setStyle(ButtonStyle.Success)
          )
        ]
      }).catch(() => {});
    }

    const logId = db.get(`welcomelog_${guild.id}`, null);
    if (logId && guild.channels.cache.has(logId)) {
      await guild.channels.cache.get(logId).send({
        embeds: [baseEmbed(CONFIG.colors.green).setTitle("➡️ Giriş").setDescription(`${member} • ${guild.memberCount} üye`)]
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[MEMBER ADD ERROR]", err);
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
        embeds: [baseEmbed(CONFIG.colors.error).setTitle("⬅️ Çıkış").setDescription(`${member.user.tag} ayrıldı • ${guild.memberCount} üye`)]
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[MEMBER REMOVE ERROR]", err);
  }
});

client.on("channelDelete", async channel => {
  try {
    if (!channel.guild) return;
    const cfg = getGuard(channel.guild.id);
    if (!cfg.enabled || !cfg.antiNuke) return;

    const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }).catch(() => null);
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

    const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 1 }).catch(() => null);
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

    const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 }).catch(() => null);
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

    const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    if (!added.size) return;

    const logs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 1 }).catch(() => null);
    const entry = logs?.entries?.first();
    if (!entry?.executor) return;
    if (isGuardWhitelisted(newMember.guild, entry.executor.id)) return;

    await newMember.roles.remove(added.map(r => r.id), "Jarm guard").catch(() => {});
    await registerGuardAction(newMember.guild, entry.executor.id, "yetkisizRol");
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
      await user.send({ embeds: [jarmEmbed(CONFIG.colors.warning).setTitle("⏰ Hatırlatma").setDescription(cleanText(item.text, 1000))] }).catch(() => {});
    }
  } catch (err) {
    console.error("[REMINDER ERROR]", err);
  }
}, 20000);

/* ============================================================
   READY + DEPLOY
============================================================ */

client.once("ready", async () => {
  console.log(`[BOT] ${client.user.tag} aktif.`);

  client.user.setPresence({
    status: "online",
    activities: [{ name: "Jarm • /yardim", type: ActivityType.Watching }]
  });

  const body = client.commands.map(cmd => cmd.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(CONFIG.token);

  try {
    if (CONFIG.devGuildId) {
      await rest.put(Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.devGuildId), { body });
      console.log(`[COMMANDS] ${body.length} komut test sunucusuna yüklendi.`);
    } else {
      await rest.put(Routes.applicationCommands(CONFIG.clientId), { body });
      console.log(`[COMMANDS] ${body.length} komut globale yüklendi.`);
    }
  } catch (err) {
    console.error("[DEPLOY ERROR]", err);
  }
});

/* ============================================================
   EXPRESS
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

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(CONFIG.port, () => console.log(`[WEB] Express ${CONFIG.port} portunda.`));

/* ============================================================
   GLOBAL ERRORS + LOGIN
============================================================ */

process.on("unhandledRejection", err => console.error("[UNHANDLED REJECTION]", err));
process.on("uncaughtException", err => console.error("[UNCAUGHT EXCEPTION]", err));
process.on("warning", w => console.warn("[WARNING]", w.message));

client.login(CONFIG.token).catch(err => {
  console.error("[LOGIN ERROR]", err);
  process.exit(1);
});