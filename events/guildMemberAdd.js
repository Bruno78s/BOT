const { EmbedBuilder } = require("discord.js");
const { AttachmentBuilder } = require("discord.js");
const path = require("path");
const { logSecurityEvent } = require("../utils/advancedLogger");
const { addInviteJoin, findUsedInvite, sendInviteJoinLog } = require("../utils/invites");

module.exports = {
  name: "guildMemberAdd",
  async execute(member, config) {
    const { welcomeChannelId, unverifiedRoleId } = config.verification;
    const usedInvite = await findUsedInvite(member.guild).catch(() => null);
    const inviteData = await addInviteJoin(member, usedInvite).catch((error) => {
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
      if (!welcomeChannel || !welcomeChannel.isTextBased()) {
        console.error(`Canal de boas vindas não encontrado: ${welcomeChannelId}`);
        return;
      }

      const logoPath = path.join(__dirname, "..", "public", "LOGO2.png");
      const logoAttachment = new AttachmentBuilder(logoPath, { name: "logo.png" });

      const embed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle(`${config.botName} | Novo Membro`)
        .setDescription([
          `### Bem-vindo, ${member.user}!`,
          "",
          `**Cargo atribuído:** <@&${unverifiedRoleId}>`,
          "",
          "👉 Vá ao canal <#1483134596274196490> para iniciar o processo de verificação."
        ].join("\n"))
        .setThumbnail("attachment://logo.png")
        .setFooter({ 
          text: "Bzn X • Boas Vindas", 
          iconURL: "attachment://logo.png"
        })
        .setTimestamp();

      await welcomeChannel.send({ 
        content: `${member.user}`,
        embeds: [embed],
        files: [logoAttachment]
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
            { name: "Conta criada em", value: member.user.createdAt.toLocaleDateString('pt-BR'), inline: true }
          ]
        }
      );

      console.log(`Novo membro ${member.user.tag} recebeu cargo não verificado e foi direcionado para boas vindas.`);
    } catch (error) {
      console.error("Erro ao processar novo membro:", error);
    }
  }
};
