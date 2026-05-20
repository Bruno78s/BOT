/**
 * Sistema de compressão de dados para reduzir bandwidth
 */

const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Comprime dados para envio
 */
async function compress(data) {
  try {
    const jsonString = JSON.stringify(data);
    const compressed = await gzip(Buffer.from(jsonString));
    return compressed.toString('base64');
  } catch (error) {
    console.error('[COMPRESSION] Erro ao comprimir:', error);
    return null;
  }
}

/**
 * Descomprime dados recebidos
 */
async function decompress(compressedData) {
  try {
    const buffer = Buffer.from(compressedData, 'base64');
    const decompressed = await gunzip(buffer);
    return JSON.parse(decompressed.toString());
  } catch (error) {
    console.error('[COMPRESSION] Erro ao descomprimir:', error);
    return null;
  }
}

/**
 * Comprime embeds grandes para reduzir tamanho
 */
function compressEmbed(embed) {
  // Limitar tamanho de descrições longas
  if (embed.description && embed.description.length > 4000) {
    embed.description = embed.description.substring(0, 3970) + '... [truncado]';
  }
  
  // Limitar número de fields
  if (embed.fields && embed.fields.length > 25) {
    embed.fields = embed.fields.slice(0, 24);
    embed.fields.push({
      name: '...',
      value: 'Dados adicionais omitidos',
      inline: false
    });
  }
  
  return embed;
}

/**
 * Otimiza imagens para reduzir tamanho
 */
function optimizeImageUrl(url, maxWidth = 800) {
  if (!url) return url;
  
  // Se for URL do Discord, adicionar parâmetros de tamanho
  if (url.includes('cdn.discordapp.com')) {
    return `${url}?width=${maxWidth}&quality=80`;
  }
  
  return url;
}

module.exports = {
  compress,
  decompress,
  compressEmbed,
  optimizeImageUrl
};
