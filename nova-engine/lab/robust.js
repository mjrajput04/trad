const B = require("./bt.js");
const { syms, allDates, run, stats } = B;
const usable = allDates.filter((d) => Object.values(syms).some((s) => s.rv.has(d)));
const cfg = { risk: 50, maxNotional: 12000, etf: false, lastEntryMin: 690, flatMin: 955, stopAtr: 0.2,
  orBars: 3, entry: "open2", stop: "or", exit: "$30", minRv: 2, topN: 5, side: "both", gapAlign: 0.01, mktAlign: true };
const all = run(cfg, usable);
const st = stats(all);
console.log("ALL", JSON.stringify(st));
const bySym = {};
for (const t of all) bySym[t.s] = (bySym[t.s] || 0) + t.pnl;
const srt = Object.entries(bySym).sort((a, b) => b[1] - a[1]);
console.log("symbols traded:", srt.length, " top5:", srt.slice(0, 5).map(([s, v]) => `${s} ${v.toFixed(0)}`).join(", "), " worst5:", srt.slice(-5).map(([s, v]) => `${s} ${v.toFixed(0)}`).join(", "));
const top5sum = srt.slice(0, 5).reduce((a, [, v]) => a + v, 0);
console.log(`net without top-5 symbols: ${(st.net - top5sum).toFixed(0)}`);
const why = {}; for (const t of all) why[t.why] = (why[t.why] || 0) + 1; console.log("exits:", JSON.stringify(why));
console.log("avg win $", (all.filter(t=>t.pnl>0).reduce((a,t)=>a+t.pnl,0)/all.filter(t=>t.pnl>0).length).toFixed(1), " avg loss $", (all.filter(t=>t.pnl<=0).reduce((a,t)=>a+t.pnl,0)/all.filter(t=>t.pnl<=0).length).toFixed(1), " avg shares", (all.reduce((a,t)=>a+t.sh,0)/all.length).toFixed(0), " avg notional $", (all.reduce((a,t)=>a+t.sh*t.entry,0)/all.length).toFixed(0));
// random universe halves (excluding SPY which drives the market filter)
let rng = 7; const rnd = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
const names = Object.keys(syms).filter((s) => s !== "SPY");
for (let k = 0; k < 6; k++) {
  const pick = new Set(names.filter(() => rnd() < 0.5));
  const saved = {};
  for (const s of names) if (!pick.has(s)) { saved[s] = syms[s]; delete syms[s]; }
  const a = stats(run(cfg, usable));
  for (const s in saved) syms[s] = saved[s];
  const rest = new Set(names.filter((s) => !pick.has(s)));
  const saved2 = {};
  for (const s of names) if (!rest.has(s)) { saved2[s] = syms[s]; delete syms[s]; }
  const b = stats(run(cfg, usable));
  for (const s in saved2) syms[s] = saved2[s];
  console.log(`split ${k}: A n${a.n} w${a.win}% pf${a.pf} $${a.net} | B n${b.n} w${b.win}% pf${b.pf} $${b.net}`);
}
// per-day P&L distribution
const byDay = {}; for (const t of all) byDay[t.d] = (byDay[t.d] || 0) + t.pnl;
const v = Object.values(byDay).sort((a, b) => a - b);
console.log("days traded", v.length, "worst day", v[0].toFixed(0), "best day", v.at(-1).toFixed(0), "median", v[Math.floor(v.length/2)].toFixed(0));
