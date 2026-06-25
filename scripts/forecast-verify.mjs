const r = await fetch("http://localhost:3000/budget?company=all", { headers: { "x-forwarded-for": "10.0.0.1" } });
const html = await r.text();
console.log("/budget status:", r.status);
console.log("contains '12-Month Forecast':", html.includes("12-Month Forecast"));
console.log("contains forecast chart legend 'Forecast':", html.includes("Forecast"));
const m = html.match(/Next 12 months[\s\S]{0,80}/);
console.log("headline snippet:", m ? m[0].replace(/<[^>]+>/g, "").trim().slice(0, 80) : "(not found in SSR — may be client-rendered)");
