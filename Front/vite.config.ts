import { defineConfig, Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Dev-only endpoint: the in-game dev panel POSTs tuning + layout here and we
// write them into src/config/*.json so tweaks become committed defaults.
function saveConfigPlugin(): Plugin {
  return {
    name: 'save-config',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
          try {
            const { tuning, layout } = JSON.parse(body);
            fs.writeFileSync(path.resolve('src/config/tuning.json'), JSON.stringify(tuning, null, 2) + '\n');
            fs.writeFileSync(path.resolve('src/config/layout.json'), JSON.stringify(layout, null, 2) + '\n');
            console.log('[save-config] wrote src/config/tuning.json + layout.json');
            res.end('ok');
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [saveConfigPlugin(), basicSsl()],
  server: {
    port: 5173,
    host: true,
    https: true
  },
  build: {
    target: 'es2020'
  }
});
