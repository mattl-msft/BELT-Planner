[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$fileSettings = @{}
$envPath = Join-Path $PSScriptRoot '.env'
if (Test-Path -LiteralPath $envPath -PathType Leaf) {
    $lineNumber = 0
    foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
        $lineNumber++
        if ($line -match '^\s*(?:export\s+)?(VIBEHUB_API_KEY|VIBEHUB_PROJECT_ID)\s*=(.*)$') {
            $name = $Matches[1]
            $value = $Matches[2].Trim()
            if ($value.StartsWith('"') -or $value.StartsWith("'")) {
                if ($value -notmatch '^("([^"]*)"|''([^'']*)'')\s*(?:#.*)?$') {
                    throw "Invalid quoted value for $name in .env at line $lineNumber. Values must be on one line."
                }
                $value = if ($Matches[1].StartsWith('"')) { $Matches[2] } else { $Matches[3] }
            }
            else {
                $value = ($value -replace '\s+#.*$', '').Trim()
            }
            $fileSettings[$name] = $value
        }
        elseif ($line -match '^\s*(?:export\s+)?(?:VIBEHUB_API_KEY|VIBEHUB_PROJECT_ID)\b') {
            throw "Invalid VibeHub setting in .env at line $lineNumber. Expected NAME=value."
        }
    }
}

$apiKey = $env:VIBEHUB_API_KEY
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    $apiKey = $fileSettings['VIBEHUB_API_KEY']
}
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    $secureApiKey = Read-Host 'VibeHub API key' -AsSecureString
    $apiKey = ConvertFrom-SecureString $secureApiKey -AsPlainText
}
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw 'A VibeHub API key is required. Set VIBEHUB_API_KEY in the environment or .env, or enter it at the prompt.'
}

$projectId = $env:VIBEHUB_PROJECT_ID
if ([string]::IsNullOrWhiteSpace($projectId)) {
    $projectId = $fileSettings['VIBEHUB_PROJECT_ID']
}
if ([string]::IsNullOrWhiteSpace($projectId)) {
    $projectId = 'mattl-beltplanner'
}

Push-Location $PSScriptRoot
try {
    & npm version patch --no-git-tag-version
    if ($LASTEXITCODE -ne 0) {
        throw "npm version failed with exit code $LASTEXITCODE."
    }

    $publishedDate = Get-Date -Format 'yyyy-MM-dd'
    & npm pkg set "publishedDate=$publishedDate"
    if ($LASTEXITCODE -ne 0) {
        throw "Updating publishedDate failed with exit code $LASTEXITCODE."
    }

    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed with exit code $LASTEXITCODE. Nothing was uploaded."
    }

    $distPath = Join-Path $PSScriptRoot 'dist'
    if (-not (Test-Path (Join-Path $distPath 'index.html') -PathType Leaf)) {
        throw 'Build output dist\index.html was not found. Nothing was uploaded.'
    }

    $tempPath = Join-Path ([System.IO.Path]::GetTempPath()) ("belt-planner-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tempPath | Out-Null
    try {
        $artifactPath = Join-Path $tempPath 'belt-planner.zip'
        Compress-Archive -Path (Join-Path $distPath '*') -DestinationPath $artifactPath

        $response = Invoke-RestMethod `
            -Uri 'https://vibehub.microsoft.com/api/external/push' `
            -Method Post `
            -Headers @{ 'X-API-Key' = $apiKey } `
            -Form @{
                file = Get-Item $artifactPath
                projectId = $projectId
            }

        if (-not $response.id -or -not $response.versionId) {
            throw 'VibeHub returned an unexpected response without an id and versionId. Verify the deployment in VibeHub before retrying.'
        }
        Write-Host "Published to https://vibehub.microsoft.com/app/$([uri]::EscapeDataString($projectId)) (version ID: $($response.versionId))"
    }
    finally {
        Remove-Item -LiteralPath $tempPath -Recurse -Force
    }
}
finally {
    Pop-Location
}
