import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, UserPlus, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AdminUser {
  id: string;
  email: string;
  confirmed: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

async function adminFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(`/admin-api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

/** Admin-only user management. Rendered in Settings only for the admin account. */
export function AdminUsers({ adminEmail }: { adminEmail: string }) {
  const qc = useQueryClient();
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editPass, setEditPass] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => adminFetch("/users") as Promise<{ users: AdminUser[] }>,
    refetchInterval: 60_000,
  });
  const users = data?.users ?? [];

  const create = useMutation({
    mutationFn: () => adminFetch("/users", { method: "POST", body: JSON.stringify({ email: newEmail, password: newPass, sendEmail }) }),
    onSuccess: (r: any) => {
      toast.success(`User ${r.email} created${r.emailed ? " — login emailed" : ""}`);
      setNewEmail(""); setNewPass("");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: ({ id, email, password }: { id: string; email?: string; password?: string }) =>
      adminFetch(`/users/${id}`, { method: "PATCH", body: JSON.stringify({ email, password }) }),
    onSuccess: () => {
      toast.success("User updated");
      setEditing(null); setEditEmail(""); setEditPass("");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => adminFetch(`/users/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("User deleted"); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <section className="rounded-2xl glass overflow-hidden">
      <div className="px-5 py-3 hairline-b text-sm font-semibold flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" /> User Management <span className="text-[10px] font-normal text-muted-foreground">Admin only</span>
      </div>

      {/* Create */}
      <div className="p-5 hairline-b bg-surface-1/40">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Create new user</div>
        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@example.com" type="email"
            className="h-9 rounded-lg bg-surface-1 hairline px-3 text-sm focus:outline-none" />
          <input value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="password (min 6)" type="text"
            className="h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num focus:outline-none" />
          <button onClick={() => create.mutate()} disabled={create.isPending || !newEmail || newPass.length < 6}
            className="h-9 px-4 rounded-lg gradient-primary text-background text-xs font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
            {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Create
          </button>
        </div>
        <label className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          <Mail className="h-3 w-3" /> Email the login details to the new user
        </label>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : isError ? (
        <div className="p-6 text-center text-xs text-warn">{(error as Error)?.message}</div>
      ) : (
        <div>
          {users.map((u) => {
            const isAdmin = u.email.toLowerCase() === adminEmail.toLowerCase();
            const isEditing = editing === u.id;
            return (
              <div key={u.id} className="px-5 py-3 hairline-b last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      {u.email}
                      {isAdmin && <span className="text-[9px] font-bold bg-primary/15 text-primary rounded px-1.5 py-0.5">ADMIN</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {u.confirmed ? "active" : "unconfirmed"} · last login {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : "never"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => { setEditing(isEditing ? null : u.id); setEditEmail(u.email); setEditPass(""); }}
                      className="h-8 px-2.5 rounded-lg hairline bg-surface-1 hover:bg-surface-2 text-[11px] inline-flex items-center gap-1">
                      <KeyRound className="h-3 w-3" /> Edit
                    </button>
                    {!isAdmin && (
                      <button onClick={() => { if (window.confirm(`Delete ${u.email}? This removes their account permanently.`)) del.mutate(u.id); }}
                        disabled={del.isPending}
                        className="h-8 w-8 grid place-items-center rounded-lg hairline bg-surface-1 hover:bg-bear/20 hover:text-bear text-muted-foreground">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-3 rounded-lg hairline bg-surface-1 p-3 grid sm:grid-cols-2 gap-2">
                    <label className="block">
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">New email</div>
                      <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} type="email"
                        className="w-full h-8 rounded-md bg-surface-2 hairline px-2.5 text-sm focus:outline-none" />
                    </label>
                    <label className="block">
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">New password (blank = keep)</div>
                      <input value={editPass} onChange={(e) => setEditPass(e.target.value)} type="text" placeholder="min 6 chars"
                        className="w-full h-8 rounded-md bg-surface-2 hairline px-2.5 text-sm num focus:outline-none" />
                    </label>
                    <div className="sm:col-span-2 flex gap-2 justify-end">
                      <button onClick={() => setEditing(null)} className="h-8 px-3 rounded-lg hairline bg-surface-2 text-[11px]">Cancel</button>
                      <button
                        onClick={() => update.mutate({ id: u.id, email: editEmail !== u.email ? editEmail : undefined, password: editPass || undefined })}
                        disabled={update.isPending || (editEmail === u.email && !editPass)}
                        className="h-8 px-3 rounded-lg bg-primary text-background text-[11px] font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
                        {update.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save changes"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="px-5 py-2 text-[10px] text-muted-foreground">
        Passwords are stored encrypted by IBKR-grade auth (Supabase). This panel is visible only to the admin account and every action is verified server-side.
      </div>
    </section>
  );
}
