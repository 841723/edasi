import type {
  CoachChat,
  CoachChatReply,
  ProfileVersion,
  ProfileVersionFull,
} from "@/types/session";
import { get, send } from "./api";

export function fetchCoachChat(): Promise<CoachChat> {
  return get("/chat");
}

export function sendCoachChat(message: string, sessionIds: string[] = []): Promise<CoachChatReply> {
  return send("/chat", "POST", { message, sessionIds });
}

export function setCoachProvider(mode: "configured" | "external", configId?: string): Promise<{ providerMode: string; activeConfigId: string | null }> {
  return send("/chat/provider", "PUT", { mode, configId });
}

export function fetchCoachPrompt(message: string, sessionIds: string[] = []): Promise<{ prompt: string }> {
  return send("/chat/prompt", "POST", { message, sessionIds });
}

export function importCoachResponse(response: string, sessionIds: string[] = []): Promise<Record<string, unknown>> {
  return send("/chat/import", "POST", { response, sessionIds });
}

export function cancelCoachChat(): Promise<{ cancelled: boolean }> {
  return send("/chat/cancel", "POST");
}

export function updateCoachChatInstructions(instructions: string): Promise<{ instructions: string }> {
  return send("/chat/settings", "PUT", { instructions });
}

export function deleteCoachChatMessages(ids: string[]): Promise<{ deletedIds: string[] }> {
  return send("/chat/messages", "DELETE", { ids });
}

export function fetchProfile(): Promise<Record<string, unknown>> {
  return get("/profile");
}

export function updateProfile(payload: Record<string, unknown>): Promise<{ ok: boolean }> {
  return send("/profile", "PUT", payload);
}

export function fetchProfileHistory(): Promise<ProfileVersion[]> {
  return get("/profile/history");
}

export function fetchProfileVersion(versionId: string): Promise<ProfileVersionFull> {
  return get(`/profile/history/${encodeURIComponent(versionId)}`);
}

export function setActiveProfileVersion(versionId: string): Promise<{ ok: boolean }> {
  return send("/profile/active", "PUT", { versionId });
}
