const { markMemberLeft } = require("../utils/invites");

module.exports = {
  name: "guildMemberRemove",
  async execute(member, config) {
    await markMemberLeft(member, config).catch((error) => {
      console.error("Erro ao registrar saída por invite:", error);
    });
  }
};
