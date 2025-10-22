# IT Finance Dashboard — Export Scripts

PowerShell scripts that pull data from your Microsoft environment and produce CSV files ready to import into the IT Finance Dashboard.

---

## Prerequisites

### PowerShell 7+

The scripts require PowerShell 7 or later. To check your version:

```powershell
$PSVersionTable.PSVersion
```

Download PowerShell 7 from: https://github.com/PowerShell/PowerShell/releases

### Azure AD App Registration

All scripts authenticate via OAuth2 client credentials. You need a single app registration in Entra ID (Azure AD) with the following API permissions granted as **Application** permissions (not Delegated):

| Script | API | Permission |
|---|---|---|
| Export-BCInvoices.ps1 | Dynamics 365 Business Central | `API.ReadWrite.All` |
| Export-M365Licenses.ps1 | Microsoft Graph | `Organization.Read.All` |
| Export-IntuneDevices.ps1 | Microsoft Graph | `DeviceManagementManagedDevices.Read.All` |

After adding permissions, click **Grant admin consent** for your tenant.

#### How to create the app registration

1. Go to [Entra ID > App registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps) and click **New registration**.
2. Give it a name (e.g. `IT Finance Dashboard Export`) and click **Register**.
3. Note the **Application (client) ID** and **Directory (tenant) ID** — you will need both.
4. Go to **Certificates & secrets > New client secret**. Copy the secret value immediately (it is only shown once).
5. Go to **API permissions**, add the permissions from the table above, and grant admin consent.

---

## Scripts

### Export-BCInvoices.ps1

Connects to the Business Central API v2.0 and exports all purchase invoices for a date range across all BC companies in your tenant.

```powershell
.\Export-BCInvoices.ps1 `
    -TenantId  "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" `
    -ClientId  "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" `
    -OutputPath "./bc-invoices.csv"
```

| Parameter | Required | Default | Description |
|---|---|---|---|
| `TenantId` | Yes | — | Azure AD tenant GUID |
| `ClientId` | Yes | — | App registration client ID |
| `ClientSecret` | No | (prompted) | Client secret |
| `Environment` | No | `production` | BC environment name |
| `DateFrom` | No | Jan 1st of current year | Start date (yyyy-MM-dd) |
| `DateTo` | No | Today | End date (yyyy-MM-dd) |
| `OutputPath` | No | `./bc-invoices.csv` | Output file path |

The output CSV includes: `number`, `invoiceDate`, `postingDate`, `dueDate`, `vendorNumber`, `vendorName`, `totalAmountExcludingTax`, `totalAmountIncludingTax`, `totalTaxAmount`, `status`, `currencyCode`, `companyId`, `companyName`, `costCategory`.

---

### Export-M365Licenses.ps1

Connects to Microsoft Graph and exports all subscribed license SKUs with seat counts.

```powershell
.\Export-M365Licenses.ps1 `
    -TenantId  "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" `
    -ClientId  "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" `
    -OutputPath "./m365-licenses.csv"
```

| Parameter | Required | Default | Description |
|---|---|---|---|
| `TenantId` | Yes | — | Azure AD tenant GUID |
| `ClientId` | Yes | — | App registration client ID |
| `ClientSecret` | No | (prompted) | Client secret |
| `OutputPath` | No | `./m365-licenses.csv` | Output file path |

The output CSV includes: `skuPartNumber`, `displayName`, `prepaidUnits`, `consumedUnits`, `availableUnits`, `pricePerUser`.

> **Important:** The `pricePerUser` column is exported as `0`. Open the CSV in Excel and fill in your contracted monthly price per user for each SKU before importing into the dashboard.

---

### Export-IntuneDevices.ps1

Connects to Microsoft Graph and exports all Intune managed devices with metadata and calculated age.

```powershell
.\Export-IntuneDevices.ps1 `
    -TenantId  "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" `
    -ClientId  "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" `
    -OutputPath "./intune-devices.csv"
```

| Parameter | Required | Default | Description |
|---|---|---|---|
| `TenantId` | Yes | — | Azure AD tenant GUID |
| `ClientId` | Yes | — | App registration client ID |
| `ClientSecret` | No | (prompted) | Client secret |
| `OutputPath` | No | `./intune-devices.csv` | Output file path |

The output CSV includes: `deviceName`, `model`, `manufacturer`, `serialNumber`, `osVersion`, `operatingSystem`, `enrolledDateTime`, `complianceState`, `managedDeviceOwnerType`, `chassisType`, `ageYears`, `assignedUser`.

---

### Export-All.ps1

Wrapper script that runs all three exports in sequence with a single credential prompt. This is the recommended way to do a full refresh of all dashboard data.

```powershell
.\Export-All.ps1 `
    -TenantId  "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" `
    -ClientId  "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" `
    -OutputDir "./exports"
```

| Parameter | Required | Default | Description |
|---|---|---|---|
| `TenantId` | Yes | — | Azure AD tenant GUID |
| `ClientId` | Yes | — | App registration client ID |
| `OutputDir` | No | `./exports` | Directory for all output CSVs |

Produces `exports/invoices.csv`, `exports/licenses.csv`, and `exports/devices.csv`.

---

## Importing into the Dashboard

1. Run `Export-All.ps1` (or the individual scripts) to generate the CSV files.
2. Open the dashboard and go to the **Import** page (`/import`).
3. Upload each CSV file using the appropriate importer.
4. The dashboard will validate the columns and load the data.

---

## Automating with Task Scheduler

To run a nightly or weekly export automatically:

1. Open **Task Scheduler** and click **Create Task**.
2. **General tab:** Give it a name, e.g. `IT Finance Dashboard Export`. Set it to run whether the user is logged on or not.
3. **Triggers tab:** Add a trigger — e.g. Daily at 02:00.
4. **Actions tab:** Add an action:
   - Program: `pwsh.exe`
   - Arguments:
     ```
     -NonInteractive -File "C:\path\to\scripts\Export-All.ps1" -TenantId "your-tenant-id" -ClientId "your-client-id" -ClientSecret "your-secret" -OutputDir "C:\path\to\exports"
     ```
5. **Conditions / Settings:** Adjust as needed for your environment.

> **Security note:** When running non-interactively, the `-ClientSecret` value will appear in the task's action arguments. Ensure the task is protected with appropriate permissions, or use a secrets manager / credential store to retrieve the secret at runtime.

---

## Troubleshooting

### "Authentication failed" / 401 Unauthorized

- Verify the Tenant ID and Client ID are correct.
- Make sure the client secret has not expired (check Entra ID > App registrations > Certificates & secrets).
- Confirm admin consent has been granted for all required permissions.

### "Error fetching invoices" for a Business Central company

- The app registration may not have access to that BC company. In BC, go to **Azure Active Directory Applications** and ensure the app is listed and has the correct permissions for each company.
- Check that the `Environment` parameter matches the name shown in the BC admin center.

### CSV is empty / 0 records

- For BC invoices: try widening the date range with `-DateFrom` and `-DateTo`.
- For Intune devices: verify the `DeviceManagementManagedDevices.Read.All` permission has been granted and consented.
- For M365 licenses: verify `Organization.Read.All` is granted.

### "The term 'pwsh' is not recognized"

PowerShell 7 is not installed or not on your PATH. Download it from https://github.com/PowerShell/PowerShell/releases and reinstall.

### Graph API throttling (429 Too Many Requests)

The scripts do not currently implement retry logic. If you hit throttling on large tenants, add a `Start-Sleep` between paginated requests, or run exports during off-peak hours.
