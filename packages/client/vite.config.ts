import { defineConfig } from 'vite';
// For GitHub Pages under https://<user>.github.io/<repo>/ set BASE=/<repo>/ when building.
export default defineConfig({ base: process.env.BASE ?? './', server: { host: true } });
