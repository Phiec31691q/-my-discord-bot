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

let voiceLib = null;
try {
  voiceLib = require("@discordjs/voice");
} catch (voiceErr) {
  voiceLib = null;
  console.warn("[VOICE] @discordjs/voice kurulu degil, ses ozelligi kapali.");
}
const joinVoiceChannel = voiceLib ? voiceLib.joinVoiceChannel : null;
const VoiceConnectionStatus = voiceLib ? voiceLib.VoiceConnectionStatus : null;
const entersState = voiceLib ? voiceLib.entersState : null;

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CONFIG = {
  token: process.env.TOKEN || "",
  clientId: process.env.CLIENT_ID || "",
  devGuildId: process.env.DEV_GUILD_ID || "",
  port: Number(process.env.PORT || 8080),
  owners: (process.env.OWNER_IDS || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean),
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

/* ================= DB ================= */

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let DB_CACHE = {};
try {
  DB_CACHE = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
} catch (dbErr) {
  DB_CACHE = {};
}

let dbWriteTimer = null;

function saveDbSoon() {
  if (dbWriteTimer) return;
  dbWriteTimer = setTimeout(function () {
    dbWriteTimer = null;
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(DB_CACHE, null, 2));
    } catch (e) {
      console.error("[DB WRITE ERROR]", e);
    }
  }, 300);
}

const db = {
  get: function (key, def) {
    if (def === undefined) def = null;
    if (Object.prototype.hasOwnProperty.call(DB_CACHE, key)) return DB_CACHE[key];
    return def;
  },
  set: function (key, value) {
    DB_CACHE[key] = value;
    saveDbSoon();
    return value;
  },
  delete: function (key) {
    delete DB_CACHE[key];
    saveDbSoon();
  },
  add: function (key, value) {
    const current = Number(this.get(key, 0)) || 0;
    return this.set(key, current + value);
  },
  push: function (key, value) {
    const arr = this.get(key, []);
    if (!Array.isArray(arr)) return this.set(key, [value]);
    arr.push(value);
    return this.set(key, arr);
  },
  startsWith: function (prefix) {
    return Object.entries(DB_CACHE).filter(function (item) { return item[0].indexOf(prefix) === 0; });
  }
};

/* ================= CLIENT ================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember]
});

client.commands = new Collection();

/* ================= HELPERS ================= */

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function cleanText(text, max) {
  if (max === undefined) max = 1900;
  return String(text || "")
    .replace(/@everyone/g, "@\u200beveryone")
    .replace(/@here/g, "@\u200bhere")
    .slice(0, max);
}

function baseEmbed(color) {
  return new EmbedBuilder().setColor(color || CONFIG.colors.main).setTimestamp();
}

function jarmEmbed(color) {
  const emb = baseEmbed(color);
  if (client.user) {
    emb.setFooter({ text: "Jarm • JXRM Studio • Developer: 217i", iconURL: client.user.displayAvatarURL() });
    emb.setThumbnail(client.user.displayAvatarURL({ size: 256 }));
  }
  return emb;
}

function okEmbed(text) { return baseEmbed(CONFIG.colors.success).setDescription("✅ " + text); }
function errEmbed(text) { return baseEmbed(CONFIG.colors.error).setDescription("❌ " + text); }
function infoEmbed(text) { return baseEmbed(CONFIG.colors.main).setDescription(text); }

function hasPerm(interaction, perms) {
  if (!interaction.member) return false;
  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return interaction.member.permissions.has(perms);
}

async function deny(interaction, text) {
  const payload = { embeds: [errEmbed(text)], flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(function () {});
  return interaction.reply(payload).catch(function () {});
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

function progressBar(current, max, size) {
  if (size === undefined) size = 12;
  const percent = max <= 0 ? 0 : Math.max(0, Math.min(1, current / max));
  const filled = Math.round(percent * size);
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fetchWithTimeout(url, options, ms) {
  if (typeof fetch !== "function") {
    console.warn("[NET] fetch yok, Node 18+ gerekli. NODE_VERSION=18 ayarla.");
    return Promise.resolve(null);
  }
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, ms || 30000);
  const opts = Object.assign({}, options || {}, { signal: controller.signal });
  return fetch(url, opts).finally(function () { clearTimeout(timer); });
}

function auditExecutor(logs) {
  if (!logs) return null;
  if (!logs.entries) return null;
  const entry = logs.entries.first();
  if (!entry) return null;
  return entry.executor || null;
}

/* ================= PRESENCE ================= */

function updatePresence() {
  if (!client.user) return;
  client.user.setPresence({
    status: "online",
    activities: [{ name: client.guilds.cache.size + " sunucuda 7/24 aktif", type: ActivityType.Playing }]
  });
}

/* ================= VOICE ================= */

const voice = { guildId: null, channelId: null, connection: null, retryTimer: null };

function scheduleVoiceRetry(ms) {
  if (voice.retryTimer) return;
  voice.retryTimer = setTimeout(function () {
    voice.retryTimer = null;
    connectVoice();
  }, ms || 5000);
}

function connectVoice() {
  if (!joinVoiceChannel) return;
  if (!voice.channelId) return;
  const guild = client.guilds.cache.get(voice.guildId);
  if (!guild) return;

  try {
    const connection = joinVoiceChannel({
      channelId: voice.channelId,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfMute: true,
      selfDeaf: false
    });

    voice.connection = connection;

    connection.on(VoiceConnectionStatus.Disconnected, async function () {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch (e) {
        connection.destroy();
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, function () {
      if (voice.connection === connection) voice.connection = null;
      scheduleVoiceRetry();
    });
  } catch (e) {
    console.error("[VOICE ERROR]", e);
    scheduleVoiceRetry(10000);
  }
}

async function setupVoice() {
  if (!joinVoiceChannel) {
    console.warn("[VOICE] Ses kutuphanesi yok, ses kanali atlaniyor.");
    return;
  }

  let guild = null;
  if (process.env.VOICE_GUILD_ID) guild = client.guilds.cache.get(process.env.VOICE_GUILD_ID);
  if (!guild) guild = client.guilds.cache.first();
  if (!guild) return;

  let channel = null;
  if (process.env.VOICE_CHANNEL_ID) channel = guild.channels.cache.get(process.env.VOICE_CHANNEL_ID);

  if (!channel) {
    channel = guild.channels.cache.find(function (c) {
      return c.type === ChannelType.GuildVoice && c.name.toLowerCase().indexOf("jarm") !== -1;
    });
  }

  if (!channel) {
    channel = await guild.channels.create({
      name: "🔊 Jarm • 7/24 Aktif",
      type: ChannelType.GuildVoice,
      reason: "Jarm 7/24 ses kanali",
      permissionOverwrites: [
        { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }
      ]
    }).catch(function () { return null; });

    if (channel) await channel.setPosition(0).catch(function () {});
  }

  if (!channel) return;

  voice.guildId = guild.id;
  voice.channelId = channel.id;
  connectVoice();
}

/* ================= TRANSCRIPT ================= */

function htmlEscape(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function createTranscript(channel, meta) {
  meta = meta || {};
  const messages = [];
  let before = undefined;

  for (let i = 0; i < 5; i++) {
    const options = { limit: 100 };
    if (before) options.before = before;
    const batch = await channel.messages.fetch(options).catch(function () { return null; });
    if (!batch || !batch.size) break;
    messages.push.apply(messages, Array.from(batch.values()));
    before = batch.lastKey();
    if (batch.size < 100) break;
  }

  messages.reverse();

  const rows = messages.map(function (msg) {
    const content = msg.content ? htmlEscape(msg.content) : "";
    return '<div style="border-bottom:1px solid #374151;padding:8px 0"><b>' + htmlEscape(msg.author.tag) + "</b> " + new Date(msg.createdTimestamp).toLocaleString("tr-TR") + "<br>" + (content || "<i>Icerik yok</i>") + "</div>";
  }).join("\n");

  const html = "<!doctype html>\n<html lang=\"tr\"><head><meta charset=\"utf-8\"><title>Jarm Transcript</title></head>\n<body style=\"background:#111827;color:#e5e7eb;font-family:Arial,sans-serif;padding:24px\">\n<h1 style=\"color:#f5c542\">Jarm Ticket Transkripti</h1>\n<p>Kanal: #" + htmlEscape(channel.name) + " | Sahip: " + htmlEscape(meta.owner || "-") + " | Kategori: " + htmlEscape(meta.category || "-") + "</p>\n<p>Konu: " + htmlEscape(meta.subject || "-") + " | Tarih: " + new Date().toLocaleString("tr-TR") + "</p>\n<hr>\n" + (rows || "<p>Mesaj yok.</p>") + "\n</body></html>";

  return new AttachmentBuilder(Buffer.from(html, "utf8"), { name: "transcript-" + channel.name + "-" + Date.now() + ".html" });
}

/* ================= RECORDS ================= */

function getRecords(guildId, userId) {
  return db.get("records_" + guildId + "_" + userId, []);
}

async function sendModLog(guild, embed) {
  const logId = db.get("modlog_" + guild.id, null);
  if (!logId) return;
  const ch = guild.channels.cache.get(logId);
  if (!ch) return;
  await ch.send({ embeds: [embed] }).catch(function () {});
}

function addRecord(guild, userId, type, moderator, reason) {
  const id = db.add("recordseq_" + guild.id, 1);
  const record = {
    id: id,
    type: type,
    reason: reason || "Belirtilmedi",
    moderatorId: moderator.id,
    moderatorTag: moderator.tag || moderator.username || "Jarm",
    date: Date.now()
  };

  db.push("records_" + guild.id + "_" + userId, record);

  sendModLog(
    guild,
    baseEmbed(CONFIG.colors.warning)
      .setTitle("📒 Ceza Kaydi")
      .addFields(
        { name: "Kayit", value: "#" + id, inline: true },
        { name: "Tur", value: "`" + type + "`", inline: true },
        { name: "Kullanici", value: "<@" + userId + ">", inline: true },
        { name: "Yetkili", value: "" + moderator, inline: true },
        { name: "Sebep", value: cleanText(reason || "Belirtilmedi", 1000), inline: false }
      )
  ).catch(function () {});

  return record;
}

/* ================= AI ================= */

const aiMemory = new Map();

const AI_SYSTEM_PROMPT = [
  "Sen Jarm adli gelismis bir Discord yapay zeka asistanisin.",
  "Gelistiricin 217i, studyon JXRM Studio.",
  "Turkce konus; kullanici baska dil kullanirsa o dilde cevap ver.",
  "Samimi, akilli, dogal, akici ve yardimci ol. Kullaniciya bazen 'kral' diye hitap edebilirsin.",
  "Yasadisi eylemler, +18/NSFW icerik, zararli talimatlar, nefret soylemi ve oz zarar konularinda yardimci olma; kisa ve kibarca reddet.",
  "Bunlarin disinda her konuda ozgur, yaratici ve detayli cevap ver.",
  "Discord mesaj formatina uygun yaz."
].join("\n");

const blockedAiPatterns = [
  /çocuk.*(seks|porno|porn|istismar)/i,
  /(bomba|patlayıcı|silah).*(yap|üret|tarif|nasıl)/i,
  /(uyuşturucu|metamfetamin|eroin).*(yap|üret|tarif|nasıl)/i,
  /(intihar|kendimi öldür|self.?harm)/i,
  /(porno|pornografi|erotik hikaye|seks hikayesi)/i
];

function addAiMemory(userId, role, content) {
  const arr = aiMemory.get(userId) || [];
  arr.push({ role: role, content: String(content).slice(0, 2500) });
  while (arr.length > 12) arr.shift();
  aiMemory.set(userId, arr);
}

async function callOpenAiCompatible(url, key, model, messages) {
  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model: model, temperature: 0.85, max_tokens: 750, messages: messages })
    });
    if (!res || !res.ok) return null;
    const json = await res.json().catch(function () { return null; });
    if (!json || !json.choices || !json.choices[0]) return null;
    if (!json.choices[0].message) return null;
    return json.choices[0].message.content || null;
  } catch (e) {
    return null;
  }
}

