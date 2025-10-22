#Requires -Version 7.0
<#
.SYNOPSIS
    Export purchase invoices from Business Central to CSV for the IT Finance Dashboard.

.DESCRIPTION
    Connects to the BC API v2.0 using OAuth2 client credentials, pulls purchase invoices
    for a date range, and exports them to a CSV file ready for dashboard import.

.PARAMETER TenantId
    Azure AD tenant GUID

.PARAMETER ClientId
    App registration client ID

.PARAMETER ClientSecret
    App registration client secret (will prompt securely if not provided)

.PARAMETER Environment
    BC environment name (default: "production")

.PARAMETER DateFrom
    Start date for invoices (default: January 1st of current year)

.PARAMETER DateTo
    End date for invoices (default: today)

.PARAMETER OutputPath
    Path for the output CSV file (default: ./bc-invoices.csv)

.EXAMPLE
    .\Export-BCInvoices.ps1 -TenantId "your-tenant-id" -ClientId "your-client-id"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$TenantId,

    [Parameter(Mandatory=$true)]
    [string]$ClientId,

    [Parameter(Mandatory=$false)]
    [string]$ClientSecret,

    [string]$Environment = "production",

    [string]$DateFrom = (Get-Date -Month 1 -Day 1 -Format "yyyy-MM-dd"),

    [string]$DateTo = (Get-Date -Format "yyyy-MM-dd"),

    [string]$OutputPath = "./bc-invoices.csv"
)

# Prompt for secret securely if not provided
if (-not $ClientSecret) {
    $secureSecret = Read-Host "Enter Client Secret" -AsSecureString
    $ClientSecret = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
    )
}

Write-Host "Connecting to Business Central..." -ForegroundColor Cyan

# Get OAuth token
$tokenUrl = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
$tokenBody = @{
    grant_type    = "client_credentials"
    client_id     = $ClientId
    client_secret = $ClientSecret
    scope         = "https://api.businesscentral.dynamics.com/.default"
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
    Authorization        = "Bearer $accessToken"
    "Data-Access-Intent" = "ReadOnly"
    Accept               = "application/json"
}

$baseUrl = "https://api.businesscentral.dynamics.com/v2.0/$TenantId/$Environment/api/v2.0"

# Get all companies
Write-Host "Fetching companies..." -ForegroundColor Cyan
$companiesResponse = Invoke-RestMethod -Uri "$baseUrl/companies" -Headers $headers
$companies = $companiesResponse.value
Write-Host "Found $($companies.Count) companies: $($companies.displayName -join ', ')" -ForegroundColor Green

# Fetch invoices for each company
$allInvoices = @()

foreach ($company in $companies) {
    $companyId   = $company.id
    $companyName = $company.displayName
    Write-Host "Fetching invoices for $companyName..." -ForegroundColor Cyan

    $filter = "postingDate ge $DateFrom and postingDate le $DateTo"
    $url    = "$baseUrl/companies($companyId)/purchaseInvoices?`$filter=$filter&`$orderby=postingDate desc"

    $hasMore = $true
    while ($hasMore) {
        try {
            $response = Invoke-RestMethod -Uri $url -Headers $headers

            foreach ($inv in $response.value) {
                $allInvoices += [PSCustomObject]@{
                    number                  = $inv.number
                    invoiceDate             = $inv.invoiceDate
                    postingDate             = $inv.postingDate
                    dueDate                 = $inv.dueDate
                    vendorNumber            = $inv.vendorNumber
                    vendorName              = $inv.vendorName
                    totalAmountExcludingTax = $inv.totalAmountExcludingTax
                    totalAmountIncludingTax = $inv.totalAmountIncludingTax
                    totalTaxAmount          = $inv.totalTaxAmount
                    status                  = $inv.status
                    currencyCode            = if ($inv.currencyCode) { $inv.currencyCode } else { "EUR" }
                    companyId               = $companyId
                    companyName             = $companyName
                    costCategory            = "Other IT"
                }
            }

            if ($response.'@odata.nextLink') {
                $url = $response.'@odata.nextLink'
            }
            else {
                $hasMore = $false
            }
        }
        catch {
            Write-Warning "Error fetching invoices for $companyName : $_"
            $hasMore = $false
        }
    }
}

Write-Host "Total invoices found: $($allInvoices.Count)" -ForegroundColor Green

# Export to CSV
$allInvoices | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
Write-Host "Exported to $OutputPath" -ForegroundColor Green
Write-Host "You can now import this file in the dashboard at /import" -ForegroundColor Yellow
