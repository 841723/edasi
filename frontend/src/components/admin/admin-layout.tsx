import { Outlet, NavLink, useLocation } from "react-router-dom";
import { Activity, MessageSquareText, Cpu, Users } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";

const TABS = [
  { path: "providers", label: "Proveedores", icon: Cpu },
  { path: "tenants", label: "Tenants", icon: Users },
  { path: "prompts", label: "Prompts", icon: MessageSquareText },
  { path: "observability", label: "Operaciones", icon: Activity },
];

export function AdminLayout() {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status !== "authed") return null;
  if (!user?.isSuperAdmin) {
    return (
      <div className="animate-fade-in">
        <div className="card p-10 text-center">
          <p className="text-gray-500">No tienes permisos de administración.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Administración</h1>
        <p className="text-sm text-gray-500 mt-1">
          Proveedores de IA disponibles y gestión de tenants.
        </p>
      </div>

      <div className="flex gap-1.5 bg-dark-300/40 p-1.5 rounded-xl flex-wrap">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active =
            location.pathname.endsWith(`/admin/${t.path}`) ||
            (t.path === "providers" && location.pathname.endsWith("/admin"));
          return (
            <NavLink
              key={t.path}
              to={t.path}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-accent/20 text-accent-light"
                  : "text-gray-400 hover:text-gray-200 hover:bg-dark-300/60"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </NavLink>
          );
        })}
      </div>

      <Outlet />
    </div>
  );
}