async function callFreeAi(messages) {
  try {
    const res = await fetchWithTimeout("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai", messages: messages })
    }, 35000);

    if (res && res.ok) {
      const text = await res.text().catch(function () { return ""; });
      if (text) {
        try {
          const json = JSON.parse(text);
          if (json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) {
            return json.choices[0].message.content;
          }
        } catch (e) {
          if (text.trim().length > 1) return text.trim();
        }
      }
    }
  } catch (e) {
    /* devam */
  }

  try {
    let system = "";
    for (const m of messages) { if (m.role === "system") { system = m.content; break; } }
    const history = messages.filter(function (m) { return m.role !== "system"; }).slice(-6);

    const lines = [system, ""];
    for (const m of history) lines.push((m.role === "user" ? "Kullanici" : "Jarm") + ": " + m.content);
    lines.push("");
    lines.push("Jarm:");
    const prompt = lines.join("\n");

    const res = await fetchWithTimeout("https://text.pollinations.ai/" + encodeURIComponent(prompt) + "?model=openai", {}, 35000);
    if (!res || !res.ok) return null;
    const text = await res.text().catch(function () { return ""; });
    return text && text.trim().length > 1 ? text.trim() : null;
  } catch (e) {
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

  let blocked = false;
  for (const r of blockedAiPatterns) { if (r.test(question)) { blocked = true; break; } }
  if (blocked) {
    return message.reply({ embeds: [errEmbed("Bu konuda yardimci olamam kral.")] }).catch(function () {});
  }

  await message.channel.sendTyping().catch(function () {});

  addAiMemory(message.author.id, "user", question);

  const messages = [{ role: "system", content: AI_SYSTEM_PROMPT }].concat(aiMemory.get(message.author.id) || []);

  const answer = await callAi(messages);

  if (!answer) {
    return message.reply({
      embeds: [errEmbed("AI motoruna ulasilamadi. Biraz sonra tekrar dene veya GROQ_API_KEY / NODE_VERSION ayarlarini kontrol et.")]
    }).catch(function () {});
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
          .setAuthor({ name: "Jarm AI • " + message.author.username, iconURL: message.author.displayAvatarURL() })
          .setDescription(cleanText(chunk, 4000))
      ]
    }).catch(function () {});
  }
}

/* ================= LEVEL ================= */

const xpCooldown = new Map();

function getXp(guildId, userId) {
  return db.get("xp_" + guildId + "_" + userId, { xp: 0, level: 0, messages: 0 });
}

function levelFromXp(xp) {
  return Math.floor(0.12 * Math.sqrt(xp));
}

function xpForLevel(level) {
  return Math.ceil(Math.pow(level / 0.12, 2));
}

async function giveXp(message) {
  const key = message.guild.id + "_" + message.author.id;
  const last = xpCooldown.get(key) || 0;
  if (Date.now() - last < 60000) return;
  xpCooldown.set(key, Date.now());

  const data = getXp(message.guild.id, message.author.id);
  const oldLevel = data.level;

  data.xp += randomInt(15, 25);
  data.messages += 1;
  data.level = levelFromXp(data.xp);

  db.set("xp_" + message.guild.id + "_" + message.author.id, data);

  if (data.level > oldLevel) {
    const levelRoles = db.get("levelroles_" + message.guild.id, {});
    const roleId = levelRoles[String(data.level)];
    if (roleId && message.guild.roles.cache.has(roleId)) {
      await message.member.roles.add(roleId, "Jarm seviye").catch(function () {});
    }
    await message.channel.send({
      embeds: [jarmEmbed(CONFIG.colors.gold).setTitle("🎉 Seviye Atladin!").setDescription(message.member + ", **" + data.level + ". seviye** oldun kral!")]
    }).catch(function () {});
  }
}

/* ================= BOM / OWO ================= */

function getBom(guildId, userId) {
  return db.get("bom_" + guildId + "_" + userId, { balance: 0, lastDaily: 0, gambles: 0, wins: 0 });
}

const OWO_PHRASES = {
  saril: [
    "{user}, {target} kocaman sarildi! 🤗 OwO",
    "{user} {target} kisisesine sikica sarildi, kalpler eridi 💞",
    "{user}, {target} kisisesini havaya kaldirdi ve sarildi! UwU"
  ],
  pat: [
    "{user}, {target} kafasini oksadi 😽 OwO",
    "{user} {target} sacini karistirdi, cok tatlisin dedi! UwU",
    "{user}, {target} kisisesine sefkatli bir pat atti! 🐾"
  ],
  slap: [
    "{user}, {target} kisisesine tavan atti! 💥 OwO",
    "{user} {target} kisisesini yastikla dovdü! 😾",
    "{user}, {target} kisisesine dramatik bir slap atti! 👋"
  ],
  kiss: [
    "{user}, {target} kisisesini yanaktan optu! 😽💕 OwO",
    "{user} {target} kisisesine minik bir busu kondurdu! 💋 UwU",
    "{user}, {target} kisisesini alnindan optu, cok saf! 💞"
  ],
  face: ["OwO", "UwU", ">w<", "O.O", "-w-", "ÒwÓ", "◕w◕"]
};

/* ================= TICKET ================= */

const TICKET_CREATING = new Set();

const TICKET_CATEGORIES = [
  { label: "Destek", value: "destek", desc: "Genel destek ve yardim", color: CONFIG.colors.main },
  { label: "Şikayet", value: "sikayet", desc: "Uye / olay sikayetleri", color: CONFIG.colors.error },
  { label: "VIP / Satis", value: "vip", desc: "Satis, odeme ve VIP", color: CONFIG.colors.gold },
  { label: "Yetkili Basvurusu", value: "basvuru", desc: "Ekip basvurusu", color: CONFIG.colors.green }
];

function ticketCategory(value) {
  for (const c of TICKET_CATEGORIES) { if (c.value === value) return c; }
  return TICKET_CATEGORIES[0];
}

function ticketPanelEmbed() {
  return jarmEmbed(CONFIG.colors.main)
    .setTitle("🎫 Jarm Destek Merkezi")
    .setDescription("Asagidaki menuden veya butonlardan kategorini sec.\nTicket actiginda kanal sadece sana ve yetkililere gorunur.")
    .addFields(TICKET_CATEGORIES.map(function (c) { return { name: c.label, value: c.desc, inline: true }; }))
    .setFooter({ text: "Jarm Ticket System • 7/24 Aktif" });
}

function ticketPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("ticket_select")
        .setPlaceholder("🎫 Kategori sec...")
        .addOptions(TICKET_CATEGORIES.map(function (c) { return { label: c.label, value: c.value, description: c.desc }; }))
    ),
    new ActionRowBuilder().addComponents(
      TICKET_CATEGORIES.map(function (c) {
        return new ButtonBuilder().setCustomId("ticket_cat:" + c.value).setLabel(c.label).setStyle(ButtonStyle.Primary);
      })
    )
  ];
}

function ticketEmbed(meta) {
  const cat = ticketCategory(meta.categoryValue || "destek");
  return jarmEmbed(cat.color)
    .setTitle("🎫 Jarm Destek Ticket")
    .setDescription("**Konu:** " + cleanText(meta.subject, 200) + "\n**Detay:** " + cleanText(meta.detail, 900))
    .addFields(
      { name: "Sahip", value: "<@" + meta.ownerId + ">", inline: true },
      { name: "Kategori", value: cat.label, inline: true },
      { name: "Durum", value: meta.locked ? "🔒 Kilitli" : "🟢 Acik", inline: true },
      { name: "Ustlenen", value: meta.claimed ? "<@" + meta.claimed + ">" : "—", inline: true },
      { name: "Acilis", value: "<t:" + Math.floor(meta.openedAt / 1000) + ":F>", inline: true }
    );
}

function ticketComponents(meta) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ticket_claim").setLabel("Ustlen").setStyle(ButtonStyle.Success).setDisabled(Boolean(meta.claimed)),
      new ButtonBuilder().setCustomId(meta.locked ? "ticket_unlock" : "ticket_lock").setLabel(meta.locked ? "Kilidi Ac" : "Kilitle").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ticket_transcript").setLabel("Transkript").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("ticket_close").setLabel("Kapat").setStyle(ButtonStyle.Danger)
    )
  ];
}

async function showTicketModal(interaction, categoryValue) {
  const cat = ticketCategory(categoryValue);
  const modal = new ModalBuilder().setCustomId("ticket_modal:" + cat.value).setTitle("Jarm Ticket • " + cat.label);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("subject").setLabel("Konu").setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("detail").setLabel("Detay").setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)
    )
  );
  await interaction.showModal(modal);
}

function findOpenTicketChannel(guild, userId) {
  const storedId = db.get("open_ticket_" + guild.id + "_" + userId, null);
  if (storedId && storedId !== "pending") {
    const ch = guild.channels.cache.get(storedId);
    if (ch) return ch;
  }
  return guild.channels.cache.find(function (c) {
    return c.type === ChannelType.GuildText && (c.topic || "").indexOf("Owner: " + userId) !== -1;
  }) || null;
}

async function createTicket(interaction) {
  const guild = interaction.guild;
  const userId = interaction.user.id;

  if (TICKET_CREATING.has(userId)) {
    return interaction.reply({ embeds: [infoEmbed("Ticket islemin zaten devam ediyor.")], flags: MessageFlags.Ephemeral }).catch(function () {});
  }

  const existing = findOpenTicketChannel(guild, userId);
  if (existing) {
    db.set("open_ticket_" + guild.id + "_" + userId, existing.id);
    return interaction.reply({ embeds: [errEmbed("Zaten acik ticketin var: " + existing)], flags: MessageFlags.Ephemeral }).catch(function () {});
  }

  const categoryValue = interaction.customId.split(":")[1] || "destek";
  const cat = ticketCategory(categoryValue);
  const subject = interaction.fields.getTextInputValue("subject");
  const detail = interaction.fields.getTextInputValue("detail");

  TICKET_CREATING.add(userId);
  db.set("open_ticket_" + guild.id + "_" + userId, "pending");

  try {
    const staffRoleId = db.get("ticket_staff_" + guild.id, null);
    const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]+/gi, "-").slice(0, 20) || "user";

    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
    ];

    if (staffRoleId && guild.roles.cache.has(staffRoleId)) {
      overwrites.push({ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }

    const channel = await guild.channels.create({
      name: "ticket-" + safeName,
      type: ChannelType.GuildText,
      topic: "Jarm Ticket | Owner: " + userId + " | Category: " + cat.value,
      permissionOverwrites: overwrites,
      reason: "Jarm ticket"
    });

    const meta = {
      ownerId: userId,
      owner: interaction.user.tag,
      category: cat.label,
      categoryValue: cat.value,
      subject: subject,
      detail: detail,
      openedAt: Date.now(),
      added: [],
      locked: false,
      claimed: null,
      messageId: null
    };

    const msg = await channel.send({
      content: interaction.user + (staffRoleId ? " <@&" + staffRoleId + ">" : ""),
      embeds: [ticketEmbed(meta)],
      components: ticketComponents(meta)
    });

    meta.messageId = msg.id;

    db.set("ticket_" + channel.id, meta);
    db.set("open_ticket_" + guild.id + "_" + userId, channel.id);

    const sameOwner = guild.channels.cache.filter(function (c) {
      return c.type === ChannelType.GuildText && (c.topic || "").indexOf("Owner: " + userId) !== -1;
    });

    if (sameOwner.size > 1) {
      const sorted = Array.from(sameOwner.values()).sort(function (a, b) { return a.createdTimestamp - b.createdTimestamp; });
      for (const dup of sorted.slice(1)) {
        if (dup.id !== sorted[0].id) {
          db.delete("ticket_" + dup.id);
          await dup.delete("Cift ticket temizligi").catch(function () {});
        }
      }
      db.set("open_ticket_" + guild.id + "_" + userId, sorted[0].id);
    }

    await interaction.reply({ embeds: [okEmbed("Ticket olusturuldu: " + channel)], flags: MessageFlags.Ephemeral }).catch(function () {});
  } catch (e) {
    console.error("[TICKET CREATE ERROR]", e);
    db.delete("open_ticket_" + guild.id + "_" + userId);
    await interaction.reply({ embeds: [errEmbed("Ticket acilamadi: " + e.message)], flags: MessageFlags.Ephemeral }).catch(function () {});
  } finally {
    TICKET_CREATING.delete(userId);
  }
}

async function askCloseTicket(interaction) {
  await interaction.reply({
    embeds: [infoEmbed("Ticket kapatilsin mi? Transkript log kanalina gonderilir.")],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_close_yes").setLabel("Evet, Kapat").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("ticket_close_no").setLabel("Vazgec").setStyle(ButtonStyle.Secondary)
      )
    ],
    flags: MessageFlags.Ephemeral
  });
}

