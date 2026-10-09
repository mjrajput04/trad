const { syms, allDates, run, stats } = require("./bt.js");
const usable = allDates.filter((d) => Object.values(syms).some((s) => s.rv.has(d)));
const half = Math.floor(usable.length / 2);
const IS = usable.slice(0, half), OOS = usable.slice(half);
const base = { risk: 50, maxNotional: 12000, etf: false, lastEntryMin: 690, flatMin: 955, beAt: 1, trailFrom: 1.5, trailR: 1, stopAtr: 0.2,
  orBars: 3, entry: "open2", stop: "or", exit: "$30", minRv: 2, topN: 5, side: "both", gapAlign: 0.01, mktAlign: true };
const f = (s) => s.n ? `n${String(s.n).padStart(4)} w${String(s.win).padStart(5)}% pf${String(s.pf).padStart(5)} $${String(s.net).padStart(6)}` : "—";
function show(label, over) {
  const cfg = { ...base, ...over };
  const a = stats(run(cfg, IS)), b = stats(run(cfg, OOS)), all = stats(run(cfg, usable));
  console.log(label.padEnd(34), f(a).padEnd(36), f(b).padEnd(36), all.n ? `dd${all.dd} mcl${all.mcl} green${all.green}% $${all.perDay}/d cost$${all.cost}` : "");
}
show("BASE or15 $30 rv2 gap1%+mkt top5", {});
console.log("-- target");
for (const e of ["$15", "$20", "$25", "$35", "$40", "$50", "R0.4", "R0.6", "R0.8", "R1", "eod"]) show(`exit ${e}`, { exit: e });
console.log("-- risk (target stays $30)");
for (const r of [25, 40, 75, 100]) show(`risk $${r}`, { risk: r });
console.log("-- risk w/ target 0.6R");
for (const r of [25, 75, 100, 150]) show(`risk $${r} R0.6`, { risk: r, exit: "R0.6" });
console.log("-- rv / topN / gap / side");
for (const v of [1, 1.5, 2.5, 3]) show(`minRv ${v}`, { minRv: v });
for (const n of [2, 3, 8, 10, 20]) show(`top ${n}`, { topN: n });
for (const g of [0.003, 0.005, 0.02, 0.03]) show(`gap ${g * 100}%`, { gapAlign: g });
show("no mkt filter", { mktAlign: false });
show("no gap filter", { gapAlign: 0 });
show("long only", { side: "long" });
show("short only", { side: "short" });
show("OR 10m (2 bars)", { orBars: 2 });
show("OR 30m (6 bars)", { orBars: 6 });
show("entry break", { entry: "break" });
show("stop atr20", { stop: "atr20" });
show("with ETFs", { etf: true });
show("maxNotional 6000", { maxNotional: 6000 });
show("maxNotional 25000", { maxNotional: 25000 });
