$ErrorActionPreference = 'Stop'

function Assert-True($Condition, [string] $Message) {
    if (-not $Condition) {
        throw $Message
    }
}

$repoPath = Split-Path $PSScriptRoot
$testPath = Join-Path ([System.IO.Path]::GetTempPath()) ("belt-publish-test-" + [guid]::NewGuid())
$originalApiKey = $env:VIBEHUB_API_KEY
$originalProjectId = $env:VIBEHUB_PROJECT_ID
$originalLocation = Get-Location

# The real version/build commands run in an isolated copy; only the network is mocked.
function Invoke-RestMethod {
    param($Uri, $Method, $Headers, $Form)
    $script:uploadCalled = $true
    Assert-True ($Uri -eq 'https://vibehub.microsoft.com/api/external/push') 'Wrong upload endpoint.'
    Assert-True ($Method -eq 'Post') 'Wrong HTTP method.'
    Assert-True ($Headers['X-API-Key'] -eq $script:expectedApiKey) 'Missing API key header.'
    Assert-True ($Form.projectId -eq $script:expectedProjectId) 'Wrong project ID.'
    $script:archivePath = $Form.file.FullName
    $archive = [System.IO.Compression.ZipFile]::OpenRead($script:archivePath)
    try {
        $entry = $archive.GetEntry('index.html')
        Assert-True ($null -ne $entry) 'index.html must be at the ZIP root.'
        $reader = [System.IO.StreamReader]::new($entry.Open())
        try {
            $html = $reader.ReadToEnd()
            Assert-True ($html.Contains('"version":"1.2.1"')) 'Upload does not contain the bumped version.'
            Assert-True ($html.Contains('"publishedDate":"' + (Get-Date -Format 'yyyy-MM-dd') + '"')) 'Upload date is stale.'
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $archive.Dispose()
    }
    if ($script:scenario -eq 'upload-failure') {
        throw 'Simulated upload failure.'
    }
    if ($script:scenario -eq 'invalid-response') {
        return @{ error = 'Unexpected response' }
    }
    return @{ id = 'test-project'; versionId = 'test-version' }
}

try {
    foreach ($script:scenario in @('success', 'build-failure', 'upload-failure', 'invalid-response', 'dotenv', 'quoted-dotenv', 'environment-precedence', 'invalid-dotenv')) {
        $env:VIBEHUB_API_KEY = 'test-key'
        $env:VIBEHUB_PROJECT_ID = $null
        $script:expectedApiKey = 'test-key'
        $script:expectedProjectId = 'mattl-beltplanner'
        $fixturePath = Join-Path $testPath $script:scenario
        New-Item -ItemType Directory -Path $fixturePath -Force | Out-Null
        Copy-Item (Join-Path $repoPath 'publish-vibehub.ps1') $fixturePath
        Copy-Item (Join-Path $repoPath 'build.mjs') $fixturePath
        Copy-Item (Join-Path $repoPath 'src') $fixturePath -Recurse
        '{"name":"publish-test","version":"1.2.0","publishedDate":"2000-01-01","private":true,"scripts":{"build":"node build.mjs"}}' |
            Set-Content (Join-Path $fixturePath 'package.json')
        switch ($script:scenario) {
            'dotenv' {
                $env:VIBEHUB_API_KEY = $null
                $script:expectedProjectId = 'dotenv-project'
                "VIBEHUB_API_KEY=test-key`nVIBEHUB_PROJECT_ID=dotenv-project" |
                    Set-Content (Join-Path $fixturePath '.env')
            }
            'quoted-dotenv' {
                $env:VIBEHUB_API_KEY = $null
                $script:expectedApiKey = 'test-key#literal'
                $script:expectedProjectId = 'quoted-project'
                @'
# Comments and unrelated entries are allowed.
UNRELATED_SETTING=ignored
export VIBEHUB_API_KEY = "test-key#literal" # comment
VIBEHUB_PROJECT_ID='quoted-project'
'@ | Set-Content (Join-Path $fixturePath '.env')
            }
            'environment-precedence' {
                $env:VIBEHUB_PROJECT_ID = 'environment-project'
                $script:expectedProjectId = 'environment-project'
                "VIBEHUB_API_KEY=ignored-file-key`nVIBEHUB_PROJECT_ID=ignored-file-project" |
                    Set-Content (Join-Path $fixturePath '.env')
            }
            'invalid-dotenv' {
                'VIBEHUB_API_KEY="unterminated-test-value' |
                    Set-Content (Join-Path $fixturePath '.env')
            }
        }
        if ($script:scenario -eq 'build-failure') {
            Remove-Item (Join-Path $fixturePath 'src\index.html')
        }
        $script:uploadCalled = $false
        $script:archivePath = $null
        $failure = $null
        try {
            . (Join-Path $fixturePath 'publish-vibehub.ps1')
        }
        catch {
            $failure = $_
        }
        Assert-True ((Get-Location).Path -eq $originalLocation.Path) 'Working directory was not restored.'
        $manifest = Get-Content (Join-Path $fixturePath 'package.json') -Raw | ConvertFrom-Json
        if ($script:scenario -eq 'invalid-dotenv') {
            Assert-True ($null -ne $failure) 'Invalid .env must fail.'
            Assert-True ($failure.ToString().Contains('Invalid quoted value')) 'Invalid .env error is unclear.'
            Assert-True (-not $failure.ToString().Contains('unterminated-test-value')) 'Error exposed a configuration value.'
            Assert-True ($manifest.version -eq '1.2.0') 'Invalid configuration must not bump the version.'
            Assert-True (-not $script:uploadCalled) 'Invalid configuration must not upload.'
            Write-Host "PASS: $script:scenario"
            continue
        }
        Assert-True ($manifest.version -eq '1.2.1') 'Patch version was not incremented exactly once.'
        Assert-True ($manifest.publishedDate -eq (Get-Date -Format 'yyyy-MM-dd')) 'Publication date was not updated.'
        Assert-True (-not (Test-Path (Join-Path $fixturePath '.git'))) 'Publishing should not create Git metadata.'
        if ($script:scenario -in @('success', 'dotenv', 'quoted-dotenv', 'environment-precedence')) {
            if ($failure) { throw $failure }
            Assert-True $script:uploadCalled 'Upload was not called.'
        }
        else {
            Assert-True ($null -ne $failure) "Expected $script:scenario to fail."
            $expectedMessage = switch ($script:scenario) {
                'build-failure' { 'npm run build failed' }
                'upload-failure' { 'Simulated upload failure' }
                'invalid-response' { 'VibeHub returned an unexpected response' }
            }
            Assert-True ($failure.ToString().Contains($expectedMessage)) "Unexpected failure: $failure"
            Assert-True ($script:uploadCalled -eq ($script:scenario -ne 'build-failure')) 'Build failure must prevent upload.'
        }
        if ($script:archivePath) {
            Assert-True (-not (Test-Path (Split-Path $script:archivePath))) 'Temporary ZIP directory was not cleaned up.'
        }
        Write-Host "PASS: $script:scenario"
    }
}
finally {
    $env:VIBEHUB_API_KEY = $originalApiKey
    $env:VIBEHUB_PROJECT_ID = $originalProjectId
    Remove-Item -LiteralPath $testPath -Recurse -Force
}