async function closeTicket(interaction, yes) {
  if (!yes) {
    return interaction.update({ embeds: [infoEmbed("Kapatma iptal.")], components: [] });
  }

  const channel = interaction.channel;
  const meta = db.get("ticket_" + channel.id, null);
  const logId = db.get("ticket_log_" + channel.guild.id, null);
  const logChannel = logId ? channel.guild.channels.cache.get(logId) : null;

  if (logChannel) {
    const file = await createTranscript(channel, meta || {});
    await logChannel.send({
      embeds: [
        jarmEmbed(CONFIG.colors.error)
          .setTitle("🔒 Ticket Kapatildi")
          .addFields(
            { name: "Kanal", value: "#" + channel.name, inline: true },
            { name: "Kapatan", value: "" + interaction.user, inline: true },
            { name: "Sahip", value: meta && meta.ownerId ? "<@" + meta.ownerId + ">" : "-", inline: true }
          )
      ],
      files: [file]
    }).catch(function () {});
  }

  if (meta && meta.ownerId) db.delete("open_ticket_" + channel.guild.id + "_" + meta.ownerId);
  db.delete("ticket_" + channel.id);

  await interaction.update({ embeds: [okEmbed("Ticket kapatiliyor...")], components: [] });

  setTimeout(function () { channel.delete("Jarm ticket kapatildi").catch(function () {}); }, 4000);
}

async function lockTicket(interaction, lock) {
  const channel = interaction.channel;
  const meta = db.get("ticket_" + channel.id, null);

  if (!meta) {
    return interaction.reply({ embeds: [errEmbed("Ticket kanali degil.")], flags: MessageFlags.Ephemeral });
  }

  const targets = [meta.ownerId].concat(meta.added || []).filter(Boolean);

  for (const uid of targets) {
    await channel.permissionOverwrites.edit(uid, { SendMessages: lock ? false : null }).catch(function () {});
  }

  meta.locked = lock;
  db.set("ticket_" + channel.id, meta);

  await interaction.update({ embeds: [ticketEmbed(meta)], components: ticketComponents(meta) });
  await interaction.followUp({ embeds: [okEmbed(lock ? "Ticket kilitlendi 🔒" : "Kilit acildi 🔓")], flags: MessageFlags.Ephemeral });
}

async function sendTicketTranscript(interaction) {
  const channel = interaction.channel;
  const meta = db.get("ticket_" + channel.id, null);
  const logId = db.get("ticket_log_" + channel.guild.id, null);
  const logChannel = logId ? channel.guild.channels.cache.get(logId) : null;

  if (!logChannel) {
    return interaction.reply({ embeds: [errEmbed("Ticket log kanali yok.")], flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const file = await createTranscript(channel, meta || {});
  await logChannel.send({ content: "📄 Transkript: " + channel.name + " • Isteyen: " + interaction.user, files: [file] }).catch(function () {});

  await interaction.editReply({ embeds: [okEmbed("Transkript gonderildi.")] });
}

setInterval(async function () {
  try {
    for (const guild of client.guilds.cache.values()) {
      const byOwner = new Map();

      for (const ch of guild.channels.cache.values()) {
        if (ch.type !== ChannelType.GuildText) continue;
        const topic = ch.topic || "";
        if (topic.indexOf("Jarm Ticket |") !== 0) continue;
        const match = topic.match(/Owner: (\d+)/);
        if (!match) continue;
        const arr = byOwner.get(match[1]) || [];
        arr.push(ch);
        byOwner.set(match[1], arr);
      }

      for (const pair of byOwner) {
        const ownerId = pair[0];
        const list = pair[1];
        if (list.length <= 1) continue;
        list.sort(function (a, b) { return a.createdTimestamp - b.createdTimestamp; });
        for (const dup of list.slice(1)) {
          db.delete("ticket_" + dup.id);
          await dup.delete("Cift ticket supurgesi").catch(function () {});
        }
        db.set("open_ticket_" + guild.id + "_" + ownerId, list[0].id);
      }
    }
  } catch (e) {
    console.error("[TICKET SWEEPER]", e);
  }
}, 30000);

/* ================= REGISTRATION ================= */

async function applyRegistration(guild, member, data, gender, staffUser) {
  const cfg = db.get("register_" + guild.id, null);
  if (!cfg) throw new Error("Kayit sistemi ayarli degil. /kurulum veya /kayit-sistem kullan.");

  const tag = cfg.tag || "";
  const nick = (tag ? tag + " " : "") + data.name + " | " + data.age;

  await member.setNickname(nick.slice(0, 32), "Jarm kayit").catch(function () {});

  if (cfg.unregisteredRole && guild.roles.cache.has(cfg.unregisteredRole)) {
    await member.roles.remove(cfg.unregisteredRole, "Jarm kayit").catch(function () {});
  }

  const add = [];
  if (cfg.memberRole) add.push(cfg.memberRole);
  if (gender === "male" && cfg.maleRole) add.push(cfg.maleRole);
  if (gender === "female" && cfg.femaleRole) add.push(cfg.femaleRole);

  for (const roleId of add) {
    if (guild.roles.cache.has(roleId)) await member.roles.add(roleId, "Jarm kayit").catch(function () {});
  }

  const stats = db.get("register_stats_" + guild.id, { total: 0, male: 0, female: 0 });
  stats.total += 1;
  if (gender === "male") stats.male += 1;
  if (gender === "female") stats.female += 1;
  db.set("register_stats_" + guild.id, stats);
  db.delete("register_pending_" + guild.id + "_" + member.id);

  if (cfg.logChannel && guild.channels.cache.has(cfg.logChannel)) {
    await guild.channels.cache.get(cfg.logChannel).send({
      embeds: [
        jarmEmbed(CONFIG.colors.success)
          .setTitle("📝 Kayit Tamamlandi")
          .setDescription(member + " kayit oldu.")
          .addFields(
            { name: "Isim", value: "`" + nick + "`", inline: true },
            { name: "Cinsiyet", value: gender === "male" ? "♂ Erkek" : "♀ Kadin", inline: true },
            { name: "Yetkili", value: staffUser ? "" + staffUser : "Form", inline: true }
          )
      ]
    }).catch(function () {});
  }

  return nick;
}

function registrationModal() {
  const modal = new ModalBuilder().setCustomId("register_modal").setTitle("Jarm Kayit Formu");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("name").setLabel("Ismin").setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("age").setLabel("Yasin").setStyle(TextInputStyle.Short).setMaxLength(2).setRequired(true)
    )
  );
  return modal;
}

/* ================= GUARD ================= */

const guardActions = new Map();
const joinTracker = new Map();

function getGuard(guildId) {
  return db.get("guard_" + guildId, {
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
  const me = guild.members.me;
  if (me && me.id === userId) return true;
  if (cfg.whitelistUsers.indexOf(userId) !== -1) return true;
  const member = guild.members.cache.get(userId);
  if (!member) return false;
  return member.roles.cache.some(function (r) { return cfg.whitelistRoles.indexOf(r.id) !== -1; });
}

async function guardLog(guild, embed) {
  const cfg = getGuard(guild.id);
  if (!cfg.logChannel) return;
  const ch = guild.channels.cache.get(cfg.logChannel);
  if (!ch) return;
  await ch.send({ embeds: [embed] }).catch(function () {});
}

async function punishGuard(guild, executorId, reason) {
  const member = await guild.members.fetch(executorId).catch(function () { return null; });
  if (member && member.moderatable) {
    await member.roles.set([], "Jarm Guard: " + reason).catch(function () {});
    await member.ban({ reason: "Jarm Guard: " + reason }).catch(function () {});
  }
  await guardLog(guild, jarmEmbed(CONFIG.colors.guard).setTitle("🚨 Guard Mudahalesi").setDescription("Yetkisiz: `" + reason + "`\nKisi: <@" + executorId + ">"));
}

async function registerGuardAction(guild, executorId, action) {
  if (isGuardWhitelisted(guild, executorId)) return;
  const key = guild.id + "_" + executorId;
  const arr = (guardActions.get(key) || []).filter(function (t) { return Date.now() - t < 10000; });
  arr.push(Date.now());
  guardActions.set(key, arr);
  await guardLog(guild, jarmEmbed(CONFIG.colors.guard).setTitle("⚠️ Guard Uyarisi").setDescription("<@" + executorId + "> • `" + action + "` • " + arr.length + "/3"));
  if (arr.length >= 3) {
    guardActions.set(key, []);
    await punishGuard(guild, executorId, action);
  }
}

/* ================= AUTOMOD ================= */

const defaultBadWords = ["amk", "aq", "amq", "orospu", "piç", "pic", "sik", "yarrak", "kahpe", "pezevenk", "ibne", "gavat", "amcık", "yavşak", "oc"];
const spamMap = new Map();

async function runAutomod(message) {
  if (!message.guild || !message.member || message.author.bot) return false;

  const settings = db.get("automod_" + message.guild.id, { badword: false, invite: true, link: false, caps: false, spam: true });
  if (!Object.values(settings).some(Boolean)) return false;

  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages) || message.member.permissions.has(PermissionFlagsBits.Administrator)) return false;

  const content = message.content || "";
  let violation = null;

  if (settings.badword) {
    const words = db.get("badwords_" + message.guild.id, defaultBadWords);
    const low = content.toLowerCase();
    for (const w of words) { if (low.indexOf(w) !== -1) { violation = "Kufur filtresi"; break; } }
  }

  if (!violation && settings.invite && /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)/i.test(content)) violation = "Davet engeli";
  if (!violation && settings.link && /(https?:\/\/|www\.)/i.test(content)) violation = "Link engeli";

  if (!violation && settings.caps) {
    const letters = content.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, "");
    const upper = content.replace(/[^A-ZÇĞİÖŞÜ]/g, "");
    if (content.length >= 10 && letters.length >= 8 && upper.length / letters.length > 0.7) violation = "Caps engeli";
  }

  if (!violation && settings.spam) {
    const key = message.guild.id + "_" + message.author.id;
    const recent = (spamMap.get(key) || []).filter(function (t) { return Date.now() - t < 3500; });
    recent.push(Date.now());
    spamMap.set(key, recent);
    if (recent.length >= 5) {
      violation = "Anti-spam";
      spamMap.set(key, []);
    }
  }

  if (!violation) return false;

  await message.delete().catch(function () {});

  const warnMsg = await message.channel.send({ embeds: [errEmbed(message.author + ", automod: `" + violation + "`. Mesaj silindi.")] }).catch(function () { return null; });
  if (warnMsg) setTimeout(function () { warnMsg.delete().catch(function () {}); }, 5000);

  addRecord(message.guild, message.author.id, "AUTOMOD", client.user, violation);

  if (violation === "Anti-spam") await message.member.timeout(60000, "Jarm anti-spam").catch(function () {});

  return true;
}

/* ================= SAFE MATH ================= */

