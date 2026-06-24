import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings · NOVA" }, { name: "description", content: "Account preferences, API keys, security, notifications." }] }),
  component: Settings,
});

const SECTIONS = [
  {
    title: "Profile",
    rows: [
      { label: "Display name", value: "Alex Kazan" },
      { label: "Email", value: "alex@nova.trade" },
      { label: "Timezone", value: "America/New_York" },
    ],
  },
  {
    title: "Security",
    rows: [
      { label: "Two-factor auth", value: "Enabled (App)" },
      { label: "Last login", value: "Today, 09:14 ET" },
      { label: "Active sessions", value: "2 devices" },
    ],
  },
  {
    title: "API Keys",
    rows: [
      { label: "IBKR API", value: "•••• •••• •••• 4821" },
      { label: "OpenAI Copilot", value: "•••• •••• •••• 9f12" },
      { label: "News Provider", value: "•••• •••• •••• 27aa" },
    ],
  },
  {
    title: "Notifications",
    rows: [
      { label: "Order fills", value: "Push + Email" },
      { label: "Breakout alerts", value: "Push" },
      { label: "AI insights", value: "Email digest (daily)" },
    ],
  },
];

function Settings() {
  return (
    <div className="p-6 max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Account preferences, broker config, security, and notifications.</p>
      </div>

      {SECTIONS.map((s) => (
        <section key={s.title} className="rounded-2xl glass overflow-hidden">
          <div className="px-5 py-3 hairline-b text-sm font-semibold">{s.title}</div>
          <div>
            {s.rows.map((r) => (
              <div key={r.label} className="grid grid-cols-3 px-5 py-3.5 items-center hairline-b last:border-0">
                <div className="text-xs text-muted-foreground">{r.label}</div>
                <div className="col-span-2 flex items-center justify-between">
                  <span className="text-sm num">{r.value}</span>
                  <button className="text-[11px] text-info hover:underline">Edit</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
