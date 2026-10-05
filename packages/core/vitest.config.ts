import { defineConfig } from "vitest/config";

export default defineConfig({ resolve: { conditions: ["keyring-source"] }, ssr: { resolve: { conditions: ["keyring-source"] } } });