function calcExpression(expr) {
  const clean = String(expr).replace(/\s/g, "");
  if (!/^[0-9+\-*/().%^]+$/.test(clean)) throw new Error("Gecersiz");

  const tokens = clean.match(/\d+\.?\d*|[+\-*/%^()]/g);
  if (!tokens || tokens.join("") !== clean) throw new Error("Gecersiz");

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
    if (typeof item === "number") {
      stack.push(item);
    } else {
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

/* ================= SETUP HELPERS ================= */

async function findOrCreateRole(guild, name, color, permissions) {
  let role = guild.roles.cache.find(function (r) { return r.name === name; });
  if (role) return role;
  return guild.roles.create({ name: name, color: color, permissions: permissions || [], reason: "Jarm kurulum" });
}

async function findOrCreateCategory(guild, name, overwrites) {
  let cat = guild.channels.cache.find(function (c) { return c.name === name && c.type === ChannelType.GuildCategory; });
  if (cat) return cat;
  return guild.channels.create({ name: name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites || [], reason: "Jarm kurulum" });
}

async function findOrCreateTextChannel(guild, parent, name, topic, overwrites) {
  let ch = guild.channels.cache.find(function (c) { return c.name === name && c.type === ChannelType.GuildText; });
  if (ch) return ch;
  return guild.channels.create({
    name: name,
    type: ChannelType.GuildText,
    parent: parent ? parent.id : null,
    topic: topic || null,
    permissionOverwrites: overwrites || [],
    reason: "Jarm kurulum"
  });
}

/* ================= COMMANDS ================= */

const commands = [];

commands.push({
  category: "Kurulum",
  data: new SlashCommandBuilder().setName("kurulum").setDescription("Sunucuyu Jarm ile bastan kurar.").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.Administrator])) return deny(interaction, "Yonetici gerekli.");

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
        return interaction.editReply({ embeds: [errEmbed("Bana Rolleri Yonet + Kanallari Yonet yetkisi ver.")] });
      }
    }

    const roles = {};
    roles.admin = await findOrCreateRole(guild, "🛡️ Kurmay", 0xe74c3c, [PermissionFlagsBits.Administrator]);
    roles.mod = await findOrCreateRole(guild, "⚔️ Moderator", 0x3498db, [PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageNicknames]);
    roles.support = await findOrCreateRole(guild, "🛠️ Destek Ekibi", 0x2ecc71, [PermissionFlagsBits.ManageMessages]);
    roles.guard = await findOrCreateRole(guild, "🛡️ Guard Whitelist", 0x111827, []);
    roles.vip = await findOrCreateRole(guild, "💎 VIP", 0xf1c40f, []);
    roles.member = await findOrCreateRole(guild, "🌟 Uye", 0x95a5a6, []);
    roles.male = await findOrCreateRole(guild, "♂ Erkek", 0x1f8beb, []);
    roles.female = await findOrCreateRole(guild, "♀ Kadin", 0xff7eb9, []);
    roles.unregistered = await findOrCreateRole(guild, "• Kayitsiz", 0x7f8c8d, []);
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

    const catInfo = await findOrCreateCategory(guild, "📌 BILGILENDIRME", readOnly);
    const catCommunity = await findOrCreateCategory(guild, "🌐 TOPLULUK", publicWrite);
    const catRegister = await findOrCreateCategory(guild, "🚪 KAYIT", readOnly);
    const catSupport = await findOrCreateCategory(guild, "🎫 DESTEK", readOnly);
    const catStaff = await findOrCreateCategory(guild, "🔐 YETKILI", staffOnly);

    const chRules = await findOrCreateTextChannel(guild, catInfo, "📋・kurallar", "Kurallar");
    const chAnnounce = await findOrCreateTextChannel(guild, catInfo, "📢・duyurular", "Duyurular");
    const chCounter = await findOrCreateTextChannel(guild, catInfo, "📊・sayac", "Sayac");
    await findOrCreateTextChannel(guild, catCommunity, "💬・sohbet", "Genel sohbet");
    const chAi = await findOrCreateTextChannel(guild, catCommunity, "🤖・jarm-ai", "AI sohbet");
    await findOrCreateTextChannel(guild, catCommunity, "🖼️・medya", "Medya");
    await findOrCreateTextChannel(guild, catCommunity, "🎮・oyun", "Oyun");
    const chWelcome = await findOrCreateTextChannel(guild, catRegister, "👋・hosgeldin", "Giris");
    const chRegLog = await findOrCreateTextChannel(guild, catRegister, "📝・kayit-log", "Kayit log", staffOnly);
    const chTicket = await findOrCreateTextChannel(guild, catSupport, "🎫・destek-talebi", "Ticket paneli");
    const chTicketLog = await findOrCreateTextChannel(guild, catSupport, "📄・ticket-log", "Ticket log", staffOnly);
    const chModLog = await findOrCreateTextChannel(guild, catStaff, "📚・mod-log", "Mod log", staffOnly);
    const chGuardLog = await findOrCreateTextChannel(guild, catStaff, "🚨・guard-log", "Guard log", staffOnly);
    await findOrCreateTextChannel(guild, catStaff, "🛡️・yetkili-sohbet", "Yetkili", staffOnly);

    db.set("ticket_staff_" + guild.id, roles.support.id);
    db.set("ticket_log_" + guild.id, chTicketLog.id);
    db.set("modlog_" + guild.id, chModLog.id);
    db.set("welcome_" + guild.id, chWelcome.id);
    db.set("welcomelog_" + guild.id, chRegLog.id);
    db.set("ai_channels_" + guild.id, [chAi.id]);
    db.set("otorole_" + guild.id, { member: roles.unregistered.id, bot: roles.vip.id });
    db.set("register_" + guild.id, {
      unregisteredRole: roles.unregistered.id,
      maleRole: roles.male.id,
      femaleRole: roles.female.id,
      memberRole: roles.member.id,
      tag: "✦",
      logChannel: chRegLog.id
    });
    db.set("automod_" + guild.id, { badword: true, invite: true, link: false, caps: false, spam: true });
    db.set("guard_" + guild.id, {
      enabled: true,
      antiNuke: true,
      antiRaid: true,
      antiRole: true,
      logChannel: chGuardLog.id,
      whitelistRoles: [roles.admin.id, roles.guard.id],
      whitelistUsers: []
    });
    db.set("levelroles_" + guild.id, { "5": roles.l5.id, "10": roles.l10.id, "25": roles.l25.id, "50": roles.l50.id });
    db.set("counter_" + guild.id, { channel: chCounter.id, target: 500 });

    await chRules.send({ embeds: [jarmEmbed(CONFIG.colors.error).setTitle("📋 Kurallar").setDescription("1. Saygi.\n2. Reklam yasak.\n3. Spam/caps yasak.\n4. NSFW yasak.\n5. Yetkiliye saygi.")] }).catch(function () {});

    await chWelcome.send({
      embeds: [jarmEmbed(CONFIG.colors.success).setTitle("👋 Jarm Kayit Kapis").setDescription("Butona bas, formu doldur, aninda kayit.")],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("register_start").setLabel("Kayit Ol").setStyle(ButtonStyle.Success))]
    }).catch(function () {});

    await chTicket.send({ embeds: [ticketPanelEmbed()], components: ticketPanelComponents() }).catch(function () {});

    await chAi.send({ embeds: [jarmEmbed(CONFIG.colors.ai).setTitle("🤖 Jarm AI").setDescription("Burada yaz ya da @Jarm et; AI cevaplasin.")] }).catch(function () {});

    await chAnnounce.send({ embeds: [jarmEmbed(CONFIG.colors.gold).setTitle("📢 Kurulum Tamam").setDescription("Tum sistemler aktif.")] }).catch(function () {});

    await interaction.editReply({ embeds: [jarmEmbed(CONFIG.colors.success).setTitle("🏗️ Kurulum Tamamlandi").setDescription("Roller, kanallar, ticket GUI, kayit, AI, guard, automod, level ve 7/24 ses hazir.")] });
  }
});

commands.push({
  category: "Ticket",
  data: new SlashCommandBuilder()
    .setName("ticket-setup")
    .setDescription("Ticket paneli kurar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(function (o) { return o.setName("staff").setDescription("Yetkili rolu").setRequired(true); })
    .addChannelOption(function (o) { return o.setName("log").setDescription("Log kanali").setRequired(true).addChannelTypes(ChannelType.GuildText); })
    .addChannelOption(function (o) { return o.setName("panel").setDescription("Panel kanali").addChannelTypes(ChannelType.GuildText); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Sunucuyu yonet gerekli.");

    const staff = interaction.options.getRole("staff");
    const log = interaction.options.getChannel("log");
    const panel = interaction.options.getChannel("panel") || interaction.channel;

    db.set("ticket_staff_" + interaction.guild.id, staff.id);
    db.set("ticket_log_" + interaction.guild.id, log.id);

    await panel.send({ embeds: [ticketPanelEmbed()], components: ticketPanelComponents() });

    await interaction.reply({ embeds: [okEmbed("Ticket paneli kuruldu.")], flags: MessageFlags.Ephemeral });
  }
});

commands.push({
  category: "Ticket",
  data: new SlashCommandBuilder().setName("ticket-add").setDescription("Ticket'a kullanici ekler.").addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici").setRequired(true); }),
  async execute(interaction) {
    const meta = db.get("ticket_" + interaction.channel.id, null);
    if (!meta) return deny(interaction, "Ticket kanali degil.");

    const user = interaction.options.getUser("kullanici");

    await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });

    if (meta.added.indexOf(user.id) === -1) meta.added.push(user.id);
    db.set("ticket_" + interaction.channel.id, meta);

    await interaction.reply({ embeds: [okEmbed(user + " eklendi.")] });
  }
});

commands.push({
  category: "Ticket",
  data: new SlashCommandBuilder().setName("ticket-remove").setDescription("Ticket'tan kullanici cikarir.").addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici").setRequired(true); }),
  async execute(interaction) {
    const meta = db.get("ticket_" + interaction.channel.id, null);
    if (!meta) return deny(interaction, "Ticket kanali degil.");

    const user = interaction.options.getUser("kullanici");

    await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: false, SendMessages: false });

    meta.added = meta.added.filter(function (id) { return id !== user.id; });
    db.set("ticket_" + interaction.channel.id, meta);

    await interaction.reply({ embeds: [okEmbed(user + " cikarildi.")] });
  }
});

commands.push({
  category: "Ticket",
  data: new SlashCommandBuilder().setName("ticket-close").setDescription("Ticket kapatir."),
  async execute(interaction) {
    const meta = db.get("ticket_" + interaction.channel.id, null);
    if (!meta) return deny(interaction, "Ticket kanali degil.");
    await askCloseTicket(interaction);
  }
});

commands.push({
  category: "Kayit",
  data: new SlashCommandBuilder()
    .setName("kayit-sistem")
    .setDescription("Kayit sistemi ayarlar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(function (o) { return o.setName("kayitsiz").setDescription("Kayitsiz").setRequired(true); })
    .addRoleOption(function (o) { return o.setName("erkek").setDescription("Erkek").setRequired(true); })
    .addRoleOption(function (o) { return o.setName("kadin").setDescription("Kadin").setRequired(true); })
    .addRoleOption(function (o) { return o.setName("uye").setDescription("Uye").setRequired(true); })
    .addChannelOption(function (o) { return o.setName("log").setDescription("Log").addChannelTypes(ChannelType.GuildText); })
    .addStringOption(function (o) { return o.setName("tag").setDescription("Tag").setMaxLength(5); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Yetki yok.");

    const logCh = interaction.options.getChannel("log");

    db.set("register_" + interaction.guild.id, {
      unregisteredRole: interaction.options.getRole("kayitsiz").id,
      maleRole: interaction.options.getRole("erkek").id,
      femaleRole: interaction.options.getRole("kadin").id,
      memberRole: interaction.options.getRole("uye").id,
      logChannel: logCh ? logCh.id : null,
      tag: interaction.options.getString("tag") || ""
    });

    await interaction.reply({ embeds: [okEmbed("Kayit sistemi ayarlandi.")] });
  }
});

commands.push({
  category: "Kayit",
  data: new SlashCommandBuilder()
    .setName("kayit-panel")
    .setDescription("Kayit paneli gonderir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(function (o) { return o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Yetki yok.");

    const channel = interaction.options.getChannel("kanal") || interaction.channel;

    await channel.send({
      embeds: [jarmEmbed(CONFIG.colors.success).setTitle("📝 Kayit Sistemi").setDescription("Butona bas, form doldur, aninda kayit.")],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("register_start").setLabel("Kayit Ol").setStyle(ButtonStyle.Success))]
    });

    await interaction.reply({ embeds: [okEmbed("Panel gonderildi.")], flags: MessageFlags.Ephemeral });
  }
});

commands.push({
  category: "Kayit",
  data: new SlashCommandBuilder()
    .setName("kayit")
    .setDescription("Manuel kayit.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption(function (o) { return o.setName("kullanici").setDescription("Uye").setRequired(true); })
    .addStringOption(function (o) { return o.setName("isim").setDescription("Isim").setRequired(true).setMaxLength(20); })
    .addIntegerOption(function (o) { return o.setName("yas").setDescription("Yas").setRequired(true).setMinValue(8).setMaxValue(99); })
    .addStringOption(function (o) { return o.setName("cinsiyet").setDescription("Cinsiyet").setRequired(true).addChoices({ name: "Erkek", value: "male" }, { name: "Kadin", value: "female" }); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageNicknames])) return deny(interaction, "Yetki yok.");

    const member = await interaction.guild.members.fetch(interaction.options.getUser("kullanici").id).catch(function () { return null; });
    if (!member) return deny(interaction, "Uye yok.");

    try {
      const nick = await applyRegistration(
        interaction.guild,
        member,
        { name: interaction.options.getString("isim"), age: interaction.options.getInteger("yas") },
        interaction.options.getString("cinsiyet"),
        interaction.user
      );
      await interaction.reply({ embeds: [okEmbed(member + " kayit edildi: `" + nick + "`")] });
    } catch (e) {
      await interaction.reply({ embeds: [errEmbed(e.message)] });
    }
  }
});

commands.push({
  category: "Kayit",
  data: new SlashCommandBuilder().setName("kayit-bilgi").setDescription("Kayit istatistikleri."),
  async execute(interaction) {
    const stats = db.get("register_stats_" + interaction.guild.id, { total: 0, male: 0, female: 0 });
    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.main)
          .setTitle("📝 Kayit Istatistikleri")
          .addFields(
            { name: "Toplam", value: String(stats.total), inline: true },
            { name: "Erkek", value: String(stats.male), inline: true },
            { name: "Kadin", value: String(stats.female), inline: true }
          )
      ]
    });
  }
});

