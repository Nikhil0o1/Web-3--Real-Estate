const fs = require("fs");
const path = require("path");

const OUT_PATH = path.resolve(__dirname, "..", "frontend", "runtime-config.js");
const CONTRACT_PATH = process.env.CONTRACT_ADDRESSES_PATH || path.resolve(__dirname, "..", "backend", "config", "contract-addresses.json");

const config = {
  API_BASE_URL: process.env.API_BASE_URL || process.env.BACKEND_URL || "",
  CHAIN_ID: Number(process.env.CHAIN_ID || 11155111),
  EXPECTED_CHAIN_HEX: process.env.EXPECTED_CHAIN_HEX || `0x${(Number(process.env.CHAIN_ID || 11155111)).toString(16)}`,
  EXPLORER_TX_BASE: process.env.EXPLORER_TX_BASE || "https://sepolia.etherscan.io/tx/",
  ENV: process.env.DEPLOY_ENV || process.env.NODE_ENV || "development",
  CONTRACT_ADDRESSES: {},
};

if (!config.API_BASE_URL && config.ENV !== "production") {
  config.API_BASE_URL = "http://127.0.0.1:8000";
}

if (fs.existsSync(CONTRACT_PATH)) {
  try {
    const raw = fs.readFileSync(CONTRACT_PATH, "utf8");
    config.CONTRACT_ADDRESSES = JSON.parse(raw);
  } catch (error) {
    console.warn(`Unable to read contract addresses from ${CONTRACT_PATH}:`, error.message);
  }
}

const contents = `window.__ESTATECHAIN_CONFIG__ = ${JSON.stringify(config, null, 2)};\n`;
fs.writeFileSync(OUT_PATH, contents, "utf8");
console.log(`Runtime config written to ${OUT_PATH}`);
