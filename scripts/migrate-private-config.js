const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const publicPath = path.join(root, "config.json");
const privatePath = path.join(root, "config.private.json");
const publicConfig = JSON.parse(fs.readFileSync(publicPath, "utf8"));
const privateConfig = fs.existsSync(privatePath)
  ? JSON.parse(fs.readFileSync(privatePath, "utf8"))
  : { products: {} };
privateConfig.products ||= {};

let movedLinks = 0;
for (const product of publicConfig.products || []) {
  if (product.deliveryUrl) {
    privateConfig.products[product.id] = { deliveryUrl: product.deliveryUrl };
    delete product.deliveryUrl;
    movedLinks++;
  }
  if (product.initialStock === undefined) product.initialStock = Number(product.stock || 0);
  delete product.stock;
}

function atomicWrite(filePath, data) {
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, filePath);
}

atomicWrite(privatePath, privateConfig);
atomicWrite(publicPath, publicConfig);
console.log(`Migração concluída: ${movedLinks} link(s) movido(s) para config.private.json.`);