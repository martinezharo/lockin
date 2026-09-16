$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\watchdog\LockInWatchdog.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0] }
foreach ($name in @('Normalize-Domain', 'Normalize-Site', 'Normalize-Groups', 'Test-SiteMatches', 'Test-GroupMatchesHost', 'ConvertTo-PolicyFilter')) {
  $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  Invoke-Expression $fn.Extent.Text
}
if ((Normalize-Site 'https://WWW.YouTube.com/watch?v=AbC&utm_source=test#details') -cne 'youtube.com/watch?v=AbC') { throw 'Lost URL specificity' }
if ((ConvertTo-PolicyFilter 'youtube.com/watch?v=ABC') -cne 'youtube.com/watch@v=ABC') { throw 'Invalid policy query delimiter' }
$cases = @(
  @('https://youtube.com/shorts/ABC', 'youtube.com/shorts/', $true),
  @('https://youtube.com/watch?v=ABC', 'youtube.com/shorts/', $false),
  @('https://youtube.com/Shorts/ABC', 'youtube.com/shorts/', $false),
  @('http://youtube.com/watch?utm_source=x&v=ABC', 'youtube.com/watch?v=ABC', $true),
  @('https://youtube.com/watch?v=abc', 'youtube.com/watch?v=ABC', $false),
  @('https://youtube.com/watch?v=OTHER&v=ABC', 'youtube.com/watch?v=ABC', $true),
  @('https://youtube.com.evil.test/watch?v=ABC', 'youtube.com/watch?v=ABC', $false),
  @('https://example.com:8443/a', 'example.com:8443/a', $true),
  @('https://example.com/a', 'example.com:8443/a', $false),
  @('https://example.com/a?x=y%3Dz', 'example.com/a?x%3Dy=z', $false),
  @('https://example.com/a?key', 'example.com/a?key=', $true)
)
foreach ($case in $cases) {
  if ((Test-SiteMatches $case[0] $case[1]) -ne $case[2]) { throw "URL mismatch: $($case[0]) against $($case[1])" }
}
$group = [pscustomobject]@{ id='url'; name='URL'; domains=@('example.com/Path', 'example.com/path') }
$normalized = @(Normalize-Groups @($group))
if ($normalized[0].domains.Count -ne 2) { throw 'Case-sensitive paths collapsed' }
$script:LastUrl = 'https://example.com/elsewhere'
if (Test-GroupMatchesHost $group 'example.com') { throw 'Unrelated page consumes URL allowance' }
$script:LastUrl = 'https://example.com/Path'
if (-not (Test-GroupMatchesHost $group 'example.com')) { throw 'Matching page does not consume allowance' }
Write-Output 'Watchdog URL rule tests passed.'
