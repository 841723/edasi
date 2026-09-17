# AGENTS.md

## Alcance

- Aplicación personal multi-tenant para seguimiento Ironman 70.3.
- Node 24+ es obligatorio: el backend usa `node:sqlite`.
- La BD principal es `data/endurance.db`; no modifiques datos de un tenant salvo que la tarea lo pida explícitamente.
- `sessions/` contiene JSON legado para la migración inicial; no es origen de datos y no debe modificarse.

## Comandos

- Backend: `cd backend && npm ci && npm test`.
- Test backend concreto: `cd backend && node --test tests/admin.test.mjs`.
- Frontend: `cd frontend && npm ci && npm run build`.
- Frontend dev: `cd frontend && npm run dev` en el puerto `3000`; `/api` se proxifica a `http://localhost:4000` o a `VITE_PROXY_TARGET`.
- Backend dev: `node backend/server.js --port 4000`.
- Producción: `node backend/server.js --port 4000 --static` sirve `frontend/dist`.
- `frontend npm run lint` requiere una configuración ESLint flat (`eslint.config.*`), que actualmente no está incluida; no asumir que el lint pasa solo por tener el script.
- Docker dev: `docker compose up --build`; producción: `docker compose -f docker-compose.prod.yml up -d --build`.
- No existe un `package.json` raíz: instala y ejecuta dependencias por separado en `backend/` y `frontend/`.

## Arquitectura

- `backend/server.js` arranca HTTP, carga `.env`, autentica cookie/API key, resuelve tenant y monta rutas.
- La lógica de dominio está en `backend/routes/` y `backend/lib/`; el frontend no debe consultar SQLite ni ser fuente de datos.
- `backend/init.sql` contiene el esquema inicial; columnas nuevas en BD existentes se incorporan con `ensureColumn` en `backend/lib/db.js`.
- `backend/lib/migrate.js` importa una sola vez los JSON legados cuando la BD no tiene tenants.
- El backend usa SQLite WAL y `withTenant`/`getTenantId`; todas las consultas de datos deben filtrar por `tenant_id`.
- Las sesiones completadas y planificadas viven en `sessions.data` como JSON; las planificadas usan `kind = 'planned'` y `plan_id`.
- Una nueva generación de plan no debe borrar planificaciones anteriores; solo las operaciones explícitas de borrar/reemplazar un plan pueden hacerlo.
- El frontend es React + Vite + Tailwind; React Query debe incluir el tenant activo en las claves de caché de datos tenant-scoped.
- Fuera del calendario y del detalle de sesión, las fechas usan `día #semana` (objetivos: `día semana #N`); mantén este formato también en prompts IA.
- Las notificaciones frontend pasan por `ToastProvider` y se conservan en `localStorage`; no implementes otro buzón paralelo.

## Auth Y Tenants

- Todo `/api/*` requiere cookie `endurance_tok` o API key, salvo health/config de auth y callbacks públicos definidos en las rutas.
- Las API keys se aceptan como `Authorization: Bearer <key>` o `X-Api-Key`; se guarda solo su hash y la clave raw se muestra una vez.
- La petición autenticada lleva `X-Tenant-Id`; el backend valida que el usuario pertenezca al tenant. Una API key ya resuelve tenant y rol.
- Roles: `athlete` (owner protegido), `admin` y `visitor` (solo lectura). El backend debe comprobar permisos aunque la UI oculte botones.
- `DEFAULT_OWNER_EMAIL` crea el owner de la migración inicial; `scripts/create-athlete.mjs` crea tenants nuevos.
- En producción la cookie debe viajar con `Secure`; no expongas secretos en argumentos de procesos, logs o respuestas.

## Sincronización

- La sincronización se ejecuta solo cuando el usuario la solicita: botón Inicio (`POST /api/sync`) o comandos operativos `/sync-all`/`/sync`.
- Actualmente la UI muestra solo Garmin Connect. El backend conserva código Strava para posible reactivación, pero no añadas Strava a la UI sin una petición explícita.
- Garmin usa siempre `uv run --with garminconnect==0.3.8 python scripts/garmin-fetch.py ...`; los tokens del tenant se pasan mediante fichero temporal.
- Garmin admite `list`, `details` e `ids`; no se descargan ni almacenan tracks/GPS. No recrees la tabla `activity_tracks` ni endpoints de tracks.
- `scripts/sync-sessions.mjs` acepta `--force`, `--ids=id1,id2`, `--min-date YYYY-MM-DD` y `--max-date YYYY-MM-DD`; el rango efectivo debe conservarse al normalizar.
- El rango de fuente es `min_date`/`max_date` de la fuente (config de Garmin) o `MIN_DATE` (env). Si no hay rango configurado, la sincronización deriva la fecha mínima de la sesión más antigua del atleta (o de `tenant_settings.min_date`) para acotar el fetch de Garmin, y `sync-sessions.mjs` conserva el rango efectivo al normalizar: no hay fecha mínima hardcodeada. Los comandos `uv`/`node` de sincronización llevan timeout (`runPython`/`runNode` en `sync-run.js`) para no quedarse colgados sin error.
- La sincronización hace upsert de sesiones por `(tenant_id, id)` y debe conservar campos editados localmente como `title`/notas.
- Nunca ejecutes una sincronización automática durante una tarea de análisis o desarrollo.

## IA Y Datos Sensibles

- Los prompts están en `ai_prompts`, aislados por tenant; los roles `system`, `titles` y `chat` son internos.
- Las llamadas IA se registran en `ai_logs`; la API key se guarda únicamente enmascarada.
- El contenido `input`/`response` de `ai_logs` se elimina después de un mes; tokens, coste, proveedor, modelo, estado y duración se conservan.
- La limpieza de logs ocurre al arrancar, al listar logs y diariamente; conserva ese comportamiento al cambiar el almacenamiento.
- Valida límites de semanas, comentarios, prompts y respuestas antes de llamar al proveedor o persistir resultados.
- Los prompts y planes siempre deben resolverse con `tenant_id`; no aceptes IDs de otro tenant.
- El chat del plan sigue el hilo del proveedor cuando lo soporta (gemini: `previous_interaction_id`): en turnos encadenados se envía solo el mensaje del atleta. El contexto completo (perfil, plan, historial) se envía únicamente en la primera pregunta o cuando la interacción caduca (se reintenta con `includeHistory: true`); el proveedor `mock` siempre recibe el contexto completo.

## Cambios Y Verificación

- Antes de cambiar el esquema, modifica `backend/init.sql` y/o `ensureColumn`; no hardcodees DDL disperso en rutas.
- Si una migración puede fallar a mitad, usa una transacción; no dejes un tenant creado parcialmente.
- Al cambiar una query frontend tenant-scoped, actualiza su `queryKey` e invalidaciones relacionadas.
- Para cambios de sincronización verifica la normalización, fechas límite, upsert y preservación de títulos/notas.
- Para cambios de planes verifica que generar dos planes consecutivos conserve ambos y que borrar uno no borre el otro.
- Para cambios de BD usa una `DB_PATH` temporal en pruebas; no pruebes escribiendo sobre `data/endurance.db` sin autorización.
- Tras editar ejecuta `git diff --check`, `npm run build` en frontend, `node --check` sobre módulos backend modificados y `npm test` en backend cuando sus dependencias estén instaladas.
- No edites manualmente `frontend/dist`; es un artefacto generado por Vite.
