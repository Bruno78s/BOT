const { EmbedBuilder } = require("discord.js");

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
        embeds: [
          new EmbedBuilder()
            .setColor(0x00b4d8)
            .setTitle("🎉 Novo Booster")
            .setDescription([
              `> <@${member.id}> acabou de impulsionar o servidor!`,
              "> Cargo de booster atribuído automaticamente.",
              "",
              "> Obrigado pelo suporte!"
            ].join("\n"))
            .setFooter({ text: `${config.botName} • Booster`, iconURL: guild.client.user.displayAvatarURL() })
            .setTimestamp()
        ]
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
        embeds: [
          new EmbedBuilder()
            .setColor(0xffa000)
            .setTitle("🔻 Booster saiu")
            .setDescription([
              `> <@${member.id}> não está mais impulsionando o servidor.`,
              "> Cargo de booster removido automaticamente.",
              "",
              "> Obrigado pelo apoio anterior!"
            ].join("\n"))
            .setFooter({ text: `${config.botName} • Booster`, iconURL: guild.client.user.displayAvatarURL() })
            .setTimestamp()
        ]
      }).catch(() => null);
    }
  }
};
