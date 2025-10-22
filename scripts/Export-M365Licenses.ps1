#Requires -Version 7.0
<#
.SYNOPSIS
    Export Microsoft 365 license data to CSV for the IT Finance Dashboard.

.DESCRIPTION
    Connects to Microsoft Graph API and exports subscribed SKUs with license counts.
    Optionally includes per-user license assignments.

.PARAMETER TenantId
    Azure AD tenant GUID

.PARAMETER ClientId
    App registration client ID

.PARAMETER ClientSecret
    App registration client secret (will prompt securely if not provided)

.PARAMETER OutputPath
    Path for the output CSV file (default: ./m365-licenses.csv)

.EXAMPLE
    .\Export-M365Licenses.ps1 -TenantId "your-tenant-id" -ClientId "your-client-id"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$TenantId,

    [Parameter(Mandatory=$true)]
    [string]$ClientId,

    [Parameter(Mandatory=$false)]
    [string]$ClientSecret,

    [string]$OutputPath = "./m365-licenses.csv"
)

if (-not $ClientSecret) {
    $secureSecret = Read-Host "Enter Client Secret" -AsSecureString
    $ClientSecret = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
    )
}

Write-Host "Connecting to Microsoft Graph..." -ForegroundColor Cyan

# Get OAuth token for Graph
$tokenUrl = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
$tokenBody = @{
    grant_type    = "client_credentials"
    client_id     = $ClientId
    client_secret = $ClientSecret
    scope         = "https://graph.microsoft.com/.default"
}

try {
    $tokenResponse = Invoke-RestMethod -Uri $tokenUrl -Method POST -Body $tokenBody -ContentType "application/x-www-form-urlencoded"
    $accessToken = $tokenResponse.access_token
    Write-Host "Authenticated successfully." -ForegroundColor Green
}
catch {
    Write-Error "Authentication failed: $_"
    exit 1
}

$headers = @{
    Authorization = "Bearer $accessToken"
    Accept        = "application/json"
}

# Known SKU name mappings (skuPartNumber -> friendly display name)
$skuNames = @{
    "ENTERPRISEPACK"        = "Office 365 E3"
    "SPE_E3"                = "Microsoft 365 E3"
    "SPE_E5"                = "Microsoft 365 E5"
    "SPB"                   = "Microsoft 365 Business Premium"
    "O365_BUSINESS_PREMIUM" = "Microsoft 365 Business Premium"
    "BUSINESS_BASIC"        = "Microsoft 365 Business Basic"
    "FLOW_FREE"             = "Power Automate Free"
    "TEAMS_EXPLORATORY"     = "Teams Exploratory"
    "POWER_BI_STANDARD"     = "Power BI Free"
    "AAD_PREMIUM"           = "Entra ID P1"
    "AAD_PREMIUM_P2"        = "Entra ID P2"
    "EMS"                   = "Enterprise Mobility + Security E3"
    "EMSPREMIUM"            = "Enterprise Mobility + Security E5"
    "INTUNE_A"              = "Intune Plan 1"
}

# Fetch subscribed SKUs
Write-Host "Fetching license data..." -ForegroundColor Cyan
$skusResponse = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/subscribedSkus" -Headers $headers

$licenses = foreach ($sku in $skusResponse.value) {
    $displayName = if ($skuNames[$sku.skuPartNumber]) { $skuNames[$sku.skuPartNumber] } else { $sku.skuPartNumber }
    $prepaid     = $sku.prepaidUnits.enabled
    $consumed    = $sku.consumedUnits
    $available   = $prepaid - $consumed

    [PSCustomObject]@{
        skuPartNumber  = $sku.skuPartNumber
        displayName    = $displayName
        prepaidUnits   = $prepaid
        consumedUnits  = $consumed
        availableUnits = $available
        pricePerUser   = 0  # Fill in manually — no API for contracted prices
    }
}

Write-Host "Found $($licenses.Count) license SKUs" -ForegroundColor Green

$licenses | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
Write-Host "Exported to $OutputPath" -ForegroundColor Green
Write-Host ""
Write-Host "NOTE: The 'pricePerUser' column is set to 0. Edit the CSV and fill in" -ForegroundColor Yellow
Write-Host "your contracted monthly prices before importing into the dashboard." -ForegroundColor Yellow
