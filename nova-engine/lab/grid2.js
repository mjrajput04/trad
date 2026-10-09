const fs = require("fs");
const { syms, allDates, run, stats } = require("./bt.js");
const usable = allDates.filter((d) => Object.values(syms).some((s) => s.rv.has(d)));
const half = Math.floor(usable.length / 2);
const IS = usable.slice(0, half), OOS = usable.slice(half);
const T = [usable.slice(0, 17), usable.slice(17, 34), usable.slice(34)];
const base = { risk: 50, maxNotional: 12000, side: "both", etf: false, lastEntryMin: 690, flatMin: 955, beAt: 1, trailFrom: 1.5, trailR: 1, stopAtr: 0.2 };
const rows = [];
for (const orBars of [1, 3])
  for (const entry of ["open2", "break"])
    for (const stop of ["or", "atr20"])
      for (const exit of ["eod", "R2", "trail", "$30", "R1"])
        for (const minRv of [1, 2, 3])
          for (const filt of ["none", "gap", "mkt", "gap+mkt"])
            for (const topN of [3, 5])
              for (const side of ["both", "long"]) {
                const cfg = { ...base, orBars, entry, stop, exit, minRv, topN, side,
                  gapAlign: filt.includes("gap") ? 0.01 : 0, mktAlign: filt.includes("mkt") };
                const a = stats(run(cfg, IS)), b = stats(run(cfg, OOS)), all = stats(run(cfg, usable));
                if (!a.n || !b.n) continue;
                const th = T.map((d) => stats(run(cfg, d)).net ?? 0);
                rows.push({ k: `or${orBars * 5}/${entry}/${stop}/${exit}/rv${minRv}/${filt}/top${topN}/${side}`, cfg, IS: a, OOS: b, ALL: all, th, worst: Math.min(a.net, b.net), pos3: th.filter((x) => x > 0).length });
              }
rows.sort((x, y) => (y.pos3 - x.pos3) || (y.worst - x.worst));
const f = (s) => `n${String(s.n).padStart(4)} w${String(s.win).padStart(5)}% pf${String(s.pf).padStart(5)} $${String(s.net).padStart(6)}`;
console.log(`configs ${rows.length}; robust (both halves >0): ${rows.filter((r) => r.worst > 0).length}; all-3-thirds >0: ${rows.filter((r) => r.pos3 === 3).length}`);
for (const r of rows.slice(0, 40))
  console.log(r.k.padEnd(48), f(r.IS).padEnd(36), f(r.OOS).padEnd(36), `thirds ${r.th.join("/")} dd${r.ALL.dd} mcl${r.ALL.mcl} g${r.ALL.green}% $${r.ALL.perDay}/d ${(r.ALL.n / r.ALL.days).toFixed(1)}t/d`);
// how do quick $-target exits fare overall?
const quick = rows.filter((r) => r.cfg.exit === "$30");
console.log(`\n$30 quick-target configs: ${quick.length}, robust: ${quick.filter((r) => r.worst > 0).length}, median ALL net $${quick.map((r) => r.ALL.net).sort((a, b) => a - b)[Math.floor(quick.length / 2)]}`);
fs.writeFileSync("grid2.json", JSON.stringify(rows.slice(0, 200), null, 1));
