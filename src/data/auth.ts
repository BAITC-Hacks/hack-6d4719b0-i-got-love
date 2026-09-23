export type AuthRole = "business" | "team";
export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: AuthRole;
  available: boolean;
  team_id?: number | null;
  team_name: string | null;
  interests: string[];
  skills: string[];
  technologies: string[];
};
export type AuthInput = { email: string; password: string; name?: string; role?: AuthRole; team_name?: string };
export const roleName = (role: AuthRole) => role === "business" ? "Бизнес" : "Команда";
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("ru");

export type ProfileInput = { name: string; available: boolean; team_name?: string; interests?: string[]; skills?: string[]; technologies?: string[] };