commands.push({
  category: "AI",
  data: new SlashCommandBuilder().setName("ai-sor").setDescription("AI'a soru sor.").addStringOption(function (o) { return o.setName("soru").setDescription("Soru").setRequired(true).setMaxLength(1000); }),
  async execute(interaction) {
    await interaction.deferReply();

    const question = interaction.options.getString("soru");

    let blocked = false;
    for (const r of blockedAiPatterns) { if (r.test(question)) { blocked = true; break; } }
    if (blocked) return interaction.editReply({ embeds: [errEmbed("Bu konuda yardimci olamam.")] });

    addAiMemory(interaction.user.id, "user", question);

    const answer = await callAi([{ role: "system", content: AI_SYSTEM_PROMPT }].concat(aiMemory.get(interaction.user.id) || []));

    if (!answer) {
      return interaction.editReply({ embeds: [errEmbed("AI yanit vermedi. Biraz sonra dene veya GROQ_API_KEY / NODE_VERSION kontrol et.")] });
    }

    addAiMemory(interaction.user.id, "assistant", answer);

    await interaction.editReply({
      embeds: [
        jarmEmbed(CONFIG.colors.ai)
          .setAuthor({ name: "Jarm AI • " + interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
          .setDescription(cleanText(answer, 4000))
      ]
    });
  }
});

commands.push({
  category: "AI",
  data: new SlashCommandBuilder()
    .setName("ai-kanal")
    .setDescription("AI kanali yonet.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(function (o) { return o.setName("islem").setDescription("Islem").setRequired(true).addChoices({ name: "ekle", value: "add" }, { name: "sil", value: "remove" }, { name: "liste", value: "list" }); })
    .addChannelOption(function (o) { return o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Yetki yok.");

    const action = interaction.options.getString("islem");
    const channel = interaction.options.getChannel("kanal") || interaction.channel;
    let list = db.get("ai_channels_" + interaction.guild.id, []);

    if (action === "add") {
      if (list.indexOf(channel.id) === -1) list.push(channel.id);
      db.set("ai_channels_" + interaction.guild.id, list);
      return interaction.reply({ embeds: [okEmbed(channel + " AI kanali oldu.")] });
    }

    if (action === "remove") {
      list = list.filter(function (id) { return id !== channel.id; });
      db.set("ai_channels_" + interaction.guild.id, list);
      return interaction.reply({ embeds: [okEmbed("AI kanali kaldirildi.")] });
    }

    return interaction.reply({ embeds: [infoEmbed(list.length ? list.map(function (id) { return "<#" + id + ">"; }).join("\n") : "AI kanali yok.")] });
  }
});

commands.push({
  category: "Guard",
  data: new SlashCommandBuilder()
    .setName("guard")
    .setDescription("Guard yonet.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(function (o) {
      return o.setName("islem").setDescription("Islem").setRequired(true).addChoices(
        { name: "durum", value: "status" },
        { name: "ac", value: "on" },
        { name: "kapat", value: "off" },
        { name: "log", value: "log" },
        { name: "whitelist-ekle", value: "roleadd" },
        { name: "whitelist-sil", value: "roleremove" }
      );
    })
    .addChannelOption(function (o) { return o.setName("kanal").setDescription("Log kanali").addChannelTypes(ChannelType.GuildText); })
    .addRoleOption(function (o) { return o.setName("rol").setDescription("Rol"); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.Administrator])) return deny(interaction, "Yonetici gerekli.");

    const cfg = getGuard(interaction.guild.id);
    const action = interaction.options.getString("islem");

    if (action === "on") {
      cfg.enabled = true;
      db.set("guard_" + interaction.guild.id, cfg);
      return interaction.reply({ embeds: [okEmbed("Guard acildi.")] });
    }

    if (action === "off") {
      cfg.enabled = false;
      db.set("guard_" + interaction.guild.id, cfg);
      return interaction.reply({ embeds: [okEmbed("Guard kapandi.")] });
    }

    if (action === "log") {
      const ch = interaction.options.getChannel("kanal");
      if (!ch) return deny(interaction, "Kanal belirt.");
      cfg.logChannel = ch.id;
      db.set("guard_" + interaction.guild.id, cfg);
      return interaction.reply({ embeds: [okEmbed("Guard log: " + ch)] });
    }

    if (action === "roleadd") {
      const role = interaction.options.getRole("rol");
      if (!role) return deny(interaction, "Rol belirt.");
      if (cfg.whitelistRoles.indexOf(role.id) === -1) cfg.whitelistRoles.push(role.id);
      db.set("guard_" + interaction.guild.id, cfg);
      return interaction.reply({ embeds: [okEmbed(role + " whitelist eklendi.")] });
    }

    if (action === "roleremove") {
      const role = interaction.options.getRole("rol");
      if (!role) return deny(interaction, "Rol belirt.");
      cfg.whitelistRoles = cfg.whitelistRoles.filter(function (id) { return id !== role.id; });
      db.set("guard_" + interaction.guild.id, cfg);
      return interaction.reply({ embeds: [okEmbed(role + " cikarildi.")] });
    }

    return interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.guard)
          .setTitle("🛡️ Guard Durumu")
          .addFields(
            { name: "Aktif", value: cfg.enabled ? "✅" : "❌", inline: true },
            { name: "Log", value: cfg.logChannel ? "<#" + cfg.logChannel + ">" : "Yok", inline: true },
            { name: "Whitelist", value: cfg.whitelistRoles.length ? cfg.whitelistRoles.map(function (id) { return "<@&" + id + ">"; }).join("\n") : "Yok", inline: false }
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
    .addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici").setRequired(true); })
    .addStringOption(function (o) { return o.setName("sebep").setDescription("Sebep"); })
    .addIntegerOption(function (o) { return o.setName("gun").setDescription("Mesaj silme gunu").setMinValue(0).setMaxValue(7); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.BanMembers])) return deny(interaction, "Ban yetkisi yok.");

    const user = interaction.options.getUser("kullanici");
    const member = await interaction.guild.members.fetch(user.id).catch(function () { return null; });
    if (member && !hierarchyOk(interaction, member)) return deny(interaction, "Hiyerarsi engeli.");

    const reason = interaction.options.getString("sebep") || "Belirtilmedi";
    const days = interaction.options.getInteger("gun") || 0;

    await interaction.guild.members.ban(user.id, { deleteMessageSeconds: days * 86400, reason: reason });
    addRecord(interaction.guild, user.id, "BAN", interaction.user, reason);

    await interaction.reply({ embeds: [okEmbed(user.tag + " banlandi.")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Ban kaldir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(function (o) { return o.setName("kullanici_id").setDescription("ID").setRequired(true); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.BanMembers])) return deny(interaction, "Yetki yok.");

    const id = interaction.options.getString("kullanici_id");
    await interaction.guild.members.unban(id, "Jarm unban").catch(function () { return null; });
    addRecord(interaction.guild, id, "UNBAN", interaction.user, "Unban");

    await interaction.reply({ embeds: [okEmbed("<@" + id + "> bani kaldirildi.")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick.")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici").setRequired(true); })
    .addStringOption(function (o) { return o.setName("sebep").setDescription("Sebep"); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.KickMembers])) return deny(interaction, "Yetki yok.");

    const member = await interaction.guild.members.fetch(interaction.options.getUser("kullanici").id).catch(function () { return null; });
    if (!member) return deny(interaction, "Uye yok.");
    if (!hierarchyOk(interaction, member)) return deny(interaction, "Hiyerarsi engeli.");

    const reason = interaction.options.getString("sebep") || "Belirtilmedi";
    await member.kick(reason);
    addRecord(interaction.guild, member.id, "KICK", interaction.user, reason);

    await interaction.reply({ embeds: [okEmbed(member.user.tag + " atildi.")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici").setRequired(true); })
    .addIntegerOption(function (o) { return o.setName("dakika").setDescription("Dakika").setRequired(true).setMinValue(1).setMaxValue(40320); })
    .addStringOption(function (o) { return o.setName("sebep").setDescription("Sebep"); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, "Yetki yok.");

    const member = await interaction.guild.members.fetch(interaction.options.getUser("kullanici").id).catch(function () { return null; });
    if (!member) return deny(interaction, "Uye yok.");
    if (!hierarchyOk(interaction, member)) return deny(interaction, "Hiyerarsi engeli.");
    if (!member.moderatable) return deny(interaction, "Uygulanamaz.");

    const minutes = interaction.options.getInteger("dakika");
    const reason = interaction.options.getString("sebep") || "Belirtilmedi";

    await member.timeout(minutes * 60000, reason);
    addRecord(interaction.guild, member.id, "TIMEOUT", interaction.user, minutes + "dk " + reason);

    await interaction.reply({ embeds: [okEmbed(member + " " + minutes + "dk susturuldu.")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Timeout kaldir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici").setRequired(true); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, "Yetki yok.");

    const member = await interaction.guild.members.fetch(interaction.options.getUser("kullanici").id).catch(function () { return null; });
    if (!member) return deny(interaction, "Uye yok.");

    await member.timeout(null, "Jarm untimeout");
    addRecord(interaction.guild, member.id, "UNTIMEOUT", interaction.user, "Kaldirildi");

    await interaction.reply({ embeds: [okEmbed("Timeout kaldirildi.")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Uyari.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici").setRequired(true); })
    .addStringOption(function (o) { return o.setName("sebep").setDescription("Sebep").setRequired(true); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, "Yetki yok.");

    const user = interaction.options.getUser("kullanici");
    const record = addRecord(interaction.guild, user.id, "WARN", interaction.user, interaction.options.getString("sebep"));

    await interaction.reply({ embeds: [okEmbed(user + " uyarildi. #" + record.id)] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder().setName("warnings").setDescription("Uyarilar.").addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici").setRequired(true); }),
  async execute(interaction) {
    const user = interaction.options.getUser("kullanici");
    const records = getRecords(interaction.guild.id, user.id).filter(function (r) { return r.type === "WARN"; });

    if (!records.length) return interaction.reply({ embeds: [infoEmbed("Uyari yok.")] });

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.warning)
          .setTitle("⚠️ " + user.tag)
          .setDescription(records.slice(-15).map(function (r) { return "#" + r.id + " • " + cleanText(r.reason, 80) + " • <t:" + Math.floor(r.date / 1000) + ":R>"; }).join("\n"))
      ]
    });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("clearwarn")
    .setDescription("Uyarilari temizle.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici").setRequired(true); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ModerateMembers])) return deny(interaction, "Yetki yok.");

    const user = interaction.options.getUser("kullanici");
    db.set("records_" + interaction.guild.id + "_" + user.id, getRecords(interaction.guild.id, user.id).filter(function (r) { return r.type !== "WARN"; }));
    addRecord(interaction.guild, user.id, "CLEARWARN", interaction.user, "Temizlendi");

    await interaction.reply({ embeds: [okEmbed("Uyarilar temizlendi.")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder().setName("sicil").setDescription("Sicil.").addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici").setRequired(true); }),
  async execute(interaction) {
    const user = interaction.options.getUser("kullanici");
    const records = getRecords(interaction.guild.id, user.id);

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.purple)
          .setTitle("📒 " + user.tag + " Sicil")
          .setDescription(records.length ? records.slice(-15).reverse().map(function (r) { return "#" + r.id + " • `" + r.type + "` • " + cleanText(r.reason, 80); }).join("\n") : "Sicil temiz ✅")
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
    .addIntegerOption(function (o) { return o.setName("miktar").setDescription("1-100").setRequired(true).setMinValue(1).setMaxValue(100); })
    .addBooleanOption(function (o) { return o.setName("sadece_bot").setDescription("Sadece bot"); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageMessages])) return deny(interaction, "Yetki yok.");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const amount = interaction.options.getInteger("miktar");
    const onlyBot = interaction.options.getBoolean("sadece_bot") || false;

    const fetched = await interaction.channel.messages.fetch({ limit: amount });
    let list = onlyBot ? fetched.filter(function (m) { return m.author.bot; }) : fetched;
    list = list.filter(function (m) { return Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000; });

    if (!list.size) return interaction.editReply({ embeds: [errEmbed("Silinecek mesaj yok.")] });

    await interaction.channel.bulkDelete(list, true).catch(async function () {
      for (const msg of list.values()) await msg.delete().catch(function () {});
    });

    await interaction.editReply({ embeds: [okEmbed(list.size + " mesaj silindi.")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder().setName("kilitle").setDescription("Kilitle.").setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageChannels])) return deny(interaction, "Yetki yok.");
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { SendMessages: false });
    await interaction.reply({ embeds: [okEmbed("Kanal kilitlendi 🔒")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder().setName("kilit-ac").setDescription("Kilit ac.").setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageChannels])) return deny(interaction, "Yetki yok.");
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { SendMessages: null });
    await interaction.reply({ embeds: [okEmbed("Kilit acildi 🔓")] });
  }
});

commands.push({
  category: "Moderasyon",
  data: new SlashCommandBuilder()
    .setName("modlog")
    .setDescription("Modlog ayarla.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(function (o) { return o.setName("kanal").setDescription("Kanal").setRequired(true).addChannelTypes(ChannelType.GuildText); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Yetki yok.");
    db.set("modlog_" + interaction.guild.id, interaction.options.getChannel("kanal").id);
    await interaction.reply({ embeds: [okEmbed("Modlog ayarlandi.")] });
  }
});

commands.push({
  category: "Sistem",
  data: new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Automod yonet.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(function (o) {
      return o.setName("sistem").setDescription("Sistem").setRequired(true).addChoices(
        { name: "kufur", value: "badword" },
        { name: "davet", value: "invite" },
        { name: "link", value: "link" },
        { name: "caps", value: "caps" },
        { name: "spam", value: "spam" }
      );
    })
    .addBooleanOption(function (o) { return o.setName("durum").setDescription("Durum").setRequired(true); })
    .addStringOption(function (o) { return o.setName("kelime").setDescription("Ozel kelime"); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Yetki yok.");

    const system = interaction.options.getString("sistem");
    const status = interaction.options.getBoolean("durum");
    const word = interaction.options.getString("kelime");

    const settings = db.get("automod_" + interaction.guild.id, { badword: false, invite: true, link: false, caps: false, spam: true });
    settings[system] = status;
    db.set("automod_" + interaction.guild.id, settings);

    if (word) {
      const list = db.get("badwords_" + interaction.guild.id, defaultBadWords);
      if (list.indexOf(word.toLowerCase()) === -1) list.push(word.toLowerCase());
      db.set("badwords_" + interaction.guild.id, list);
    }

    await interaction.reply({ embeds: [okEmbed("`" + system + "` = " + (status ? "Acik" : "Kapali"))] });
  }
});

commands.push({
  category: "Sistem",
  data: new SlashCommandBuilder()
    .setName("otorol")
    .setDescription("Otorol ayarla.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(function (o) { return o.setName("uye_rol").setDescription("Uye rolu"); })
    .addRoleOption(function (o) { return o.setName("bot_rol").setDescription("Bot rolu"); })
    .addBooleanOption(function (o) { return o.setName("kapat").setDescription("Kapat"); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Yetki yok.");

    if (interaction.options.getBoolean("kapat")) {
      db.delete("otorole_" + interaction.guild.id);
      return interaction.reply({ embeds: [okEmbed("Otorol kapandi.")] });
    }

    const ur = interaction.options.getRole("uye_rol");
    const br = interaction.options.getRole("bot_rol");

    db.set("otorole_" + interaction.guild.id, {
      member: ur ? ur.id : null,
      bot: br ? br.id : null
    });

    await interaction.reply({ embeds: [okEmbed("Otorol ayarlandi.")] });
  }
});

commands.push({
  category: "Sistem",
  data: new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Welcome kanallari.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(function (o) { return o.setName("kanal").setDescription("Karsilama").addChannelTypes(ChannelType.GuildText); })
    .addChannelOption(function (o) { return o.setName("log").setDescription("Log").addChannelTypes(ChannelType.GuildText); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Yetki yok.");

    const channel = interaction.options.getChannel("kanal");
    const log = interaction.options.getChannel("log");

    if (channel) db.set("welcome_" + interaction.guild.id, channel.id);
    if (log) db.set("welcomelog_" + interaction.guild.id, log.id);

    await interaction.reply({ embeds: [okEmbed("Welcome guncellendi.")] });
  }
});

commands.push({
  category: "Sistem",
  data: new SlashCommandBuilder()
    .setName("sayac")
    .setDescription("Sayac ayarla.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(function (o) { return o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText); })
    .addIntegerOption(function (o) { return o.setName("hedef").setDescription("Hedef").setMinValue(1); })
    .addBooleanOption(function (o) { return o.setName("kapat").setDescription("Kapat"); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageGuild])) return deny(interaction, "Yetki yok.");

    if (interaction.options.getBoolean("kapat")) {
      db.delete("counter_" + interaction.guild.id);
      return interaction.reply({ embeds: [okEmbed("Sayac kapandi.")] });
    }

    const channel = interaction.options.getChannel("kanal");
    const target = interaction.options.getInteger("hedef");

    if (!channel || !target) {
      const cfg = db.get("counter_" + interaction.guild.id, null);
      if (!cfg) return interaction.reply({ embeds: [infoEmbed("Sayac ayarli degil.")] });
      return interaction.reply({ embeds: [infoEmbed("Hedef " + cfg.target + " • Kalan " + Math.max(0, cfg.target - interaction.guild.memberCount))] });
    }

    db.set("counter_" + interaction.guild.id, { channel: channel.id, target: target });
    await interaction.reply({ embeds: [okEmbed("Sayac: " + channel + " • " + target)] });
  }
});

commands.push({
  category: "Level",
  data: new SlashCommandBuilder().setName("level").setDescription("Seviye karti.").addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici"); }),
  async execute(interaction) {
    const user = interaction.options.getUser("kullanici") || interaction.user;
    const data = getXp(interaction.guild.id, user.id);

    const cur = data.xp - xpForLevel(data.level);
    const need = xpForLevel(data.level + 1) - xpForLevel(data.level);

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setAuthor({ name: user.username + " • Level", iconURL: user.displayAvatarURL() })
          .setThumbnail(user.displayAvatarURL({ size: 512 }))
          .addFields(
            { name: "Seviye", value: String(data.level), inline: true },
            { name: "XP", value: String(data.xp), inline: true },
            { name: "Mesaj", value: String(data.messages), inline: true },
            { name: "Ilerleme", value: progressBar(cur, need) + " %" + Math.round((cur / need) * 100), inline: false }
          )
      ]
    });
  }
});

commands.push({
  category: "Level",
  data: new SlashCommandBuilder().setName("liderlik").setDescription("Level liderligi."),
  async execute(interaction) {
    const rows = db.startsWith("xp_" + interaction.guild.id + "_")
      .map(function (item) { return Object.assign({ userId: item[0].split("_")[2] }, item[1]); })
      .sort(function (a, b) { return b.xp - a.xp; })
      .slice(0, 10);

    if (!rows.length) return interaction.reply({ embeds: [infoEmbed("Veri yok.")] });

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setTitle("🏆 Liderlik")
          .setDescription(rows.map(function (r, i) { return "**" + (i + 1) + ".** <@" + r.userId + "> • Lv " + r.level + " • " + r.xp + " XP"; }).join("\n"))
      ]
    });
  }
});

commands.push({
  category: "Level",
  data: new SlashCommandBuilder()
    .setName("level-rol")
    .setDescription("Seviye rolu.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addIntegerOption(function (o) { return o.setName("seviye").setDescription("Seviye").setRequired(true).setMinValue(1); })
    .addRoleOption(function (o) { return o.setName("rol").setDescription("Rol"); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageRoles])) return deny(interaction, "Yetki yok.");

    const level = interaction.options.getInteger("seviye");
    const role = interaction.options.getRole("rol");
    const roles = db.get("levelroles_" + interaction.guild.id, {});

    if (role) roles[String(level)] = role.id;
    else delete roles[String(level)];

    db.set("levelroles_" + interaction.guild.id, roles);

    await interaction.reply({ embeds: [okEmbed("Level rolu guncellendi.")] });
  }
});

commands.push({
  category: "Bom & Owo",
  data: new SlashCommandBuilder().setName("bom").setDescription("Bom bakiye.").addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici"); }),
  async execute(interaction) {
    const user = interaction.options.getUser("kullanici") || interaction.user;
    const data = getBom(interaction.guild.id, user.id);

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setAuthor({ name: user.username + " • Bom Cuzdan", iconURL: user.displayAvatarURL() })
          .addFields(
            { name: "💰 Bakiye", value: data.balance + " Bom", inline: true },
            { name: "🎲 Bahis", value: data.wins + "/" + data.gambles, inline: true }
          )
      ]
    });
  }
});

