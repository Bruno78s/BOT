const { MessageFlags } = require("discord.js");

function normalizeInteractionOptions(options) {
  if (!options || typeof options !== "object" || !Object.prototype.hasOwnProperty.call(options, "ephemeral")) {
    return options;
  }

  const normalized = { ...options };
  const ephemeral = Boolean(normalized.ephemeral);
  delete normalized.ephemeral;

  if (ephemeral) {
    normalized.flags = normalized.flags ? normalized.flags | MessageFlags.Ephemeral : MessageFlags.Ephemeral;
  }

  return normalized;
}

function patchMethod(interaction, methodName) {
  if (typeof interaction[methodName] !== "function") return;
  if (interaction[methodName].__bznxPatched) return;

  const original = interaction[methodName].bind(interaction);
  const patched = (options, ...args) => original(normalizeInteractionOptions(options), ...args);
  patched.__bznxPatched = true;
  interaction[methodName] = patched;
}

function patchInteractionResponses(interaction) {
  patchMethod(interaction, "reply");
  patchMethod(interaction, "deferReply");
  patchMethod(interaction, "followUp");
  patchMethod(interaction, "editReply");
  patchMethod(interaction, "update");
}

module.exports = {
  normalizeInteractionOptions,
  patchInteractionResponses
};
