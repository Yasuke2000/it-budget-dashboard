#Requires -Version 7.0
<#
.SYNOPSIS
    Export all data for the IT Finance Dashboard in one go.
    Runs the BC invoices, M365 licenses, and Intune devices exports.

.DESCRIPTION
    Prompts for credentials once and calls each individual export script in sequence.
    Output CSV files are written to the specified output directory.

.PARAMETER TenantId
    Azure AD tenant GUID

.PARAMETER ClientId
    App registration client ID

.PARAMETER OutputDir
    Directory for output CSV files (default: ./exports)

.EXAMPLE
    .\Export-All.ps1 -TenantId "your-tenant-id" -ClientId "your-client-id"

.EXAMPLE
    .\Export-All.ps1 -TenantId "your-tenant-id" -ClientId "your-client-id" -OutputDir "C:\Exports\IT-Finance"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$TenantId,

    [Parameter(Mandatory=$true)]
    [string]$ClientId,

    [string]$OutputDir = "./exports",

    # Optional: provide all three to also export Jira worklogs (step 4)
    [string]$JiraBaseUrl,
    [string]$JiraEmail,
    [string]$JiraApiToken
)

# Create output directory if it does not exist
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
    Write-Host "Created output directory: $OutputDir" -ForegroundColor Gray
}

# Prompt for secret once, shared across all scripts
$secureSecret = Read-Host "Enter Client Secret for app $ClientId" -AsSecureString
$ClientSecret = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
)

$scriptDir = $PSScriptRoot

Write-Host ""
Write-Host "=== IT Finance Dashboard — Data Export ===" -ForegroundColor Cyan
Write-Host "Tenant : $TenantId"
Write-Host "App    : $ClientId"
Write-Host "Output : $OutputDir"
if ($JiraBaseUrl) { Write-Host "Jira   : $JiraBaseUrl" }
Write-Host ""

# --- Step 1/4: Business Central Invoices ---
Write-Host "--- Step 1/4: Business Central Invoices ---" -ForegroundColor Cyan
try {
    & "$scriptDir/Export-BCInvoices.ps1" `
        -TenantId     $TenantId `
        -ClientId     $ClientId `
        -ClientSecret $ClientSecret `
        -OutputPath   "$OutputDir/invoices.csv"
    Write-Host ""
}
catch {
    Write-Warning "BC export failed: $_"
    Write-Host ""
}

# --- Step 2/4: Microsoft 365 Licenses ---
Write-Host "--- Step 2/4: Microsoft 365 Licenses ---" -ForegroundColor Cyan
try {
    & "$scriptDir/Export-M365Licenses.ps1" `
        -TenantId     $TenantId `
        -ClientId     $ClientId `
        -ClientSecret $ClientSecret `
        -OutputPath   "$OutputDir/licenses.csv"
    Write-Host ""
}
catch {
    Write-Warning "License export failed: $_"
    Write-Host ""
}

# --- Step 3/4: Intune Devices ---
Write-Host "--- Step 3/4: Intune Devices ---" -ForegroundColor Cyan
try {
    & "$scriptDir/Export-IntuneDevices.ps1" `
        -TenantId     $TenantId `
        -ClientId     $ClientId `
        -ClientSecret $ClientSecret `
        -OutputPath   "$OutputDir/devices.csv"
    Write-Host ""
}
catch {
    Write-Warning "Intune export failed: $_"
    Write-Host ""
}

# --- Step 4/4: Jira Worklogs (optional) ---
if ($JiraBaseUrl -and $JiraEmail) {
    Write-Host "--- Step 4/4: Jira Worklogs ---" -ForegroundColor Cyan
    try {
        $jiraParams = @{
            JiraBaseUrl = $JiraBaseUrl
            Email       = $JiraEmail
            OutputPath  = "$OutputDir/jira-worklogs.csv"
        }
        if ($JiraApiToken) { $jiraParams.ApiToken = $JiraApiToken }

        & "$scriptDir/Export-JiraWorklogs.ps1" @jiraParams
        Write-Host ""
    }
    catch {
        Write-Warning "Jira export failed: $_"
        Write-Host ""
    }
} else {
    Write-Host "--- Step 4/4: Jira Worklogs (skipped — JiraBaseUrl/JiraEmail not provided) ---" -ForegroundColor DarkGray
    Write-Host ""
}

Write-Host "=== Export complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "CSV files saved to: $OutputDir" -ForegroundColor Green
Write-Host "  - invoices.csv"
Write-Host "  - licenses.csv  (remember to fill in pricePerUser!)"
Write-Host "  - devices.csv"
if ($JiraBaseUrl -and $JiraEmail) { Write-Host "  - jira-worklogs.csv" }
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Open your dashboard at /import"
Write-Host "  2. Upload each CSV file"
Write-Host "  3. Your dashboard now shows real data!"
