const { markMemberLeft } = require("../utils/invites");

module.exports = {
  name: "guildMemberRemove",
  async execute(member) {
    await markMemberLeft(member).catch((error) => {
      console.error("Erro ao registrar saída por invite:", error);
    });
  }
};
