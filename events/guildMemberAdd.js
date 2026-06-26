const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const path = require("path");
const { logSecurityEvent } = require("../utils/advancedLogger");
const { addInviteJoin, findUsedInvite, sendInviteJoinLog } = require("../utils/invites");

function getAccountAgeText(user) {
  const days = Math.floor((Date.now() - user.createdTimestamp) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "criada hoje";
  if (days === 1) return "criada há 1 dia";
  return `criada há ${days} dias`;
}

module.exports = {
  name: "guildMemberAdd",
  async execute(member, config) {
    const { welcomeChannelId, unverifiedRoleId, channelId } = config.verification;
    const usedInvite = await findUsedInvite(member.guild).catch(() => null);
    const inviteData = await addInviteJoin(member, usedInvite, config).catch((error) => {
      console.error("Erro ao registrar invite:", error);
      return null;
    });

    if (inviteData) {
      await sendInviteJoinLog(member, config, inviteData).catch((error) => {
        console.error("Erro ao enviar log de invite:", error);
      });
    }

    if (!unverifiedRoleId || !welcomeChannelId) return;

    try {
      const unverifiedRole = await member.guild.roles.fetch(unverifiedRoleId).catch(() => null);
      if (!unverifiedRole) {
        console.error(`Cargo não verificado não encontrado: ${unverifiedRoleId}`);
        return;
      }

      await member.roles.add(unverifiedRole);

      const welcomeChannel = await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
      if (!welcomeChannel?.isTextBased()) {
        console.error(`Canal de boas-vindas não encontrado: ${welcomeChannelId}`);
        return;
      }

      const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
      const bannerPath = path.join(__dirname, "..", "public", "banner-bznx.png");
      const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });
      const bannerAttachment = new AttachmentBuilder(bannerPath, { name: "banner.png" });
      const memberCount = member.guild.memberCount || member.guild.members.cache.size;

      const embed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setAuthor({
          name: `${config.botName} • Novo membro`,
          iconURL: member.user.displayAvatarURL({ size: 128 })
        })
        .setTitle(`👋 Bem-vindo(a), ${member.user.username}!`)
        .setDescription([
          `${member}, seja bem-vindo(a) à **${config.botName}**.`,
          "",
          "Para liberar seu acesso ao servidor, conclua a verificação no canal abaixo.",
          "",
          `✅ **Verificação:** <#${channelId}>`,
          `🛡️ **Cargo atual:** <@&${unverifiedRoleId}>`,
          `👥 **Você é o membro:** #${memberCount}`,
          `📅 **Conta Discord:** ${getAccountAgeText(member.user)}`,
          "",
          "Após a aprovação, os canais de produtos, suporte e atendimento serão liberados automaticamente."
        ].join("\n"))
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setImage("attachment://banner.png")
        .setFooter({
          text: `${config.botName} • Boas-vindas`,
          iconURL: "attachment://logo.png"
        })
        .setTimestamp();

      await welcomeChannel.send({
        content: `${member.user}`,
        embeds: [embed],
        files: [logoAttachment, bannerAttachment]
      });

      await logSecurityEvent(
        member.client,
        config,
        "Novo Membro Entrou",
        member.id,
        {
          description: `Usuário ${member.user.tag} entrou no servidor e recebeu cargo não verificado.`,
          fields: [
            { name: "Usuário", value: `${member.user.tag} (${member.id})`, inline: true },
            { name: "Cargo", value: `<@&${unverifiedRoleId}>`, inline: true },
            { name: "Conta criada em", value: member.user.createdAt.toLocaleDateString("pt-BR"), inline: true },
            { name: "Invite", value: inviteData?.inviteCode || "não identificado", inline: true }
          ]
        }
      );

      console.log(`Novo membro ${member.user.tag} recebeu cargo não verificado e foi direcionado para boas-vindas.`);
    } catch (error) {
      console.error("Erro ao processar novo membro:", error);
    }
  }
};
