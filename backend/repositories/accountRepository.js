import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDirectory, "accounts.json");

async function ensureStore() {
  await mkdir(dataDirectory, { recursive: true });
  try {
    await readFile(dataFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(dataFile, "[]", "utf8");
  }
}

async function readAccounts() {
  await ensureStore();
  return JSON.parse(await readFile(dataFile, "utf8"));
}

async function writeAccounts(accounts) {
  await ensureStore();
  await writeFile(dataFile, `${JSON.stringify(accounts, null, 2)}\n`, "utf8");
}

export const accountRepository = {
  async findAll() {
    return readAccounts();
  },

  async findByPlatform(platform) {
    const accounts = await readAccounts();
    return accounts.find((account) => account.platform === platform) ?? null;
  },

  async upsert(account) {
    const accounts = await readAccounts();
    const index = accounts.findIndex((item) => item.platform === account.platform);
    if (index === -1) accounts.push(account);
    else accounts[index] = account;
    await writeAccounts(accounts);
    return account;
  },

  async disconnect(platform) {
    const accounts = await readAccounts();
    const account = accounts.find((item) => item.platform === platform) ?? null;
    if (!account) return null;
    await writeAccounts(accounts.filter((item) => item.platform !== platform));
    return account;
  }
};

export function toPublicAccount(account) {
  if (!account) return null;
  return {
    platform: account.platform,
    connected: account.connected,
    accountName: account.accountName
  };
}