commands.push({
  category: "Bom & Owo",
  data: new SlashCommandBuilder().setName("bom-daily").setDescription("Gunluk Bom odulu."),
  async execute(interaction) {
    const data = getBom(interaction.guild.id, interaction.user.id);
    const now = Date.now();

    if (now - data.lastDaily < 24 * 60 * 60 * 1000) {
      const remain = Math.ceil((24 * 60 * 60 * 1000 - (now - data.lastDaily)) / 3600000);
      return interaction.reply({ embeds: [errEmbed("Gunluk odul alindi. ~" + remain + " saat sonra gel.")] });
    }

    const amount = 250 + randomInt(0, 100);
    data.lastDaily = now;
    data.balance += amount;
    db.set("bom_" + interaction.guild.id + "_" + interaction.user.id, data);

    await interaction.reply({ embeds: [okEmbed("Gunluk odul: **+" + amount + " Bom** 💰")] });
  }
});

commands.push({
  category: "Bom & Owo",
  data: new SlashCommandBuilder()
    .setName("bom-gamble")
    .setDescription("Bom bahis.")
    .addIntegerOption(function (o) { return o.setName("miktar").setDescription("Miktar").setRequired(true).setMinValue(1); }),
  async execute(interaction) {
    const amount = interaction.options.getInteger("miktar");
    const data = getBom(interaction.guild.id, interaction.user.id);

    if (data.balance < amount) return interaction.reply({ embeds: [errEmbed("Yetersiz bakiye: " + data.balance + " Bom")] });

    data.gambles += 1;
    const win = Math.random() < 0.5;

    if (win) {
      data.balance += amount;
      data.wins += 1;
    } else {
      data.balance -= amount;
    }

    db.set("bom_" + interaction.guild.id + "_" + interaction.user.id, data);

    await interaction.reply({
      embeds: [
        jarmEmbed(win ? CONFIG.colors.success : CONFIG.colors.error)
          .setTitle(win ? "🎉 KAZANDIN!" : "💀 KAYBETTIN")
          .setDescription(win ? "+" + amount + " Bom. Bakiye: **" + data.balance + "**" : "-" + amount + " Bom. Bakiye: **" + data.balance + "**")
      ]
    });
  }
});

commands.push({
  category: "Bom & Owo",
  data: new SlashCommandBuilder()
    .setName("bom-transfer")
    .setDescription("Bom transfer.")
    .addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici").setRequired(true); })
    .addIntegerOption(function (o) { return o.setName("miktar").setDescription("Miktar").setRequired(true).setMinValue(1); }),
  async execute(interaction) {
    const target = interaction.options.getUser("kullanici");
    const amount = interaction.options.getInteger("miktar");

    if (target.id === interaction.user.id) return deny(interaction, "Kendine transfer edemezsin.");
    if (target.bot) return deny(interaction, "Bota transfer edemezsin.");

    const sender = getBom(interaction.guild.id, interaction.user.id);
    if (sender.balance < amount) return deny(interaction, "Yetersiz bakiye: " + sender.balance + " Bom");

    const receiver = getBom(interaction.guild.id, target.id);

    sender.balance -= amount;
    receiver.balance += amount;

    db.set("bom_" + interaction.guild.id + "_" + interaction.user.id, sender);
    db.set("bom_" + interaction.guild.id + "_" + target.id, receiver);

    await interaction.reply({ embeds: [okEmbed(target + " kisisesine **" + amount + " Bom** gonderildi. 💸")] });
  }
});

commands.push({
  category: "Bom & Owo",
  data: new SlashCommandBuilder().setName("bom-top").setDescription("Bom liderligi."),
  async execute(interaction) {
    const rows = db.startsWith("bom_" + interaction.guild.id + "_")
      .map(function (item) { return Object.assign({ userId: item[0].split("_")[2] }, item[1]); })
      .sort(function (a, b) { return b.balance - a.balance; })
      .slice(0, 10);

    if (!rows.length) return interaction.reply({ embeds: [infoEmbed("Bom verisi yok.")] });

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setTitle("💰 Bom Liderligi")
          .setDescription(rows.map(function (r, i) { return "**" + (i + 1) + ".** <@" + r.userId + "> • " + r.balance + " Bom"; }).join("\n"))
      ]
    });
  }
});

