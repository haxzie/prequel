// Seeds a local .env from .env.example on first install so `pnpm dev` works
// out of the box. Never overwrites an existing .env.
import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, ".env");
const example = resolve(root, ".env.example");

if (existsSync(target)) {
  process.exit(0);
}

if (!existsSync(example)) {
  console.warn("[setup-env] no .env.example found, skipping");
  process.exit(0);
}

copyFileSync(example, target);
console.log("[setup-env] created .env from .env.example");
