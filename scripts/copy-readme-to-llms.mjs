import { copyFile, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
await mkdir(new URL("public/", root), { recursive: true });
await copyFile(new URL("README.md", root), new URL("public/llms.txt", root));
