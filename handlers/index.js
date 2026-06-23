/**
 * Router principal de interacoes — delega para handlers especializados
 */
const { handleProductSelect, handleSupportTicketSelect, handlePaymentGatewaySelect, handleCouponModal, handleCartButtons, handleOrderButtons } = require("./sales");
const { handleTicketButtons } = require("./tickets");
const { handleVerification } = require("./verification");
const { handleAdminMenu, handleAdminButtons, handleAdminSelectMenus, handleAdminModals } = require("./admin");

// IDs de select menus do admin
const ADMIN_SELECT_IDS = ["invite_user_select", "coupon_menu", "coupon_product_select", "payment_menu", "back_to_payments", "product_menu"];

async function routeInteraction(interaction, config) {
  // === Slash Commands ===
  if (interaction.isChatInputCommand()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (command) await command.execute(interaction, config);
    return;
  }

  // === Autocomplete ===
  if (interaction.isAutocomplete()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (command?.autocomplete) await command.autocomplete(interaction, config);
    return;
  }

  // === Modal Submissions ===
  if (interaction.isModalSubmit()) {
    // Coupon modal (sales context)
    if (interaction.customId === "coupon_modal") {
      await handleCouponModal(interaction, config);
      return;
    }
    // Admin modals
    const handled = await handleAdminModals(interaction, config);
    if (handled) return;
  }

  // === Select Menus ===
  if (interaction.isStringSelectMenu()) {
    const { customId } = interaction;

    // Product purchase menus
    if (customId.startsWith("product_select_")) {
      await handleProductSelect(interaction, config);
      return;
    }

    // Support ticket
    if (customId === "support_ticket_select") {
      await handleSupportTicketSelect(interaction, config);
      return;
    }

    // Legacy payment gateway selection
    if (customId === "select_payment_gateway") {
      const selectedMethod = interaction.values?.[0]?.includes("card") ? "card" : "pix";
      await handlePaymentGatewaySelect(interaction, config, selectedMethod);
      return;
    }

    // Admin main menu
    if (customId === "admin_menu") {
      await handleAdminMenu(interaction, config);
      return;
    }

    // Admin sub-menus
    if (ADMIN_SELECT_IDS.includes(customId)) {
      await handleAdminSelectMenus(interaction, config);
      return;
    }
  }

  // === Buttons ===
  if (interaction.isButton()) {
    const { customId } = interaction;

    // Verification
    if (customId === "verify_button") {
      await handleVerification(interaction, config);
      return;
    }

    // Cart/Sales buttons
    const cartHandled = await handleCartButtons(interaction, config);
    if (cartHandled) return;

    // Order buttons
    const orderHandled = await handleOrderButtons(interaction, config);
    if (orderHandled) return;

    // Ticket buttons
    const ticketHandled = await handleTicketButtons(interaction, config);
    if (ticketHandled) return;

    // Admin buttons
    await handleAdminButtons(interaction, config);
  }
}

module.exports = { routeInteraction };
