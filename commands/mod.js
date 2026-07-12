const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const {
  addModerationCase,
  addWarning,
  buildCaseFields,
  clearWarnings,
  createModerationEmbed,
  formatDuration,
  getCasesForUser,
  getWarnings,
  normalizeColor,
  parseDuration,
  requireModerationPermission,
  sendModerationLog,
  validateMemberTarget
} = require("../utils/moderation");

const SUBCOMMAND_ACTIONS = {
  unmute: "unmute",
  warn: "warn",
  warnings: "info",
  "clear-warnings": "warn",
  purge: "purge",
  "clear-user": "clearUser",
  lock: "lock",
  unlock: "unlock",
  slowmode: "slowmode",
  nick: "nick",
  addrole: "role",
  removerole: "role",
  userinfo: "info",
  serverinfo: "info",
  avatar: "info",
  roleinfo: "info",
  channelinfo: "info",
  say: "announce",
  embed: "announce",
  pin: "pin",
  unpin: "pin",
  "rename-channel": "lock",
  disconnect: "voice",
  move: "voice"
};

function addUserReason(command, description) {
  return command
    .addUserOption((option) => option.setName("usuario").setDescription(description).setRequired(true))
    .addStringOption((option) => option.setName("motivo").setDescription("Motivo da ação.").setMaxLength(900));
}

async function fetchMember(interaction, required = true) {
  const user = interaction.options.getUser("usuario", required);
  if (!user) return null;
  return interaction.guild.members.fetch(user.id).catch(() => null);
}

function compactDate(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}

async function finishModerationAction(interaction, config, data) {
  const caseItem = addModerationCase({
    guildId: interaction.guild.id,
    action: data.action,
    targetId: data.targetId,
    targetTag: data.targetTag,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason: data.reason
  });

  const embed = createModerationEmbed(config, {
    title: data.title,
    description: data.description,
    color: data.color || config.colors?.success,
    icon: data.icon || "🛡️",
    fields: buildCaseFields(caseItem, data.fields || [])
  });

  await interaction.editReply({ embeds: [embed] });
  await sendModerationLog(interaction, config, embed);
}

