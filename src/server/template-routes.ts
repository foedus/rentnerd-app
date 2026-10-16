import { and, asc, count, eq, getTableColumns, isNull, type SQL } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { template, user } from "../db/schema";
import { placeholdersFor, PLACEHOLDERS, TEMPLATE_KIND_LABELS } from "../shared/placeholders";
import { templateContentError } from "../shared/template-content";
import { createTemplateSchema, placeholderQuerySchema, TEMPLATE_NAME_TAKEN, templateListQuerySchema, updateTemplateSchema } from "../shared/template-schemas";
import { apiError } from "./api-guard";
import { diffChanges, writeAudit } from "./audit";
import { validate, validateBody } from "./validation";

type TemplateRow = typeof template.$inferSelect;
type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const isUniqueViolation = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505";

const notFound = (c: Context) => apiError(c, "NOT_FOUND", "Template not found.");
const stale = (c: Context) => apiError(c, "CONFLICT", "This template was changed by someone else. Reload and try again.");
const duplicateName = (c: Context) => apiError(c, "CONFLICT", TEMPLATE_NAME_TAKEN, { name: TEMPLATE_NAME_TAKEN });
const invalid = (c: Context, fields: Record<string, string>) => apiError(c, "VALIDATION_ERROR", "Please check the highlighted fields.", fields);

/**
 * Whether a generated PDF has used the template (§6.11, D-09). Generated documents arrive with the PDF tasks;
 * until then no template can have been used, so every template may be deleted.
 */
const hasGeneratedDocuments = async (): Promise<boolean> => false;