commands.push({
  category: "Bom & Owo",
  data: new SlashCommandBuilder()
    .setName("owo")
    .setDescription("Owo aksiyonlari.")
    .addStringOption(function (o) {
      return o.setName("aksiyon").setDescription("Aksiyon").setRequired(true).addChoices(
        { name: "saril", value: "saril" },
        { name: "pat", value: "pat" },
        { name: "slap", value: "slap" },
        { name: "op", value: "kiss" },
        { name: "face", value: "face" }
      );
    })
    .addUserOption(function (o) { return o.setName("kullanici").setDescription("Hedef"); }),
  async execute(interaction) {
    const action = interaction.options.getString("aksiyon");

    if (action === "face") {
      return interaction.reply({ embeds: [jarmEmbed(CONFIG.colors.pink).setTitle("😺 Owo").setDescription("**" + pick(OWO_PHRASES.face) + "**")] });
    }

    const target = interaction.options.getUser("kullanici");
    if (!target) return deny(interaction, "Hedef kullanici sec.");

    const phrase = pick(OWO_PHRASES[action])
      .replace("{user}", "" + interaction.user)
      .replace("{target}", "" + target);

    await interaction.reply({ embeds: [jarmEmbed(CONFIG.colors.pink).setDescription(phrase)] });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("yardim").setDescription("Yardim."),
  async execute(interaction) {
    const groups = {};
    for (const cmd of client.commands.values()) {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category].push("`/" + cmd.data.name + "`");
    }

    const emb = jarmEmbed(CONFIG.colors.main).setTitle("📚 Jarm Yardim").setDescription("Toplam " + client.commands.size + " komut.");
    for (const cat of Object.keys(groups)) emb.addFields({ name: "▸ " + cat, value: groups[cat].join(" "), inline: false });

    await interaction.reply({ embeds: [emb] });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("ping").setDescription("Ping."),
  async execute(interaction) {
    await interaction.reply({ embeds: [jarmEmbed(CONFIG.colors.ai).setTitle("🏓 Pong").setDescription("WS: **" + client.ws.ping + "ms**")] });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("hakkinda").setDescription("Jarm hakkinda."),
  async execute(interaction) {
    const uptime = Math.floor(process.uptime());

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.main)
          .setTitle("🛡️ Jarm Hakkinda")
          .setDescription("217i tarafindan gelistirilen gelismis Discord botu.")
          .addFields(
            { name: "Developer", value: "217i", inline: true },
            { name: "Sunucu", value: String(client.guilds.cache.size), inline: true },
            { name: "Uptime", value: Math.floor(uptime / 3600) + "s " + Math.floor((uptime % 3600) / 60) + "d", inline: true },
            { name: "Ses", value: voice.channelId ? "🟢 Bagli" : "⚪ Yok", inline: true }
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
    const owner = await guild.fetchOwner().catch(function () { return null; });

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.gold)
          .setTitle("🏰 " + guild.name)
          .setThumbnail(guild.iconURL({ size: 512 }) || client.user.displayAvatarURL())
          .addFields(
            { name: "Sahip", value: owner ? "" + owner : "-", inline: true },
            { name: "Uye", value: String(guild.memberCount), inline: true },
            { name: "Kanal", value: String(guild.channels.cache.size), inline: true },
            { name: "Rol", value: String(guild.roles.cache.size), inline: true },
            { name: "Kurulus", value: "<t:" + Math.floor(guild.createdTimestamp / 1000) + ":F>", inline: false }
          )
      ]
    });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("kullanici-bilgi").setDescription("Kullanici bilgisi.").addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici"); }),
  async execute(interaction) {
    const member = interaction.options.getMember("kullanici") || interaction.member;
    const user = member.user;

    const roles = member.roles.cache
      .filter(function (r) { return r.id !== interaction.guild.id; })
      .sort(function (a, b) { return b.position - a.position; })
      .map(function (r) { return "" + r; })
      .slice(0, 15)
      .join(" ") || "Yok";

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.purple)
          .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
          .setThumbnail(user.displayAvatarURL({ size: 512 }))
          .addFields(
            { name: "ID", value: "`" + user.id + "`", inline: true },
            { name: "Hesap", value: "<t:" + Math.floor(user.createdTimestamp / 1000) + ":R>", inline: true },
            { name: "Katilim", value: member.joinedTimestamp ? "<t:" + Math.floor(member.joinedTimestamp / 1000) + ":R>" : "-", inline: true },
            { name: "Roller", value: roles, inline: false }
          )
      ]
    });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("avatar").setDescription("Avatar.").addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici"); }),
  async execute(interaction) {
    const user = interaction.options.getUser("kullanici") || interaction.user;
    const url = user.displayAvatarURL({ size: 1024 });

    await interaction.reply({
      embeds: [baseEmbed(CONFIG.colors.main).setTitle("🖼️ " + user.username).setImage(url)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Ac").setURL(url).setStyle(ButtonStyle.Link))]
    });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder().setName("banner").setDescription("Banner.").addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici"); }),
  async execute(interaction) {
    const targetUser = interaction.options.getUser("kullanici");
    const fetchId = targetUser ? targetUser.id : interaction.user.id;
    const user = await client.users.fetch(fetchId, { force: true });
    const url = user.bannerURL({ size: 1024 });

    if (!url) return interaction.reply({ embeds: [infoEmbed("Banner yok.")], flags: MessageFlags.Ephemeral });

    await interaction.reply({ embeds: [baseEmbed(CONFIG.colors.purple).setTitle("🎇 " + user.username).setImage(url)] });
  }
});

commands.push({
  category: "Genel",
  data: new SlashCommandBuilder()
    .setName("embed-yaz")
    .setDescription("Embed olustur.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(function (o) { return o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText); }),
  async execute(interaction) {
    if (!hasPerm(interaction, [PermissionFlagsBits.ManageMessages])) return deny(interaction, "Yetki yok.");

    const channel = interaction.options.getChannel("kanal") || interaction.channel;

    const modal = new ModalBuilder().setCustomId("embed_modal:" + channel.id).setTitle("Embed Olusturucu");

    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("title").setLabel("Baslik").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("desc").setLabel("Aciklama").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("color").setLabel("Renk #hex").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("button").setLabel("Buton: Etiket | https://...").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300))
    );

    await interaction.showModal(modal);
  }
});

commands.push({
  category: "Eglence",
  data: new SlashCommandBuilder().setName("yazitura").setDescription("Yazi tura."),
  async execute(interaction) {
    await interaction.reply({ embeds: [jarmEmbed(CONFIG.colors.gold).setTitle("🪙 Yazi Tura").setDescription("Sonuc: **" + (Math.random() < 0.5 ? "YAZI" : "TURA") + "**")] });
  }
});

commands.push({
  category: "Eglence",
  data: new SlashCommandBuilder().setName("zar").setDescription("Zar.").addIntegerOption(function (o) { return o.setName("yuz").setDescription("Yuz").setMinValue(2).setMaxValue(1000); }),
  async execute(interaction) {
    const sides = interaction.options.getInteger("yuz") || 6;
    await interaction.reply({ embeds: [jarmEmbed(CONFIG.colors.main).setTitle("🎲 Zar").setDescription("d" + sides + ": **" + randomInt(1, sides) + "**")] });
  }
});

commands.push({
  category: "Eglence",
  data: new SlashCommandBuilder()
    .setName("ship")
    .setDescription("Ship.")
    .addUserOption(function (o) { return o.setName("kisi1").setDescription("1").setRequired(true); })
    .addUserOption(function (o) { return o.setName("kisi2").setDescription("2").setRequired(true); }),
  async execute(interaction) {
    const a = interaction.options.getUser("kisi1");
    const b = interaction.options.getUser("kisi2");
    const hash = crypto.createHash("md5").update(a.id + b.id).digest();
    const percent = hash.readUInt16BE(0) % 101;

    await interaction.reply({ embeds: [jarmEmbed(CONFIG.colors.pink).setTitle("💘 Ship").setDescription(a + " ❤️ " + b + "\n" + progressBar(percent, 100) + " %" + percent)] });
  }
});

commands.push({
  category: "Araclar",
  data: new SlashCommandBuilder().setName("matematik").setDescription("Hesap.").addStringOption(function (o) { return o.setName("islem").setDescription("Islem").setRequired(true); }),
  async execute(interaction) {
    try {
      const expr = interaction.options.getString("islem");
      await interaction.reply({ embeds: [jarmEmbed(CONFIG.colors.ai).setTitle("🧮 Matematik").setDescription("`" + expr + " = " + calcExpression(expr) + "`")] });
    } catch (e) {
      await interaction.reply({ embeds: [errEmbed("Gecersiz islem.")] });
    }
  }
});

commands.push({
  category: "Araclar",
  data: new SlashCommandBuilder().setName("sifre").setDescription("Sifre uret.").addIntegerOption(function (o) { return o.setName("uzunluk").setDescription("8-64").setMinValue(8).setMaxValue(64); }),
  async execute(interaction) {
    const length = interaction.options.getInteger("uzunluk") || 16;
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
    const bytes = crypto.randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];

    await interaction.reply({ embeds: [jarmEmbed(CONFIG.colors.green).setTitle("🔐 Sifre").setDescription("`" + out + "`")], flags: MessageFlags.Ephemeral });
  }
});

commands.push({
  category: "Araclar",
  data: new SlashCommandBuilder()
    .setName("hatirlat")
    .setDescription("Hatirlatici.")
    .addIntegerOption(function (o) { return o.setName("dakika").setDescription("Dakika").setRequired(true).setMinValue(1).setMaxValue(10080); })
    .addStringOption(function (o) { return o.setName("metin").setDescription("Metin").setRequired(true).setMaxLength(500); }),
  async execute(interaction) {
    const minutes = interaction.options.getInteger("dakika");
    const text = interaction.options.getString("metin");

    db.push("reminders", { userId: interaction.user.id, time: Date.now() + minutes * 60000, text: text });

    await interaction.reply({ embeds: [okEmbed(minutes + " dk sonra: " + cleanText(text, 200))], flags: MessageFlags.Ephemeral });
  }
});

commands.push({
  category: "Araclar",
  data: new SlashCommandBuilder().setName("afk").setDescription("AFK ol.").addStringOption(function (o) { return o.setName("sebep").setDescription("Sebep").setMaxLength(200); }),
  async execute(interaction) {
    const reason = interaction.options.getString("sebep") || "Belirtilmedi";
    db.set("afk_" + interaction.guild.id + "_" + interaction.user.id, { reason: reason, since: Date.now() });
    await interaction.reply({ embeds: [okEmbed("AFK: " + cleanText(reason, 150))] });
  }
});

const snipes = new Map();

commands.push({
  category: "Araclar",
  data: new SlashCommandBuilder().setName("snipe").setDescription("Silinen son mesaj."),
  async execute(interaction) {
    const data = snipes.get(interaction.channel.id);
    if (!data) return interaction.reply({ embeds: [infoEmbed("Silinen mesaj yok.")] });

    await interaction.reply({
      embeds: [jarmEmbed(CONFIG.colors.purple).setTitle("🕵️ Snipe").setDescription("**" + data.author + ":** " + cleanText(data.content || "Icerik yok", 1000))]
    });
  }
});

commands.push({
  category: "Araclar",
  data: new SlashCommandBuilder().setName("profil").setDescription("Profil karti.").addUserOption(function (o) { return o.setName("kullanici").setDescription("Kullanici"); }),
  async execute(interaction) {
    const member = interaction.options.getMember("kullanici") || interaction.member;
    const user = member.user;
    const xp = getXp(interaction.guild.id, user.id);
    const bom = getBom(interaction.guild.id, user.id);
    const warnings = getRecords(interaction.guild.id, user.id).filter(function (r) { return r.type === "WARN"; }).length;

    const badges = [];
    if (user.bot) badges.push("🤖");
    if (CONFIG.owners.indexOf(user.id) !== -1) badges.push("👑");
    if (warnings === 0) badges.push("😇");
    if (xp.level >= 10) badges.push("🏆");
    if (bom.balance >= 1000) badges.push("💰");

    await interaction.reply({
      embeds: [
        jarmEmbed(CONFIG.colors.purple)
          .setAuthor({ name: user.username + " Profil", iconURL: user.displayAvatarURL() })
          .setThumbnail(user.displayAvatarURL({ size: 512 }))
          .addFields(
            { name: "Level", value: String(xp.level), inline: true },
            { name: "Bom", value: String(bom.balance), inline: true },
            { name: "Uyari", value: String(warnings), inline: true },
            { name: "Rozet", value: badges.join(" ") || "-", inline: false }
          )
      ]
    });
  }
});

for (const cmd of commands) {
  client.commands.set(cmd.data.name, cmd);
}

/* ================= INTERACTION HANDLER ================= */

const PROCESSED_INTERACTIONS = new Set();

setInterval(function () {
  if (PROCESSED_INTERACTIONS.size > 3000) PROCESSED_INTERACTIONS.clear();
}, 60000);

