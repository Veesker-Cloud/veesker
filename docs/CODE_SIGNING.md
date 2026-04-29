# Code Signing — Veesker Windows installer

Status: ⏳ Aguardando validação de identidade no Azure Trusted Signing.

## Prerequisites

- Azure subscription com Trusted Signing Account `veesker-signing` (East US)
- Identity validation **completed** (não basta "Submitted")
- Certificate Profile criado dentro do account (próximo passo após validação)
- Service Principal ou login interativo com role **`Trusted Signing Certificate Profile Signer`**

## Setup local (depois da aprovação)

### 1. Instalar ferramentas

```powershell
winget install Microsoft.AzureCLI
az extension add --name trustedsigning
az login

# Trusted Signing usa o Sign Tool da Microsoft via dlib custom
# Veesker vai usar `azuresigntool` (compatível com Trusted Signing)
dotnet tool install --global AzureSignTool
```

### 2. Criar Certificate Profile (1x)

No portal Azure → Trusted Signing Account `veesker-signing`:
1. Sidebar → **Certificate profiles**
2. **+ Create**:
   - **Name:** `veesker-public-trust`
   - **Profile type:** **Public Trust** (para apps distribuídos publicamente)
   - **Identity validation:** seleciona a validação aprovada
3. Cria — leva ~1min

Anote os valores que vão aparecer no profile:
- **Account name:** `veesker-signing`
- **Profile name:** `veesker-public-trust`
- **Endpoint:** `https://eus.codesigning.azure.net/` (ou similar)

### 3. Service Principal para CI/build automatizado

```powershell
az ad sp create-for-rbac --name "veesker-sign-sp" --role "Trusted Signing Certificate Profile Signer" --scopes /subscriptions/<SUB-ID>/resourceGroups/veesker-rg/providers/Microsoft.CodeSigning/codeSigningAccounts/veesker-signing
```

Salvar o output com cuidado:
- `appId` → `AZURE_CLIENT_ID`
- `password` → `AZURE_CLIENT_SECRET`
- `tenant` → `AZURE_TENANT_ID`

Setar como variáveis de ambiente (User scope):
```powershell
[Environment]::SetEnvironmentVariable("AZURE_TENANT_ID", "<tenant>", "User")
[Environment]::SetEnvironmentVariable("AZURE_CLIENT_ID", "<appId>", "User")
[Environment]::SetEnvironmentVariable("AZURE_CLIENT_SECRET", "<password>", "User")
```

(Reabrir o terminal pra elas ficarem disponíveis.)

### 4. Atualizar `tauri.conf.json`

Adicionar `windows.signCommand` na seção `bundle`:

```jsonc
"bundle": {
  "active": true,
  "targets": "all",
  "externalBin": ["binaries/veesker-sidecar"],
  "windows": {
    "signCommand": {
      "cmd": "azuresigntool",
      "args": [
        "sign",
        "-kvu", "https://eus.codesigning.azure.net/",
        "-kvc", "veesker-public-trust",
        "-kvm",
        "-tr", "http://timestamp.acs.microsoft.com",
        "-td", "sha256",
        "-d", "Veesker — Oracle 23ai Studio",
        "-du", "https://github.com/veesker-cloud/veesker-community-edition",
        "{{file}}"
      ]
    }
  },
  "macOS": { "signingIdentity": "-" },
  "icon": [ ... ]
}
```

`{{file}}` é o placeholder Tauri que substitui pelo caminho do `.exe` durante o build.

`-kvu` (key vault URI), `-kvc` (cert profile name) — ajustar conforme region/profile real.

`-kvm` = managed identity (usa env vars `AZURE_*`).

### 5. Build assinado

```powershell
bun run tauri build
```

Tauri chama `azuresigntool sign ...` automaticamente após gerar o `.exe` e o `.msi`. O output deve incluir:
```
Successfully signed: <path>\Veesker_0.1.0_x64-setup.exe
```

### 6. Verificar assinatura

```powershell
signtool verify /pa /v "src-tauri\target\release\bundle\nsis\Veesker_0.1.0_x64-setup.exe"
```

Resultado esperado: certificate chain Microsoft Identity Verification CA.

### 7. SmartScreen reputation

Após a primeira distribuição:
- Os primeiros usuários ainda verão o warning (reputação zerada)
- A cada install/run sem report de malware, a reputação sobe
- Tipicamente 100-500 instalações + 2-4 semanas → SmartScreen libera silenciosamente

## Custos

- **Trusted Signing Basic:** US$9.99/mês (single subscription, 5000 signatures/mês)
- **Identity Validation:** grátis (1x)
- **Service Principal:** grátis

## Troubleshooting

| Erro | Causa | Fix |
|---|---|---|
| `azuresigntool: command not found` | dotnet tool não no PATH | Add `%USERPROFILE%\.dotnet\tools` ao PATH |
| `AADSTS700003` | Service Principal sem role | Re-run `az ad sp create-for-rbac` com `--role` correto |
| `Certificate profile not found` | Nome errado em `-kvc` | Confirmar no portal: nome exato do profile |
| `Identity validation not completed` | Validation ainda pendente | Esperar aprovação Microsoft |

## Refs

- [Trusted Signing docs](https://learn.microsoft.com/en-us/azure/trusted-signing/)
- [AzureSignTool](https://github.com/vcsjones/AzureSignTool)
- [Tauri 2 signing config](https://v2.tauri.app/distribute/sign/windows/)
