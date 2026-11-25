# Agent quick install · 原话记忆

Use this guide only when a user asks to install `dsh-standalone-memory` into DeepSeek Harness. Reading this repository is not installation consent. This is a DSH profile plugin, not a standalone MCP server. No GitHub account, source checkout, npm registry installation or API key is required.

1. Confirm the target profile (for example `desktop`). Explain before installation: new workspaces default to local plaintext archiving of eligible user messages and visible assistant replies. Do not import old conversations, change recording settings, or restart a running host without the owner's permission.
2. On Windows with DSH installed, run the following in PowerShell **after substituting the confirmed profile**. Use the pinned release asset, not GitHub's source archive. Stop on any error; never bypass a hash mismatch or fall back to an unverified version.

```powershell
$ErrorActionPreference = 'Stop'
$profileName = '<confirmed-profile>'
if ($profileName -eq '<confirmed-profile>') { throw 'Choose the target DSH profile first.' }
$cli = (Get-Command dsh -CommandType Application | Select-Object -First 1).Source
if (!$cli) { throw 'Install DeepSeek Harness first.' }
$name = 'dsh-standalone-memory-0.11.3.tgz'
$url = "https://github.com/AnmotoShiika2026/dsh-standalone-memory/releases/download/v0.11.3/$name"
$dir = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()))
$file = Join-Path $dir.FullName $name
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $file
if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne '97f7e1ca1d3b5e0f2ecd15bc101b70e31b2503d6a5e2e00a44c89d0142bd08c5') { throw 'Release checksum mismatch; not installed.' }
& $cli plugin --profile $profileName add --offline --ignore-scripts $file
if ($LASTEXITCODE -ne 0) { throw 'DSH package installation failed.' }
& $cli plugin --profile $profileName list dsh-standalone-memory --depth 0
if ($LASTEXITCODE -ne 0) { throw 'Unable to verify package listing.' }
```

3. Verify the listing actually contains `dsh-standalone-memory 0.11.3`. Report package installation separately from runtime activation. After an owner-approved restart, check Settings → 原话记忆. Do not query real conversations as an installation test. If DSH is not on PATH or the host is incompatible, stop and explain; do not install other software automatically.
