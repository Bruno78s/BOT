const { AttachmentBuilder, EmbedBuilder } = require("discord.js");
const path = require("path");

function buildBoosterFiles() {
  const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
  return [new AttachmentBuilder(logoPath, { name: "logo.png" })];
}

function buildBoosterEmbed({ config, guild, member, boosterRoleId, type }) {
  const joined = type === "joined";
  const boostCount = guild.premiumSubscriptionCount || 0;
  const boostLevel = guild.premiumTier || 0;

  return new EmbedBuilder()
    .setColor(joined ? 0xf472b6 : 0xf59e0b)
    .setAuthor({ name: `${config.botName} | Boosters`, iconURL: "attachment://logo.png" })
    .setTitle(joined ? "Impulso recebido" : "Impulso encerrado")
    .setDescription(joined
      ? [
          `> **${member.user.tag}** impulsionou o servidor.`,
          "> Obrigado por apoiar a comunidade e ajudar a BznX Store a crescer.",
          "",
          `Cargo aplicado: <@&${boosterRoleId}>`
        ].join("\n")
      : [
          `> **${member.user.tag}** não está mais impulsionando o servidor.`,
          "> O apoio anterior continua registrado com carinho pela equipe.",
          "",
          `Cargo removido: <@&${boosterRoleId}>`
        ].join("\n")
    )
    .addFields(
      { name: "Membro", value: `<@${member.id}>`, inline: true },
      { name: "Boosts ativos", value: `${boostCount}`, inline: true },
      { name: "Nível do servidor", value: `${boostLevel}`, inline: true }
    )
    .setThumbnail("attachment://logo.png")
    .setFooter({ text: `${config.botName} • Sistema de boosters` })
    .setTimestamp();
}

module.exports = {
  name: "guildMemberUpdate",
  once: false,
  async execute(oldMember, newMember, config) {
    if (!oldMember || !newMember || oldMember.user?.bot) return;

    const boosterConfig = config.booster || {};
    const announceChannelId = boosterConfig.announceChannelId || process.env.BOOST_ANNOUNCE_CHANNEL_ID;
    const boosterRoleId = boosterConfig.roleId || process.env.BOOSTER_ROLE_ID;
    if (!announceChannelId || !boosterRoleId) return;

    const becameBooster = !oldMember.premiumSince && newMember.premiumSince;
    const stoppedBoosting = oldMember.premiumSince && !newMember.premiumSince;
    if (!becameBooster && !stoppedBoosting) return;

    const guild = newMember.guild;
    const announceChannel = await guild.channels.fetch(announceChannelId).catch(() => null);
    const member = await guild.members.fetch(newMember.id).catch(() => null);
    if (!announceChannel?.send || !member) return;

    if (becameBooster) {
      try {
        if (!member.roles.cache.has(boosterRoleId)) {
          await member.roles.add(boosterRoleId);
        }
      } catch (err) {
        console.error("[BOOSTER] Falha ao atribuir cargo de booster:", err.message);
      }

      await announceChannel.send({
        embeds: [buildBoosterEmbed({ config, guild, member, boosterRoleId, type: "joined" })],
        files: buildBoosterFiles()
      }).catch(() => null);
    }

    if (stoppedBoosting) {
      try {
        if (member.roles.cache.has(boosterRoleId)) {
          await member.roles.remove(boosterRoleId);
        }
      } catch (err) {
        console.error("[BOOSTER] Falha ao remover cargo de booster:", err.message);
      }

      await announceChannel.send({
        embeds: [buildBoosterEmbed({ config, guild, member, boosterRoleId, type: "left" })],
        files: buildBoosterFiles()
      }).catch(() => null);
    }
  }
};
