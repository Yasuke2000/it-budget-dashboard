const b = "http://localhost:3000";
const p = await (await fetch(b + "/api/personnel")).json().catch((e) => ({ error: String(e) }));
console.log("personnel payload keys:", Object.keys(p || {}).join(", "));
console.log("employees:", Array.isArray(p) ? p.length : (p.employees?.length ?? p.kpis?.totalEmployees ?? "n/a"));
console.log("OFFICIENT_API_TOKEN set:", Boolean(process.env.OFFICIENT_API_TOKEN));
console.log("OFFICIENT_CLIENT_ID set:", Boolean(process.env.OFFICIENT_CLIENT_ID));
console.log(JSON.stringify(p).slice(0, 400));