client.on("interactionCreate", async function (interaction) {
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
      if (interaction.customId.indexOf("ticket_modal:") === 0) {
        await createTicket(interaction);
        return;
      }

      if (interaction.customId === "register_modal") {
        const name = interaction.fields.getTextInputValue("name").trim();
        const age = Number(interaction.fields.getTextInputValue("age").trim());

        if (!name || !Number.isInteger(age) || age < 8 || age > 99) {
          return interaction.reply({ embeds: [errEmbed("Isim/yas gecersiz.")], flags: MessageFlags.Ephemeral });
        }

        db.set("register_pending_" + interaction.guild.id + "_" + interaction.user.id, { name: name, age: age });

        return interaction.reply({
          embeds: [jarmEmbed(CONFIG.colors.success).setTitle("📝 Form Alindi").setDescription("Isim: " + name + "\nYas: " + age + "\nCinsiyet sec:")],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId("register_male").setLabel("Erkek").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId("register_female").setLabel("Kadin").setStyle(ButtonStyle.Secondary)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.customId.indexOf("embed_modal:") === 0) {
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
        emb.setFooter({ text: interaction.user.username + " gonderdi", iconURL: interaction.user.displayAvatarURL() });

        const components = [];
        if (buttonRaw && buttonRaw.indexOf("|") !== -1) {
          const parts = buttonRaw.split("|");
          const label = (parts[0] || "").trim();
          const url = (parts[1] || "").trim();
          if (label && /^https?:\/\//i.test(url)) {
            components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(label.slice(0, 80)).setURL(url).setStyle(ButtonStyle.Link)));
          }
        }

        await channel.send({ embeds: [emb], components: components });
        return interaction.reply({ embeds: [okEmbed("Embed gonderildi.")], flags: MessageFlags.Ephemeral });
      }
    }

    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id.indexOf("ticket_cat:") === 0) {
        await showTicketModal(interaction, id.split(":")[1]);
        return;
      }

      if (id === "ticket_claim") {
        const meta = db.get("ticket_" + interaction.channel.id, null);
        if (!meta) return deny(interaction, "Ticket kanali degil.");

        const staffId = db.get("ticket_staff_" + interaction.guild.id, null);
        const isStaff = (staffId && interaction.member.roles.cache.has(staffId)) || hasPerm(interaction, [PermissionFlagsBits.ManageMessages]);
        if (!isStaff) return deny(interaction, "Sadece destek ekibi ustlenebilir.");
        if (meta.claimed) return deny(interaction, "Zaten ustlenilmis.");

        meta.claimed = interaction.user.id;
        db.set("ticket_" + interaction.channel.id, meta);

        return interaction.update({ embeds: [ticketEmbed(meta)], components: ticketComponents(meta) });
      }

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
        const data = db.get("register_pending_" + interaction.guild.id + "_" + interaction.user.id, null);
        if (!data) {
          return interaction.update({ embeds: [errEmbed("Form bulunamadi, tekrar doldur.")], components: [] });
        }

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(function () { return null; });
        if (!member) return;

        try {
          const nick = await applyRegistration(interaction.guild, member, data, id === "register_male" ? "male" : "female", null);
          await interaction.update({
            embeds: [jarmEmbed(CONFIG.colors.success).setTitle("🎉 Kayit Basarili").setDescription("Hos geldin **" + nick + "**")],
            components: []
          });
        } catch (e) {
          await interaction.update({ embeds: [errEmbed(e.message)], components: [] });
        }
        return;
      }
    }
  } catch (e) {
    console.error("[INTERACTION ERROR]", e);

    const payload = { embeds: [errEmbed("Hata olustu, loglandi.")], flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(function () {});
    else await interaction.reply(payload).catch(function () {});
  }
});

/* ================= EVENTS ================= */

client.on("messageCreate", async function (message) {
  try {
    if (!message.guild || message.author.bot) return;

    const afk = db.get("afk_" + message.guild.id + "_" + message.author.id, null);
    if (afk) {
      db.delete("afk_" + message.guild.id + "_" + message.author.id);
      await message.reply({ embeds: [okEmbed("AFK'dan ciktin: " + cleanText(afk.reason, 120))] }).catch(function () {});
    }

    for (const user of message.mentions.users.values()) {
      const userAfk = db.get("afk_" + message.guild.id + "_" + user.id, null);
      if (userAfk) {
        await message.reply({ embeds: [infoEmbed("🛌 " + user + " AFK: " + cleanText(userAfk.reason, 120))] }).catch(function () {});
      }
    }

    const blocked = await runAutomod(message);
    if (blocked) return;

    const aiChannels = db.get("ai_channels_" + message.guild.id, []);
    const mentioned = message.mentions.users.has(client.user.id);

    if (mentioned || aiChannels.indexOf(message.channel.id) !== -1) {
      const question = message.content.replace(new RegExp("<@!?" + client.user.id + ">", "g"), "").trim();
      if (question) {
        await answerAiMessage(message, question);
        return;
      }
    }

    await giveXp(message);
  } catch (e) {
    console.error("[MESSAGE ERROR]", e);
  }
});

client.on("messageDelete", function (message) {
  if (!message.guild) return;
  if (message.author && message.author.bot) return;
  snipes.set(message.channel.id, { author: message.author.tag, content: message.content || "", time: Date.now() });
});

client.on("guildMemberAdd", async function (member) {
  try {
    const guild = member.guild;

    const roleCfg = db.get("otorole_" + guild.id, null);
    if (roleCfg) {
      const roleId = member.user.bot ? roleCfg.bot : roleCfg.member;
      if (roleId && guild.roles.cache.has(roleId)) await member.roles.add(roleId, "Jarm otorol").catch(function () {});
    }

    const guard = getGuard(guild.id);
    if (guard.enabled && guard.antiRaid) {
      const joins = (joinTracker.get(guild.id) || []).filter(function (t) { return Date.now() - t < 10000; });
      joins.push(Date.now());
      joinTracker.set(guild.id, joins);

      if (joins.length >= 8) {
        await guardLog(guild, jarmEmbed(CONFIG.colors.guard).setTitle("🚨 Raid suphesi").setDescription(joins.length + " hizli giris."));
        await member.timeout(10 * 60000, "Jarm anti-raid").catch(function () {});
      }
    }

    const counter = db.get("counter_" + guild.id, null);
    if (counter && guild.channels.cache.has(counter.channel)) {
      await guild.channels.cache.get(counter.channel).send({
        embeds: [baseEmbed(CONFIG.colors.success).setDescription("🎉 " + member.user.tag + " katildi • **" + guild.memberCount + "/" + counter.target + "**")]
      }).catch(function () {});
    }

    const welcomeId = db.get("welcome_" + guild.id, null);
    if (welcomeId && guild.channels.cache.has(welcomeId)) {
      await guild.channels.cache.get(welcomeId).send({
        embeds: [
          jarmEmbed(CONFIG.colors.success)
            .setTitle("👋 Hos Geldin")
            .setDescription(member + " katildi • " + guild.memberCount + " uye")
            .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
        ],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("register_start").setLabel("Kayit Ol").setStyle(ButtonStyle.Success))]
      }).catch(function () {});
    }

    const logId = db.get("welcomelog_" + guild.id, null);
    if (logId && guild.channels.cache.has(logId)) {
      await guild.channels.cache.get(logId).send({
        embeds: [baseEmbed(CONFIG.colors.green).setTitle("➡️ Giris").setDescription(member + " • " + guild.memberCount + " uye")]
      }).catch(function () {});
    }
  } catch (e) {
    console.error("[MEMBER ADD ERROR]", e);
  }
});

client.on("guildMemberRemove", async function (member) {
  try {
    const guild = member.guild;

    db.delete("register_pending_" + guild.id + "_" + member.id);
    db.delete("open_ticket_" + guild.id + "_" + member.id);

    const logId = db.get("welcomelog_" + guild.id, null);
    if (logId && guild.channels.cache.has(logId)) {
      await guild.channels.cache.get(logId).send({
        embeds: [baseEmbed(CONFIG.colors.error).setTitle("⬅️ Cikis").setDescription(member.user.tag + " ayrildi • " + guild.memberCount + " uye")]
      }).catch(function () {});
    }
  } catch (e) {
    console.error("[MEMBER REMOVE ERROR]", e);
  }
});

client.on("channelDelete", async function (channel) {
  try {
    if (!channel.guild) return;
    const cfg = getGuard(channel.guild.id);
    if (!cfg.enabled || !cfg.antiNuke) return;

    const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }).catch(function () { return null; });
    const executor = auditExecutor(logs);
    if (!executor) return;

    await registerGuardAction(channel.guild, executor.id, "channelDelete");
  } catch (e) {
    console.error("[GUARD channelDelete]", e);
  }
});

client.on("channelCreate", async function (channel) {
  try {
    if (!channel.guild) return;
    const cfg = getGuard(channel.guild.id);
    if (!cfg.enabled || !cfg.antiNuke) return;

    const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 1 }).catch(function () { return null; });
    const executor = auditExecutor(logs);
    if (!executor) return;

    await registerGuardAction(channel.guild, executor.id, "channelCreate");
  } catch (e) {
    console.error("[GUARD channelCreate]", e);
  }
});

client.on("roleDelete", async function (role) {
  try {
    const cfg = getGuard(role.guild.id);
    if (!cfg.enabled || !cfg.antiNuke) return;

    const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 }).catch(function () { return null; });
    const executor = auditExecutor(logs);
    if (!executor) return;

    await registerGuardAction(role.guild, executor.id, "roleDelete");
  } catch (e) {
    console.error("[GUARD roleDelete]", e);
  }
});

client.on("guildMemberUpdate", async function (oldMember, newMember) {
  try {
    const cfg = getGuard(newMember.guild.id);
    if (!cfg.enabled || !cfg.antiRole) return;

    const added = newMember.roles.cache.filter(function (r) { return !oldMember.roles.cache.has(r.id); });
    if (!added.size) return;

    const logs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 1 }).catch(function () { return null; });
    const executor = auditExecutor(logs);
    if (!executor) return;
    if (isGuardWhitelisted(newMember.guild, executor.id)) return;

    await newMember.roles.remove(added.map(function (r) { return r.id; }), "Jarm guard").catch(function () {});
    await registerGuardAction(newMember.guild, executor.id, "yetkisizRol");
  } catch (e) {
    console.error("[GUARD memberUpdate]", e);
  }
});

/* ================= REMINDERS ================= */

setInterval(async function () {
  try {
    const reminders = db.get("reminders", []);
    if (!Array.isArray(reminders) || !reminders.length) return;

    const due = reminders.filter(function (r) { return r.time <= Date.now(); });
    if (!due.length) return;

    db.set("reminders", reminders.filter(function (r) { return r.time > Date.now(); }));

    for (const item of due) {
      const user = await client.users.fetch(item.userId).catch(function () { return null; });
      if (!user) continue;
      await user.send({ embeds: [jarmEmbed(CONFIG.colors.warning).setTitle("⏰ Hatirlatma").setDescription(cleanText(item.text, 1000))] }).catch(function () {});
    }
  } catch (e) {
    console.error("[REMINDER ERROR]", e);
  }
}, 20000);

/* ================= READY ================= */

client.once("ready", async function () {
  console.log("[BOT] " + client.user.tag + " aktif.");

  updatePresence();
  setInterval(updatePresence, 300000);

  const body = client.commands.map(function (cmd) { return cmd.data.toJSON(); });
  const rest = new REST({ version: "10" }).setToken(CONFIG.token);

  try {
    if (CONFIG.devGuildId) {
      await rest.put(Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.devGuildId), { body: body });
      console.log("[COMMANDS] " + body.length + " komut test sunucusuna yuklendi.");
    } else {
      await rest.put(Routes.applicationCommands(CONFIG.clientId), { body: body });
      console.log("[COMMANDS] " + body.length + " komut globale yuklendi.");
    }
  } catch (e) {
    console.error("[DEPLOY ERROR]", e);
  }

  await setupVoice();
});

client.on("guildCreate", function () {
  updatePresence();
  if (!voice.channelId) setupVoice();
});

client.on("guildDelete", updatePresence);

/* ================= EXPRESS ================= */

const app = express();

app.get("/", function (req, res) {
  res.json({
    status: "online",
    bot: client.user ? client.user.tag : "starting",
    uptime: process.uptime(),
    guilds: client.guilds.cache.size,
    voice: voice.channelId ? "connected" : "none",
    ping: client.ws.ping
  });
});

app.get("/health", function (req, res) {
  res.json({ ok: true });
});

app.listen(CONFIG.port, function () {
  console.log("[WEB] Express " + CONFIG.port + " portunda.");
});

/* ================= ERRORS + LOGIN ================= */

process.on("unhandledRejection", function (err) { console.error("[UNHANDLED REJECTION]", err); });
process.on("uncaughtException", function (err) { console.error("[UNCAUGHT EXCEPTION]", err); });
process.on("warning", function (w) { console.warn("[WARNING]", w.message); });

client.login(CONFIG.token).catch(function (err) {
  console.error("[LOGIN ERROR]", err);
  process.exit(1);
});