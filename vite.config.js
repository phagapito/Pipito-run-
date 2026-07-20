import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Troque "pipito-run" pelo nome exato do seu repositório no GitHub.
  // Se o repositório for "usuario.github.io" (site principal), use base: "/".
  base: "/Pipito-run-/",

});
