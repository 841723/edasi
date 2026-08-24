import { useEffect, useRef, useState } from "react";
import { Bot, Check, Clipboard, Loader2, MessageCircle, Send, Trash2, User, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { formatChatTimestamp } from "@/lib/date-format";
import { useCoachChat, useSendCoachChat, useCancelCoachChat, useDeleteCoachChatMessages, useSetCoachProvider, useImportCoachResponse, coachChatKey, CHAT_INVALIDATE } from "@/hooks/use-coach-chat";
import { useAuth } from "@/components/auth/auth-context";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/components/ui/toast";
import { invalidateMany } from "@/lib/invalidate";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/ui/markdown";

interface CoachChatProps {
  selectedSessions: Set<string>;
}

export function CoachChat({ selectedSessions }: CoachChatProps) {
  const { activeTenantId } = useAuth();
  const permissions = usePermissions();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useCoachChat(true);
  const sendMutation = useSendCoachChat();
  const cancelMutation = useCancelCoachChat();
  const deleteMutation = useDeleteCoachChatMessages();
  const providerMutation = useSetCoachProvider();
  const importMutation = useImportCoachResponse();
  const [draft, setDraft] = useState("");
  const [showLatest, setShowLatest] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [externalResponse, setExternalResponse] = useState("");
  const [showImport, setShowImport] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shouldStickToBottom = useRef(true);
  const previousMessageCount = useRef(0);
  const wasPending = useRef(false);
  const completionHandled = useRef(false);
  const cancelRequested = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    const maxHeight = 160;
    input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  const canChat = permissions.canEdit && Boolean(data?.canChat);
  const coachWriting = sendMutation.isPending || Boolean(data?.chatPending);

  function scrollToLatest(smooth = false) {
    const container = scrollRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });

    shouldStickToBottom.current = true;
    setShowLatest(false);
  }

  useEffect(() => {
    const messageCount = data?.messages.length ?? 0;

    if (messageCount > 0 && previousMessageCount.current === 0) {
      requestAnimationFrame(() => scrollToLatest());
    }

    if (messageCount > previousMessageCount.current && shouldStickToBottom.current) {
      requestAnimationFrame(() => scrollToLatest(true));
    }

    previousMessageCount.current = messageCount;
  }, [data?.messages.length]);

  // Cuando el entrenador termina, el puente SSE invalida el chat y este efecto
  // avisa y refresca los datos que pudo modificar.
  useEffect(() => {
    const pending = Boolean(data?.chatPending);

    if (pending) {
      wasPending.current = true;
      completionHandled.current = false;
      return;
    }

    if (wasPending.current && !completionHandled.current) {
      completionHandled.current = true;
      wasPending.current = false;
      if (cancelRequested.current) {
        cancelRequested.current = false;
        toast({ type: "success", title: "Respuesta cancelada" });
      } else {
        toast({ type: "success", title: "El entrenador ha respondido" });
      }
      void queryClient.invalidateQueries({ queryKey: coachChatKey(activeTenantId) });
      invalidateMany(queryClient, CHAT_INVALIDATE);
    } else if (!pending && !wasPending.current) {
      cancelRequested.current = false;
    }
  }, [data?.chatPending, data?.messages.length, queryClient, toast, activeTenantId]);

  function handleScroll() {
    const container = scrollRef.current;
    if (!container) return;

    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 80;

    shouldStickToBottom.current = isNearBottom;
    setShowLatest(!isNearBottom && container.scrollHeight > container.clientHeight);
  }

  function handleSend() {
    const message = draft.trim();
    if (!message || sendMutation.isPending) return;

    shouldStickToBottom.current = true;
    sendMutation.mutate({ message, sessionIds: [...selectedSessions] }, {
      onSuccess: (result) => {
        if (result.external) setExternalResponse("");
      },
    });
    setDraft("");
  }

  async function copyPrompt() {
    const prompt = sendMutation.data?.prompt;
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    toast({ type: "success", title: "Prompt copiado" });
  }

  function importResponse() {
    if (!externalResponse.trim()) return;
    importMutation.mutate({ response: externalResponse, sessionIds: [...selectedSessions] }, { onSuccess: () => setShowImport(false) });
  }

  function handleCancel() {
    if (cancelMutation.isPending) return;
    cancelRequested.current = true;
    cancelMutation.mutate();
  }

  function toggleMessage(id: string) {
    setSelectedMessages((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function deleteSelected() {
    if (selectedMessages.size === 0 || deleteMutation.isPending) return;
    deleteMutation.mutate([...selectedMessages], {
      onSuccess: () => {
        setSelectedMessages(new Set());
        setSelectionMode(false);
      },
    });
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-dark-400 bg-dark-200/60 shadow-lg">
      <div className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15">
            <MessageCircle className="h-4 w-4 text-accent-light" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Chat con el entrenador</span>
            <span className="block text-[11px] text-gray-500">
              {data?.messages.length ?? 0} mensajes · pregúntale lo que quieras
            </span>
          </span>
        </span>
        <div className="flex items-center gap-2">
          {permissions.canEdit && data && (
            <select
              className="input h-8 max-w-44 py-1 text-xs"
              value={data.providerMode === "external" ? "external" : data.activeConfigId ?? ""}
              onChange={(event) => providerMutation.mutate(event.target.value === "external" ? { mode: "external" } : { mode: "configured", configId: event.target.value })}
              aria-label="Proveedor de IA"
            >
              {data.configs.map((config) => <option key={config.id} value={config.id}>{config.name} · {config.model ?? config.provider}</option>)}
              <option value="external">IA externa</option>
            </select>
          )}
          {permissions.canEdit && (data?.messages.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => {
              setSelectionMode((value) => !value);
              setSelectedMessages(new Set());
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${selectionMode ? "border-accent/50 bg-accent/15 text-accent-light" : "border-dark-400 text-gray-500 hover:border-accent/40 hover:text-gray-200"}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {selectionMode ? "Cancelar" : "Eliminar mensajes"}
          </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-dark-400">
        {selectionMode && (
          <div className="flex items-center justify-between gap-3 border-b border-dark-400 bg-dark-300/30 px-4 py-2.5 text-xs">
            <span className="text-gray-500">Selecciona las preguntas o respuestas que no quieras conservar para la IA.</span>
            <button
              type="button"
              onClick={deleteSelected}
              disabled={selectedMessages.size === 0 || deleteMutation.isPending || Boolean(data?.chatPending)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-red-500/15 px-2.5 py-1.5 font-medium text-red-300 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Eliminar{selectedMessages.size > 0 ? ` (${selectedMessages.size})` : ""}
            </button>
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
           className="relative min-h-0 flex-1 space-y-4 overflow-y-auto bg-dark-300/10 p-4 sm:p-6"
        >
          {isLoading && (
            <>
              <Skeleton className="h-14 w-2/3 rounded-xl" />
              <Skeleton className="ml-auto h-14 w-1/2 rounded-xl" />
            </>
          )}

          {!isLoading && data?.messages.length === 0 && (
            <div className="py-12 text-center">
              <Bot className="mx-auto mb-2 h-7 w-7 text-accent" />
              <p className="text-sm text-gray-400">
                Pregunta al entrenador sobre tus sesiones, cargas o ajustes.
              </p>
            </div>
          )}

          {data?.messages.map((message) => (
            <div
              key={message.id}
              className={`group flex items-start gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {selectionMode && (
                <button
                  type="button"
                  onClick={() => toggleMessage(message.id)}
                  className={`mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors ${selectedMessages.has(message.id) ? "border-accent bg-accent text-white" : "border-dark-400 text-transparent hover:border-accent/50"}`}
                  aria-label={selectedMessages.has(message.id) ? "Quitar mensaje de la selección" : "Seleccionar mensaje"}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              )}
              <div
                className={`max-w-[min(48rem,88%)] rounded-2xl px-4 py-3 transition-colors ${selectedMessages.has(message.id) ? "ring-1 ring-accent/70" : ""} ${message.role === "user" ? "rounded-br-sm bg-accent/20" : "rounded-bl-sm bg-dark-400/60"}`}
              >
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-500">
                  {message.role === "assistant" ? (
                    <>
                      <Bot className="h-3 w-3" /> Entrenador
                    </>
                  ) : (
                    <>
                      <User className="h-3 w-3" /> Tú
                    </>
                  )}
                  <span>
                     · {formatChatTimestamp(message.created_at)}
                    {message.localStatus === "sending" && " · Enviando"}
                    {message.localStatus === "failed" && " · No se pudo completar"}
                  </span>
                </div>

                {message.role === "assistant" ? (
                  <Markdown text={message.content} />
                ) : (
                  <p className="whitespace-pre-wrap text-sm text-gray-100">{message.content}</p>
                )}
              </div>
            </div>
          ))}

          {coachWriting && (
            <div className="flex items-center gap-2">
              <div className="rounded-2xl rounded-bl-sm bg-dark-400/60 px-4 py-3 text-sm text-gray-400">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                El entrenador está escribiendo...
              </div>
              {data?.chatPending && canChat && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={cancelMutation.isPending}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-dark-300 hover:text-red-300"
                  title="Cancelar la respuesta del entrenador"
                >
                  {cancelMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                  Cancelar
                </button>
              )}
            </div>
          )}

          {showLatest && (
            <button
              type="button"
              className="sticky bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-lg"
              onClick={() => scrollToLatest(true)}
            >
              Ver mensajes recientes
            </button>
          )}
        </div>

         {canChat ? (
           <div className="border-t border-dark-400 p-3 sm:p-4">
             {data?.providerMode === "external" && sendMutation.data?.external && (
               <div className="mb-3 rounded-xl border border-accent/30 bg-accent/10 p-3 text-xs text-gray-300">
                 <p className="mb-2 font-medium text-accent-light">La IA externa está esperando tu respuesta</p>
                 <div className="flex flex-wrap gap-2">
                   <button type="button" className="btn btn-outline px-2.5 py-1.5 text-xs" onClick={() => void copyPrompt()}><Clipboard className="h-3.5 w-3.5" /> Copiar prompt completo</button>
                   <button type="button" className="btn btn-primary px-2.5 py-1.5 text-xs" onClick={() => setShowImport(true)}>Pegar respuesta</button>
                 </div>
               </div>
             )}
             {selectedSessions.size > 0 && <p className="mb-2 text-xs text-accent-light">{selectedSessions.size} entrenamiento{selectedSessions.size === 1 ? "" : "s"} seleccionado{selectedSessions.size === 1 ? "" : "s"} para analizar</p>}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                className="input min-h-10 max-h-40 flex-1 resize-none text-base sm:text-sm"
                placeholder="Escribe una pregunta para tu entrenador..."
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleSend();
                  }
                }}
                disabled={sendMutation.isPending}
              />
              <Button
                className="h-10 shrink-0"
                onClick={handleSend}
                disabled={!draft.trim() || sendMutation.isPending}
                aria-label="Enviar mensaje"
              >
                {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="border-t border-dark-400 px-4 py-3 text-xs text-gray-500">
            {!permissions.canEdit
              ? "Solo los usuarios con permisos de edición pueden chatear."
              : "El chat estará disponible cuando configures un proveedor de IA en Configuración."}
          </div>
        )}
      </div>
      {showImport && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowImport(false)}><div className="card w-full max-w-2xl p-5" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Pegar respuesta de la IA externa</h2><button type="button" onClick={() => setShowImport(false)}><X className="h-4 w-4" /></button></div><textarea className="input min-h-64 w-full resize-y font-mono text-xs" value={externalResponse} onChange={(event) => setExternalResponse(event.target.value)} placeholder="Pega aquí el JSON completo de respuesta..." /><button type="button" className="btn btn-primary mt-3 w-full" disabled={!externalResponse.trim() || importMutation.isPending} onClick={importResponse}>{importMutation.isPending ? "Importando..." : "Importar respuesta"}</button></div></div>}
    </div>
  );
}