function addChannelOption(command, description, required = false) {
  return command.addChannelOption((option) =>
    option
      .setName("canal")
      .setDescription(description)
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildForum,
        ChannelType.PublicThread,
        ChannelType.PrivateThread
      )
      .setRequired(required)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mod")
    .setDescription("Central profissional de ferramentas de moderação.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((command) => addUserReason(command.setName("unmute").setDescription("Remove o mute/timeout de um membro."), "Membro que terá o mute removido."))
    .addSubcommand((command) => addUserReason(command.setName("warn").setDescription("Aplica um aviso interno em um membro."), "Membro que receberá o aviso."))
    .addSubcommand((command) => command.setName("warnings").setDescription("Lista os avisos internos de um membro.").addUserOption((option) => option.setName("usuario").setDescription("Membro consultado.").setRequired(true)))
    .addSubcommand((command) => command.setName("clear-warnings").setDescription("Remove todos os avisos internos de um membro.").addUserOption((option) => option.setName("usuario").setDescription("Membro que terá os avisos limpos.").setRequired(true)).addStringOption((option) => option.setName("motivo").setDescription("Motivo da limpeza.").setMaxLength(900)))
    .addSubcommand((command) => command.setName("purge").setDescription("Apaga mensagens recentes do canal.").addIntegerOption((option) => option.setName("quantidade").setDescription("Quantidade de mensagens, de 1 a 100.").setMinValue(1).setMaxValue(100).setRequired(true)).addUserOption((option) => option.setName("usuario").setDescription("Filtrar mensagens de um usuário específico.")))
    .addSubcommand((command) => command.setName("clear-user").setDescription("Apaga mensagens recentes de um usuário no canal atual.").addUserOption((option) => option.setName("usuario").setDescription("Usuário filtrado.").setRequired(true)).addIntegerOption((option) => option.setName("quantidade").setDescription("Quantidade máxima, de 1 a 100.").setMinValue(1).setMaxValue(100)))
    .addSubcommand((command) => addChannelOption(command.setName("lock").setDescription("Trava o envio de mensagens em um canal."), "Canal que será travado.", false).addStringOption((option) => option.setName("motivo").setDescription("Motivo da trava.").setMaxLength(900)))
    .addSubcommand((command) => addChannelOption(command.setName("unlock").setDescription("Libera o envio de mensagens em um canal."), "Canal que será liberado.", false).addStringOption((option) => option.setName("motivo").setDescription("Motivo da liberação.").setMaxLength(900)))
    .addSubcommand((command) => addChannelOption(command.setName("slowmode").setDescription("Define o modo lento de um canal."), "Canal afetado.", false).addIntegerOption((option) => option.setName("segundos").setDescription("Tempo em segundos, 0 a 21600.").setMinValue(0).setMaxValue(21600).setRequired(true)).addStringOption((option) => option.setName("motivo").setDescription("Motivo da alteração.").setMaxLength(900)))
    .addSubcommand((command) => command.setName("nick").setDescription("Altera o apelido de um membro.").addUserOption((option) => option.setName("usuario").setDescription("Membro alterado.").setRequired(true)).addStringOption((option) => option.setName("apelido").setDescription("Novo apelido. Use vazio para remover.").setMaxLength(32)).addStringOption((option) => option.setName("motivo").setDescription("Motivo da alteração.").setMaxLength(900)))
    .addSubcommand((command) => command.setName("addrole").setDescription("Adiciona um cargo a um membro.").addUserOption((option) => option.setName("usuario").setDescription("Membro que receberá o cargo.").setRequired(true)).addRoleOption((option) => option.setName("cargo").setDescription("Cargo adicionado.").setRequired(true)).addStringOption((option) => option.setName("motivo").setDescription("Motivo da alteração.").setMaxLength(900)))
    .addSubcommand((command) => command.setName("removerole").setDescription("Remove um cargo de um membro.").addUserOption((option) => option.setName("usuario").setDescription("Membro que perderá o cargo.").setRequired(true)).addRoleOption((option) => option.setName("cargo").setDescription("Cargo removido.").setRequired(true)).addStringOption((option) => option.setName("motivo").setDescription("Motivo da alteração.").setMaxLength(900)))
    .addSubcommand((command) => command.setName("userinfo").setDescription("Mostra informações de um membro.").addUserOption((option) => option.setName("usuario").setDescription("Membro consultado.")))
    .addSubcommand((command) => command.setName("serverinfo").setDescription("Mostra informações rápidas do servidor."))
    .addSubcommand((command) => command.setName("avatar").setDescription("Mostra o avatar de um usuário.").addUserOption((option) => option.setName("usuario").setDescription("Usuário consultado.")))
    .addSubcommand((command) => command.setName("roleinfo").setDescription("Mostra informações de um cargo.").addRoleOption((option) => option.setName("cargo").setDescription("Cargo consultado.").setRequired(true)))
    .addSubcommand((command) => addChannelOption(command.setName("channelinfo").setDescription("Mostra informações de um canal."), "Canal consultado.", false))
    .addSubcommand((command) => addChannelOption(command.setName("say").setDescription("Envia uma mensagem simples em um canal."), "Canal de destino.", true).addStringOption((option) => option.setName("mensagem").setDescription("Mensagem enviada pelo bot.").setRequired(true).setMaxLength(1800)))
    .addSubcommand((command) => addChannelOption(command.setName("embed").setDescription("Envia um embed rápido em um canal."), "Canal de destino.", true).addStringOption((option) => option.setName("titulo").setDescription("Título do embed.").setRequired(true).setMaxLength(220)).addStringOption((option) => option.setName("mensagem").setDescription("Texto do embed.").setRequired(true).setMaxLength(3000)).addStringOption((option) => option.setName("cor").setDescription("Cor HEX. Ex.: #1e88e5").setMaxLength(7)).addStringOption((option) => option.setName("imagem").setDescription("URL de imagem.").setMaxLength(500)))
    .addSubcommand((command) => addChannelOption(command.setName("pin").setDescription("Fixa uma mensagem pelo ID."), "Canal da mensagem.", false).addStringOption((option) => option.setName("mensagem_id").setDescription("ID da mensagem.").setRequired(true).setMinLength(15).setMaxLength(25)).addStringOption((option) => option.setName("motivo").setDescription("Motivo.").setMaxLength(900)))
    .addSubcommand((command) => addChannelOption(command.setName("unpin").setDescription("Remove o fixado de uma mensagem pelo ID."), "Canal da mensagem.", false).addStringOption((option) => option.setName("mensagem_id").setDescription("ID da mensagem.").setRequired(true).setMinLength(15).setMaxLength(25)).addStringOption((option) => option.setName("motivo").setDescription("Motivo.").setMaxLength(900)))
    .addSubcommand((command) => addChannelOption(command.setName("rename-channel").setDescription("Renomeia um canal."), "Canal alterado.", true).addStringOption((option) => option.setName("nome").setDescription("Novo nome do canal.").setRequired(true).setMinLength(1).setMaxLength(100)).addStringOption((option) => option.setName("motivo").setDescription("Motivo da alteração.").setMaxLength(900)))
    .addSubcommand((command) => addUserReason(command.setName("disconnect").setDescription("Desconecta um membro de um canal de voz."), "Membro desconectado."))
    .addSubcommand((command) => command.setName("move").setDescription("Move um membro para outro canal de voz.").addUserOption((option) => option.setName("usuario").setDescription("Membro movido.").setRequired(true)).addChannelOption((option) => option.setName("canal").setDescription("Canal de voz de destino.").addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(true)).addStringOption((option) => option.setName("motivo").setDescription("Motivo.").setMaxLength(900))),

  async execute(interaction, config) {
    const subcommand = interaction.options.getSubcommand();
    const action = SUBCOMMAND_ACTIONS[subcommand] || "info";
    if (!(await requireModerationPermission(interaction, action, config))) return;

    await interaction.deferReply({ ephemeral: true });

    if (subcommand === "unmute") {
      const member = await fetchMember(interaction);
      const reason = interaction.options.getString("motivo") || "Sem motivo informado.";
      if (!member) return interaction.editReply({ embeds: [createModerationEmbed(config, { title: "Membro não encontrado", description: "Esse usuário não está no servidor.", color: config.colors?.danger, icon: "⚠️" })] });
      const error = validateMemberTarget(interaction, member, "remover o mute de");
      if (error) return interaction.editReply({ embeds: [createModerationEmbed(config, { title: "Ação bloqueada", description: error, color: config.colors?.danger, icon: "⛔" })] });
      await member.timeout(null, `${reason} | Moderador: ${interaction.user.tag}`);
      return finishModerationAction(interaction, config, { action: "unmute", targetId: member.id, targetTag: member.user.tag, reason, title: "Mute removido", description: "O membro pode voltar a falar.", icon: "🔊" });
    }

    if (subcommand === "warn") {
      const member = await fetchMember(interaction);
      const reason = interaction.options.getString("motivo") || "Sem motivo informado.";
      if (!member) return interaction.editReply({ embeds: [createModerationEmbed(config, { title: "Membro não encontrado", description: "Esse usuário não está no servidor.", color: config.colors?.danger, icon: "⚠️" })] });
      const warning = { reason, moderatorId: interaction.user.id, createdAt: new Date().toISOString() };
      const list = addWarning(interaction.guild.id, member.id, warning);
      return finishModerationAction(interaction, config, {
        action: "warn",
        targetId: member.id,
        targetTag: member.user.tag,
        reason,
        title: "Aviso aplicado",
        description: "Aviso interno registrado para acompanhamento da equipe.",
        icon: "⚠️",
        color: config.colors?.warning,
        fields: [{ name: "📊 Avisos atuais", value: `${list.length}`, inline: true }]
      });
    }

    if (subcommand === "warnings") {
      const user = interaction.options.getUser("usuario", true);
      const warnings = getWarnings(interaction.guild.id, user.id);
      const cases = getCasesForUser(user.id, 8, interaction.guild.id);
      const warningText = warnings.length
        ? warnings.slice(-8).map((item, index) => `**${index + 1}.** ${item.reason} • <@${item.moderatorId}>`).join("\n")
        : "Nenhum aviso interno registrado.";
      const caseText = cases.length ? cases.map((item) => `\`${item.id}\` • ${item.action} • ${item.reason}`).join("\n") : "Nenhum caso recente.";
      return interaction.editReply({
        embeds: [createModerationEmbed(config, {
          title: "Histórico de moderação",
          description: `${user}`,
          icon: "📋",
          fields: [
            { name: "⚠️ Avisos", value: warningText.slice(0, 1024), inline: false },
            { name: "🗂️ Casos recentes", value: caseText.slice(0, 1024), inline: false }
          ]
        })]
      });
    }

    if (subcommand === "clear-warnings") {
      const user = interaction.options.getUser("usuario", true);
      const reason = interaction.options.getString("motivo") || "Limpeza manual de avisos.";
      clearWarnings(interaction.guild.id, user.id);
      return finishModerationAction(interaction, config, { action: "clear-warnings", targetId: user.id, targetTag: user.tag, reason, title: "Avisos limpos", description: "Todos os avisos internos desse usuário foram removidos.", icon: "🧹" });
    }

    if (subcommand === "purge" || subcommand === "clear-user") {
      if (!interaction.channel?.bulkDelete) {
        return interaction.editReply({ embeds: [createModerationEmbed(config, { title: "Canal incompatível", description: "Este canal não permite limpeza em massa.", color: config.colors?.danger, icon: "⚠️" })] });
      }
      const quantity = interaction.options.getInteger("quantidade") || 100;
      const user = interaction.options.getUser("usuario", subcommand === "clear-user");
      const messages = await interaction.channel.messages.fetch({ limit: Math.min(quantity, 100) });
      const filtered = user ? messages.filter((message) => message.author.id === user.id) : messages;
      const deleted = await interaction.channel.bulkDelete(filtered, true);
      return finishModerationAction(interaction, config, {
        action: subcommand,
        targetId: user?.id || interaction.channel.id,
        targetTag: user?.tag || `#${interaction.channel.name}`,
        reason: `Limpeza de ${deleted.size} mensagem(ns).`,
        title: "Mensagens limpas",
        description: `${deleted.size} mensagem(ns) removida(s). Mensagens com mais de 14 dias são ignoradas pelo Discord.`,
        icon: "🧹",
        fields: [{ name: "📍 Canal", value: `${interaction.channel}`, inline: true }]
      });
    }

    if (["lock", "unlock"].includes(subcommand)) {
      const channel = interaction.options.getChannel("canal") || interaction.channel;
      const reason = interaction.options.getString("motivo") || "Sem motivo informado.";
      const denySend = subcommand === "lock";
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: denySend ? false : null }, { reason });
      return finishModerationAction(interaction, config, {
        action: subcommand,
        targetId: channel.id,
        targetTag: `#${channel.name}`,
        reason,
        title: denySend ? "Canal travado" : "Canal liberado",
        description: denySend ? "O envio de mensagens foi bloqueado para @everyone." : "O envio de mensagens voltou ao padrão do canal.",
        icon: denySend ? "🔒" : "🔓",
        fields: [{ name: "📍 Canal", value: `${channel}`, inline: true }]
      });
    }

    if (subcommand === "slowmode") {
      const channel = interaction.options.getChannel("canal") || interaction.channel;
      const seconds = interaction.options.getInteger("segundos", true);
      const reason = interaction.options.getString("motivo") || "Sem motivo informado.";
      await channel.setRateLimitPerUser(seconds, reason);
      return finishModerationAction(interaction, config, {
        action: "slowmode",
        targetId: channel.id,
        targetTag: `#${channel.name}`,
        reason,
        title: "Modo lento atualizado",
        description: seconds > 0 ? `Modo lento definido para **${seconds}s**.` : "Modo lento removido.",
        icon: "⏳",
        fields: [{ name: "📍 Canal", value: `${channel}`, inline: true }]
      });
    }

    if (subcommand === "nick") {
      const member = await fetchMember(interaction);
      const nickname = interaction.options.getString("apelido") || null;
      const reason = interaction.options.getString("motivo") || "Sem motivo informado.";
      if (!member) return interaction.editReply({ embeds: [createModerationEmbed(config, { title: "Membro não encontrado", description: "Esse usuário não está no servidor.", color: config.colors?.danger, icon: "⚠️" })] });
      const error = validateMemberTarget(interaction, member, "alterar o apelido de");
      if (error) return interaction.editReply({ embeds: [createModerationEmbed(config, { title: "Ação bloqueada", description: error, color: config.colors?.danger, icon: "⛔" })] });
      await member.setNickname(nickname, `${reason} | Moderador: ${interaction.user.tag}`);
      return finishModerationAction(interaction, config, { action: "nick", targetId: member.id, targetTag: member.user.tag, reason, title: "Apelido atualizado", description: nickname ? `Novo apelido: **${nickname}**` : "Apelido removido.", icon: "🏷️" });
    }

    if (["addrole", "removerole"].includes(subcommand)) {
      const member = await fetchMember(interaction);
      const role = interaction.options.getRole("cargo", true);
      const reason = interaction.options.getString("motivo") || "Sem motivo informado.";
      if (!member) return interaction.editReply({ embeds: [createModerationEmbed(config, { title: "Membro não encontrado", description: "Esse usuário não está no servidor.", color: config.colors?.danger, icon: "⚠️" })] });
      const botRole = interaction.guild.members.me?.roles.highest;
      if ((botRole && role.position >= botRole.position) || (interaction.member.id !== interaction.guild.ownerId && role.position >= interaction.member.roles.highest.position)) {
        return interaction.editReply({ embeds: [createModerationEmbed(config, { title: "Cargo alto demais", description: "O cargo precisa ficar abaixo do meu cargo e do seu cargo mais alto.", color: config.colors?.danger, icon: "⛔" })] });
      }
      if (subcommand === "addrole") await member.roles.add(role, `${reason} | Moderador: ${interaction.user.tag}`);
      else await member.roles.remove(role, `${reason} | Moderador: ${interaction.user.tag}`);
      return finishModerationAction(interaction, config, {
        action: subcommand,
        targetId: member.id,
        targetTag: member.user.tag,
        reason,
        title: subcommand === "addrole" ? "Cargo adicionado" : "Cargo removido",
        description: `${role} ${subcommand === "addrole" ? "adicionado a" : "removido de"} ${member}.`,
        icon: "🎖️",
        fields: [{ name: "🎖️ Cargo", value: `${role}`, inline: true }]
      });
    }

    if (subcommand === "userinfo") {
      const user = interaction.options.getUser("usuario") || interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      return interaction.editReply({ embeds: [createModerationEmbed(config, {
        title: "Informações do usuário",
        description: `${user}`,
        icon: "👤",
        thumbnail: user.displayAvatarURL({ size: 256 }),
        fields: [
          { name: "🆔 ID", value: user.id, inline: true },
          { name: "📅 Conta criada", value: compactDate(user.createdAt), inline: true },
          { name: "📥 Entrou no servidor", value: member?.joinedAt ? compactDate(member.joinedAt) : "Não encontrado", inline: true },
          { name: "🎖️ Cargos", value: member?.roles.cache.filter((role) => role.id !== interaction.guild.id).map((role) => `${role}`).slice(0, 12).join(", ") || "Nenhum", inline: false }
        ]
      })] });
    }

    if (subcommand === "serverinfo") {
      const guild = interaction.guild;
      return interaction.editReply({ embeds: [createModerationEmbed(config, {
        title: "Informações do servidor",
        description: guild.name,
        icon: "🏰",
        thumbnail: guild.iconURL({ size: 256 }),
        fields: [
          { name: "🆔 ID", value: guild.id, inline: true },
          { name: "👥 Membros", value: `${guild.memberCount}`, inline: true },
          { name: "📅 Criado em", value: compactDate(guild.createdAt), inline: true },
          { name: "💬 Canais", value: `${guild.channels.cache.size}`, inline: true },
          { name: "🎖️ Cargos", value: `${guild.roles.cache.size}`, inline: true },
          { name: "🚀 Boosts", value: `${guild.premiumSubscriptionCount || 0}`, inline: true }
        ]
      })] });
    }

    if (subcommand === "avatar") {
      const user = interaction.options.getUser("usuario") || interaction.user;
      return interaction.editReply({ embeds: [createModerationEmbed(config, {
        title: "Avatar",
        description: `${user}`,
        icon: "🖼️",
        image: user.displayAvatarURL({ size: 1024 })
      })] });
    }

    if (subcommand === "roleinfo") {
      const role = interaction.options.getRole("cargo", true);
      return interaction.editReply({ embeds: [createModerationEmbed(config, {
        title: "Informações do cargo",
        description: `${role}`,
        icon: "🎖️",
        color: role.hexColor === "#000000" ? config.colors?.primary : role.hexColor,
        fields: [
          { name: "🆔 ID", value: role.id, inline: true },
          { name: "👥 Membros", value: `${role.members.size}`, inline: true },
          { name: "📅 Criado em", value: compactDate(role.createdAt), inline: true },
          { name: "📌 Posição", value: `${role.position}`, inline: true },
          { name: "🔐 Gerenciado", value: role.managed ? "Sim" : "Não", inline: true },
          { name: "🎨 Cor", value: role.hexColor, inline: true }
        ]
      })] });
    }

    if (subcommand === "channelinfo") {
      const channel = interaction.options.getChannel("canal") || interaction.channel;
      return interaction.editReply({ embeds: [createModerationEmbed(config, {
        title: "Informações do canal",
        description: `${channel}`,
        icon: "📍",
        fields: [
          { name: "🆔 ID", value: channel.id, inline: true },
          { name: "🏷️ Nome", value: channel.name || "Sem nome", inline: true },
          { name: "📅 Criado em", value: compactDate(channel.createdAt), inline: true },
          { name: "📦 Tipo", value: `${channel.type}`, inline: true },
          { name: "🔞 NSFW", value: channel.nsfw ? "Sim" : "Não", inline: true }
        ]
      })] });
    }

    if (subcommand === "say" || subcommand === "embed") {
      const channel = interaction.options.getChannel("canal", true);
      if (subcommand === "say") {
        const message = interaction.options.getString("mensagem", true);
        await channel.send({ content: message, allowedMentions: { parse: [] } });
      } else {
        const title = interaction.options.getString("titulo", true);
        const message = interaction.options.getString("mensagem", true);
        const color = normalizeColor(interaction.options.getString("cor"), config.colors?.primary);
        const image = interaction.options.getString("imagem");
        await channel.send({ embeds: [createModerationEmbed(config, { title, description: message, color, icon: "📣", image, footer: `${config.botName || "BznX Store"} • Comunicado` })] });
      }
      return finishModerationAction(interaction, config, {
        action: subcommand,
        targetId: channel.id,
        targetTag: `#${channel.name}`,
        reason: `Mensagem enviada em #${channel.name}`,
        title: "Mensagem enviada",
        description: `Conteúdo publicado em ${channel}.`,
        icon: "📣"
      });
    }

    if (subcommand === "pin" || subcommand === "unpin") {
      const channel = interaction.options.getChannel("canal") || interaction.channel;
      const messageId = interaction.options.getString("mensagem_id", true).replace(/\D/g, "");
      const reason = interaction.options.getString("motivo") || "Sem motivo informado.";
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) return interaction.editReply({ embeds: [createModerationEmbed(config, { title: "Mensagem não encontrada", description: "Não encontrei essa mensagem no canal informado.", color: config.colors?.danger, icon: "⚠️" })] });
      if (subcommand === "pin") await message.pin(reason);
      else await message.unpin(reason);
      return finishModerationAction(interaction, config, {
        action: subcommand,
        targetId: channel.id,
        targetTag: `#${channel.name}`,
        reason,
        title: subcommand === "pin" ? "Mensagem fixada" : "Mensagem desfixada",
        description: `[Abrir mensagem](${message.url})`,
        icon: "📌"
      });
    }

    if (subcommand === "rename-channel") {
      const channel = interaction.options.getChannel("canal", true);
      const name = interaction.options.getString("nome", true);
      const reason = interaction.options.getString("motivo") || "Sem motivo informado.";
      const oldName = channel.name;
      await channel.setName(name, `${reason} | Moderador: ${interaction.user.tag}`);
      return finishModerationAction(interaction, config, {
        action: "rename-channel",
        targetId: channel.id,
        targetTag: `#${oldName}`,
        reason,
        title: "Canal renomeado",
        description: `\`#${oldName}\` agora é ${channel}.`,
        icon: "🏷️"
      });
    }

    if (subcommand === "disconnect" || subcommand === "move") {
      const member = await fetchMember(interaction);
      const reason = interaction.options.getString("motivo") || "Sem motivo informado.";
      if (!member?.voice?.channel) {
        return interaction.editReply({ embeds: [createModerationEmbed(config, { title: "Usuário fora de voz", description: "Esse membro não está conectado em um canal de voz.", color: config.colors?.danger, icon: "🎧" })] });
      }
      if (subcommand === "disconnect") {
        await member.voice.disconnect(`${reason} | Moderador: ${interaction.user.tag}`);
      } else {
        const channel = interaction.options.getChannel("canal", true);
        await member.voice.setChannel(channel, `${reason} | Moderador: ${interaction.user.tag}`);
      }
      return finishModerationAction(interaction, config, {
        action: subcommand,
        targetId: member.id,
        targetTag: member.user.tag,
        reason,
        title: subcommand === "disconnect" ? "Membro desconectado" : "Membro movido",
        description: subcommand === "disconnect" ? `${member} foi desconectado da voz.` : `${member} foi movido para ${interaction.options.getChannel("canal", true)}.`,
        icon: "🎧"
      });
    }

    return interaction.editReply({
      embeds: [createModerationEmbed(config, {
        title: "Ferramenta indisponível",
        description: "Essa ação ainda não foi reconhecida pelo roteador de moderação.",
        color: config.colors?.danger,
        icon: "⚠️"
      })]
    });
  }
};
