# Prompt para Claude Code — Build macOS v0.2.2

Cole este texto inteiro no Claude Code do Mac:

---

**Contexto:** Veesker é um app Tauri 2 + SvelteKit 5 + sidecar Bun/TypeScript. O Claude Code no Windows já bumpeou a versão para 0.2.2 e está buildando o installer Windows. Sua tarefa é gerar o `.dmg` para macOS e adicionar ao release do GitHub.

**Pré-requisito — chave de signing do updater:**
A chave privada `veesker-updater.key` precisa estar disponível nesta máquina. Copie-a do Windows (`C:\Users\geefa\veesker-updater.key`) para `~/veesker-updater.key` antes de continuar. Peça ao usuário para fazer isso agora se ainda não fez.

**Passos a executar:**

1. **Pull da main** (pega o bump 0.2.1 → 0.2.2 já commitado):
   ```bash
   git pull origin main
   ```

2. **Compile o sidecar para macOS** (use o target correto para o Mac):
   ```bash
   cd sidecar
   # Apple Silicon (M1/M2/M3):
   bun run build:mac-arm64
   # Intel Mac:
   # bun run build:mac-x64
   cd ..
   ```

3. **Build do app** com signing do updater:
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY=~/veesker-updater.key
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="67Sgbs@Jesus"
   bun run tauri build
   ```
   O `.dmg` e o `.app` ficam em `src-tauri/target/release/bundle/dmg/` e `macos/`.

4. **Assinar o binário do updater** (se o tauri build não gerou o .sig automaticamente):
   ```bash
   # Apple Silicon:
   bun run tauri signer sign \
     -k ~/veesker-updater.key \
     -- src-tauri/target/release/bundle/macos/Veesker.app.tar.gz
   # O .sig será gerado no mesmo diretório
   ```

5. **Atualizar o latest.json** para adicionar a plataforma macOS:
   - Abra `src-tauri/target/release/bundle/latest.json`
   - Adicione a entrada `darwin-aarch64` (ou `darwin-x86_64` se Intel) dentro de `"platforms"`:
     ```json
     "darwin-aarch64": {
       "signature": "<conteúdo do .sig gerado>",
       "url": "https://github.com/gevianajr/veesker/releases/download/v0.2.2/Veesker_0.2.2_aarch64.dmg"
     }
     ```
   - O `latest.json` final deve ter **ambas** as plataformas: `windows-x86_64` e `darwin-aarch64`.

6. **Upload para o GitHub Release v0.2.2:**
   ```bash
   # Upload do DMG
   gh release upload v0.2.2 \
     "src-tauri/target/release/bundle/dmg/Veesker_0.2.2_aarch64.dmg" \
     --clobber

   # Upload do .sig do .app.tar.gz
   gh release upload v0.2.2 \
     "src-tauri/target/release/bundle/macos/Veesker.app.tar.gz.sig" \
     --clobber

   # Atualizar o latest.json no release
   gh release upload v0.2.2 latest.json --clobber
   ```
   (copie o `latest.json` final para a raiz do projeto antes do upload, ou ajuste o path)

**Importante:**
- O `latest.json` que sobe para o GitHub deve conter as entradas de **todas** as plataformas já publicadas (Windows foi publicado pelo Claude Code no Windows). Baixe o latest.json atual do release v0.2.2 antes de adicionar a entrada macOS, para não sobrescrever a entrada Windows.
- Não commite o `latest.json` gerado — ele fica só no GitHub Release.
- Não adicione `Co-Authored-By` em nenhum commit.
- O release v0.2.2 no GitHub já deve ter sido criado pelo Claude Code do Windows. Se ainda não existir, crie com: `gh release create v0.2.2 --title "v0.2.2" --notes "Auto-update test release"`