/** Templates (§6.11, §14.2): list, create, read, edit, archive, restore, delete, and the placeholder list for the editor. */
export function mountTemplateRoutes(app: Hono, db: Db) {
  const actor = (c: Context) => c.get("user").id;
  const updatedByName = { updatedByName: user.name };

  const withUsage = async <R extends { id: string }>(rows: R[]) =>
    Promise.all(rows.map(async (r) => ({ ...r, hasDocuments: await hasGeneratedDocuments() })));

  const load = async (tx: Tx, id: string) => {
    const [row] = await tx.select({ ...getTableColumns(template), ...updatedByName }).from(template).leftJoin(user, eq(user.id, template.updatedById)).where(eq(template.id, id));
    return row;
  };
  /** Reads a row that was just written in this request; it exists. */
  const reload = async (id: string) => (await load(db, id)) as NonNullable<Awaited<ReturnType<typeof load>>>;

  app.get("/api/placeholders", (c) => {
    const q = validate(c, placeholderQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.ok) return q.response;
    return c.json({ data: q.data.kind ? placeholdersFor(q.data.kind) : PLACEHOLDERS });
  });

  app.get("/api/templates", async (c) => {
    const q = validate(c, templateListQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.ok) return q.response;
    const { page, pageSize, archived, kind } = q.data;
    const where: SQL | undefined = and(archived === "true" ? undefined : isNull(template.archivedAt), kind ? eq(template.kind, kind) : undefined);
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(template).where(where);
    // The list leaves the (large) content out; the editor reads one template at a time.
    const { content, ...columns } = getTableColumns(template);
    void content;
    const rows = await db.select({ ...columns, ...updatedByName }).from(template).leftJoin(user, eq(user.id, template.updatedById)).where(where)
      .orderBy(asc(template.name), asc(template.id)).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ data: await withUsage(rows), page, pageSize, total });
  });

  app.get("/api/templates/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c);
    const row = await load(db, id);
    return row ? c.json((await withUsage([row]))[0]) : notFound(c);
  });

  app.post("/api/templates", async (c) => {
    const parsed = await validateBody(c, createTemplateSchema);
    if (!parsed.ok) return parsed.response;
    const { name, kind, content } = parsed.data;
    const contentProblem = templateContentError(content, kind);
    if (contentProblem) return invalid(c, { content: contentProblem });
    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx.insert(template).values({ name, kind, content, createdById: actor(c), updatedById: actor(c) }).returning();
        const made = row as TemplateRow;
        await writeAudit(tx, { actorUserId: actor(c), action: "create", entityType: "template", entityId: made.id, summary: `Added ${TEMPLATE_KIND_LABELS[made.kind]} template ${made.name}` });
        return made;
      });
      return c.json({ ...(await load(db, created.id)), hasDocuments: false }, 201);
    } catch (e) {
      if (isUniqueViolation(e)) return duplicateName(c);
      throw e;
    }
  });

  app.patch("/api/templates/:id", async (c) => {
    const parsed = await validateBody(c, updateTemplateSchema);
    if (!parsed.ok) return parsed.response;
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c);
    const { version, ...fields } = parsed.data;
    try {
      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(template).where(eq(template.id, id)).for("update");
        if (!current) return notFound(c);
        if (current.version !== version) return stale(c);
        if (fields.kind !== undefined && fields.kind !== current.kind) return invalid(c, { kind: "The template type can't be changed after the template is saved." });
        const contentProblem = fields.content === undefined ? null : templateContentError(fields.content, current.kind);
        if (contentProblem) return invalid(c, { content: contentProblem });
        const contentChanged = fields.content !== undefined && JSON.stringify(fields.content) !== JSON.stringify(current.content);
        if (!contentChanged && (fields.name === undefined || fields.name === current.name)) return current;
        const [row] = await tx.update(template)
          .set({ name: fields.name, content: fields.content, version: current.version + 1, updatedById: actor(c), updatedAt: new Date() })
          .where(eq(template.id, id)).returning();
        const updated = row as TemplateRow;
        await writeAudit(tx, {
          actorUserId: actor(c), action: "update", entityType: "template", entityId: id,
          summary: `Updated ${TEMPLATE_KIND_LABELS[updated.kind]} template ${updated.name}`,
          changes: { ...diffChanges(current, updated, { name: "Template name" }, String), ...(contentChanged ? { content: ["(edited)", "(edited)"] as [string, string] } : {}) },
        });
        return updated;
      });
      if (result instanceof Response) return result;
      return c.json((await withUsage([await reload(id)]))[0]);
    } catch (e) {
      if (isUniqueViolation(e)) return duplicateName(c);
      throw e;
    }
  });

  const setArchived = (archive: boolean) => async (c: Context) => {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return notFound(c);
    const expected = (await c.req.json().catch(() => ({})) as { version?: unknown }).version;
    try {
      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(template).where(eq(template.id, id)).for("update");
        if (!current) return notFound(c);
        if (expected !== undefined && expected !== current.version) return stale(c);
        if (archive && current.archivedAt) return apiError(c, "CONFLICT", "This template is already archived.");
        if (!archive && !current.archivedAt) return apiError(c, "CONFLICT", "This template isn't archived.");
        await tx.update(template).set({ archivedAt: archive ? new Date() : null, version: current.version + 1, updatedById: actor(c), updatedAt: new Date() }).where(eq(template.id, id));
        await writeAudit(tx, { actorUserId: actor(c), action: archive ? "archive" : "restore", entityType: "template", entityId: id, summary: `${archive ? "Archived" : "Restored"} template ${current.name}` });
        return null;
      });
      return result ?? c.json((await withUsage([await reload(id)]))[0]);
    } catch (e) {
      if (isUniqueViolation(e)) return duplicateName(c);
      throw e;
    }
  };
  app.post("/api/templates/:id/archive", setArchived(true));
  app.post("/api/templates/:id/restore", setArchived(false));

  app.delete("/api/templates/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c);
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(template).where(eq(template.id, id)).for("update");
      if (!current) return notFound(c);
      if (await hasGeneratedDocuments()) return apiError(c, "CONFLICT", "Templates used for generated PDFs can only be archived.");
      await tx.delete(template).where(eq(template.id, id));
      await writeAudit(tx, { actorUserId: actor(c), action: "delete", entityType: "template", entityId: id, summary: `Deleted template ${current.name}` });
      return c.body(null, 204);
    });
  });
}
