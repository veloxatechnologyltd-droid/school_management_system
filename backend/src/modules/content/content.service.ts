import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { BodyDto, CatalogueQueryDto, IndicatorDto, ItemsQueryDto, LEVELS, NewItemDto } from './content.dto';
import { ContentBody, ContentKind, Neighbour, bodyProblem, checkBody, runChecks, stageOf } from './checks';

type Role = 'author' | 'reviewer' | 'lead';
const paged = <T>(rows: (T & { total: string })[], page: { offset: number; limit: number }) => ({ items: rows.map(({ total: _total, ...row }) => row), total: rows.length ? Number(rows[0]!.total) : 0, limit: page.limit, offset: page.offset });
const levelOrder = `array_position(ARRAY[${LEVELS.map(l => `'${l}'`).join(',')}],c.level)`;

// The columns of a version as the screens read it (names come from the account that acted).
const VERSION = `v.id,v.item_id AS "itemId",v.version,v.status,v.body,v.checks,v.author_kind AS "authorKind",v.author_id AS "authorId",au.display_name AS "authorName",
  v.created_at AS "createdAt",v.submitted_at AS "submittedAt",v.reviewer_id AS "reviewerId",ru.display_name AS "reviewerName",v.reviewed_at AS "reviewedAt",v.review_note AS "reviewNote",
  v.published_at AS "publishedAt",v.retired_at AS "retiredAt",xu.display_name AS "retiredByName",v.retirement_reason AS "retirementReason"`;
const VERSION_FROM = `content_versions v JOIN users au ON au.id=v.author_id LEFT JOIN users ru ON ru.id=v.reviewer_id LEFT JOIN users xu ON xu.id=v.retired_by`;
const ITEM_FIELDS = `i.kind,i.level,i.indicator_id AS "indicatorId",c.subject,c.level AS "classLevel",c.code,c.description AS indicator,c.retired_at IS NOT NULL AS "indicatorRetired"`;
const ITEM = `i.id,${ITEM_FIELDS}`;

@Injectable()
export class ContentService {
  async roles(client: PoolClient) { return (await client.query('SELECT content_roles() AS roles')).rows[0].roles as Role[]; }
  async need(client: PoolClient, role: Role | 'staff', message?: string) {
    const ok = role === 'staff' ? (await client.query('SELECT content_is_staff() AS ok')).rows[0].ok : (await client.query('SELECT content_has_role($1) AS ok', [role])).rows[0].ok;
    if (!ok) throw new ForbiddenException(message ?? 'Your content role cannot do this');
  }

  async me(client: PoolClient, userId: string) {
    const roles = await this.roles(client);
    const queue = roles.includes('reviewer') || roles.includes('lead') ? await this.queueCount(client, userId) : 0;
    return { userId, roles, queue };
  }

  // ---- Catalogue
  async catalogue(client: PoolClient, query: CatalogueQueryDto) {
    const rows = (await client.query(
      `SELECT c.id,c.subject,c.level,c.code,c.strand,c.sub_strand AS "subStrand",c.description,c.term_guidance AS "termGuidance",c.origin,c.source_note AS "sourceNote",c.created_at AS "createdAt",
         c.retired_at AS "retiredAt",c.retirement_reason AS "retirementReason",
         (SELECT count(*)::int FROM content_items i JOIN content_versions v ON v.item_id=i.id AND v.status='published' WHERE i.indicator_id=c.id AND i.kind='question') AS "publishedQuestions",
         (SELECT count(*)::int FROM content_items i JOIN content_versions v ON v.item_id=i.id AND v.status='published' WHERE i.indicator_id=c.id AND i.kind='guide') AS "publishedGuides",
         count(*) OVER() AS total
       FROM catalogue_indicators c
       WHERE ($1::boolean OR c.retired_at IS NULL) AND ($2::text IS NULL OR c.level=$2) AND ($3::text IS NULL OR lower(c.subject)=lower($3))
         AND ($4::text IS NULL OR c.description ILIKE '%'||$4||'%' OR c.code ILIKE '%'||$4||'%')
       ORDER BY ${levelOrder},lower(c.subject),c.code NULLS LAST,c.created_at,c.id LIMIT $5 OFFSET $6`,
      [query.includeRetired === 'true', query.level ?? null, query.subject ?? null, query.search?.trim() || null, query.limit, query.offset])).rows;
    return paged(rows, query);
  }
  async addIndicator(client: PoolClient, userId: string, dto: IndicatorDto) {
    await this.need(client, 'lead', 'Only a content lead edits the catalogue');
    const id = randomUUID(), terms = dto.termGuidance ? [...new Set(dto.termGuidance)].sort() : null, clean = (v?: string) => v?.replace(/\s+/g, ' ').trim() || null;
    try {
      await client.query(
        'INSERT INTO catalogue_indicators(id,subject,level,code,strand,sub_strand,description,term_guidance,origin,source_note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [id, clean(dto.subject), dto.level, clean(dto.code), clean(dto.strand), clean(dto.subStrand), clean(dto.description), terms, dto.origin, clean(dto.sourceNote), userId]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('That code is already in the catalogue for this subject and level');
      throw error;
    }
    return { id };
  }
  async retireIndicator(client: PoolClient, userId: string, id: string, reason: string) {
    await this.need(client, 'lead', 'Only a content lead edits the catalogue');
    const done = await client.query('UPDATE catalogue_indicators SET retired_at=now(),retired_by=$2,retirement_reason=$3 WHERE id=$1 AND retired_at IS NULL', [id, userId, reason.trim()]);
    if (!done.rowCount) throw new NotFoundException('That catalogue entry is unavailable or already retired');
    return { retired: true };
  }

  // ---- Items
  async items(client: PoolClient, userId: string, query: ItemsQueryDto) {
    const rows = (await client.query(
      `SELECT ${ITEM},v.id AS "versionId",v.version,v.status,v.author_kind AS "authorKind",au.display_name AS "authorName",v.submitted_at AS "submittedAt",v.created_at AS "updatedAt",
         CASE WHEN i.kind='question' THEN v.body->>'prompt' ELSE v.body->>'learning' END AS lead,
         (SELECT p.version FROM content_versions p WHERE p.item_id=i.id AND p.status='published') AS "publishedVersion",
         count(*) OVER() AS total
       FROM content_items i JOIN catalogue_indicators c ON c.id=i.indicator_id
       JOIN LATERAL (SELECT * FROM content_versions x WHERE x.item_id=i.id ORDER BY x.version DESC LIMIT 1) v ON true
       JOIN users au ON au.id=v.author_id
       WHERE ($1::uuid IS NULL OR i.indicator_id=$1) AND ($2::text IS NULL OR i.kind=$2) AND ($3::text IS NULL OR v.status=$3) AND (NOT $4::boolean OR v.author_id=$5)
       ORDER BY v.created_at DESC,i.id LIMIT $6 OFFSET $7`,
      [query.indicatorId ?? null, query.kind ?? null, query.status ?? null, query.mine === 'true', userId, query.limit, query.offset])).rows;
    return paged(rows, query);
  }
  async item(client: PoolClient, id: string) {
    const item = (await client.query(`SELECT ${ITEM} FROM content_items i JOIN catalogue_indicators c ON c.id=i.indicator_id WHERE i.id=$1`, [id])).rows[0];
    if (!item) throw new NotFoundException('Content item unavailable');
    const versions = (await client.query(`SELECT ${VERSION} FROM ${VERSION_FROM} WHERE v.item_id=$1 ORDER BY v.version DESC`, [id])).rows;
    return { ...item, stage: stageOf(item.classLevel), versions };
  }
  private clean(kind: ContentKind, level: number | null, raw: unknown): ContentBody {
    const checked = checkBody(kind, level, raw);
    if (!checked.ok) throw new BadRequestException(bodyProblem(checked.reason));
    return checked.body;
  }
  async createItem(client: PoolClient, userId: string, dto: NewItemDto) {
    await this.need(client, 'author', 'Only a content author writes items');
    const kind = dto.kind as ContentKind, level = kind === 'question' ? dto.level ?? null : null;
    if (kind === 'question' && level === null) throw new BadRequestException('A question needs a difficulty from 1 to 3');
    if (kind === 'guide' && dto.level !== undefined) throw new BadRequestException('A guide has no difficulty');
    const indicator = (await client.query('SELECT retired_at FROM catalogue_indicators WHERE id=$1', [dto.indicatorId])).rows[0];
    if (!indicator) throw new NotFoundException('Catalogue entry unavailable');
    if (indicator.retired_at) throw new ConflictException('That catalogue entry is retired');
    const body = this.clean(kind, level, dto.body), itemId = randomUUID(), versionId = randomUUID();
    await client.query('INSERT INTO content_items(id,kind,indicator_id,level,created_by) VALUES($1,$2,$3,$4,$5)', [itemId, kind, dto.indicatorId, level, userId]);
    await client.query('INSERT INTO content_versions(id,item_id,version,body,author_id) VALUES($1,$2,1,$3,$4)', [versionId, itemId, JSON.stringify(body), userId]);
    return { itemId, versionId };
  }
  // The version, its item and the indicator's class level, locked for the change about to be made.
  private async load(client: PoolClient, versionId: string) {
    const row = (await client.query(
      `SELECT v.id,v.item_id,v.version,v.status,v.body,v.author_id,v.author_kind,i.kind,i.level,i.indicator_id,c.level AS class_level
       FROM content_versions v JOIN content_items i ON i.id=v.item_id JOIN catalogue_indicators c ON c.id=i.indicator_id WHERE v.id=$1 FOR UPDATE OF v`, [versionId])).rows[0];
    if (!row) throw new NotFoundException('Content version unavailable');
    return row as { id: string; item_id: string; version: number; status: string; body: ContentBody; author_id: string; author_kind: string; kind: ContentKind; level: number | null; indicator_id: string; class_level: string };
  }
  async newVersion(client: PoolClient, userId: string, itemId: string, dto: BodyDto) {
    await this.need(client, 'author', 'Only a content author writes items');
    const item = (await client.query('SELECT i.kind,i.level,c.retired_at FROM content_items i JOIN catalogue_indicators c ON c.id=i.indicator_id WHERE i.id=$1', [itemId])).rows[0];
    if (!item) throw new NotFoundException('Content item unavailable');
    if (item.retired_at) throw new ConflictException('That catalogue entry is retired');
    // Two people adding a version at once are separated by the unique (item, version) and one-open-version indexes.
    const latest = (await client.query('SELECT version,status FROM content_versions WHERE item_id=$1 ORDER BY version DESC LIMIT 1', [itemId])).rows[0];
    if (['draft', 'in_review'].includes(latest.status)) throw new ConflictException('This item already has a version being written or reviewed');
    const body = this.clean(item.kind, item.level, dto.body), id = randomUUID();
    await client.query('INSERT INTO content_versions(id,item_id,version,body,author_id) VALUES($1,$2,$3,$4,$5)', [id, itemId, latest.version + 1, JSON.stringify(body), userId]);
    return { versionId: id, version: latest.version + 1 };
  }
  async editDraft(client: PoolClient, userId: string, versionId: string, dto: BodyDto) {
    await this.need(client, 'author', 'Only a content author writes items');
    const version = await this.load(client, versionId);
    if (version.status !== 'draft') throw new ConflictException('Only a draft can be reworded; write a new version instead');
    if (version.author_id !== userId) throw new ForbiddenException('Only the author can reword their draft');
    await client.query('UPDATE content_versions SET body=$2 WHERE id=$1', [versionId, JSON.stringify(this.clean(version.kind, version.level, dto.body))]);
    return { saved: true };
  }
  async submit(client: PoolClient, userId: string, versionId: string) {
    await this.need(client, 'author', 'Only a content author submits for review');
    const version = await this.load(client, versionId);
    if (version.status !== 'draft') throw new ConflictException('Only a draft can be submitted');
    if (version.author_id !== userId) throw new ForbiddenException('Only the author submits a draft for review');
    const body = this.clean(version.kind, version.level, version.body);
    // Wording already in review or live for this indicator, from other items.
    const neighbours = (await client.query(
      `SELECT i.id AS "itemId",CASE WHEN i.kind='question' THEN v.body->>'prompt' ELSE v.body->>'learning' END AS text
       FROM content_items i JOIN content_versions v ON v.item_id=i.id AND v.status IN ('in_review','published') WHERE i.indicator_id=$1 AND i.kind=$2 AND i.id<>$3`,
      [version.indicator_id, version.kind, version.item_id])).rows as Neighbour[];
    const report = runChecks(version.kind, stageOf(version.class_level), body, neighbours);
    if (report.blocking) throw new UnprocessableEntityException({ message: 'The automatic checks found a problem to fix before review', code: 'CHECKS_FAILED', details: report });
    await client.query("UPDATE content_versions SET status='in_review',checks=$2,submitted_at=now() WHERE id=$1", [versionId, JSON.stringify(report)]);
    return { status: 'in_review', report };
  }

  // ---- Review
  private async reviewable(client: PoolClient, userId: string, versionId: string) {
    await this.need(client, 'reviewer', 'Only a content reviewer decides on a version');
    const version = await this.load(client, versionId);
    if (version.status !== 'in_review') throw new ConflictException('This version is not waiting for review');
    if (version.author_kind === 'person' && version.author_id === userId) throw new ForbiddenException('You cannot review your own writing');
    return version;
  }
  async approve(client: PoolClient, userId: string, versionId: string, note?: string) {
    const version = await this.reviewable(client, userId, versionId);
    // The version it replaces leaves use as the new one goes live.
    await client.query("UPDATE content_versions SET status='retired',retired_at=now(),retired_by=$2,retirement_reason=$3 WHERE item_id=$1 AND status='published'", [version.item_id, userId, `Replaced by version ${version.version}`]);
    await client.query("UPDATE content_versions SET status='published',reviewer_id=$2,reviewed_at=now(),review_note=$3,published_at=now() WHERE id=$1", [versionId, userId, note?.trim() || null]);
    return { status: 'published' };
  }
  async reject(client: PoolClient, userId: string, versionId: string, note: string) {
    await this.reviewable(client, userId, versionId);
    await client.query("UPDATE content_versions SET status='rejected',reviewer_id=$2,reviewed_at=now(),review_note=$3 WHERE id=$1", [versionId, userId, note.trim()]);
    return { status: 'rejected' };
  }
  // A reviewer takes a submitted or live version out of use; an author may withdraw their own draft.
  async retire(client: PoolClient, userId: string, versionId: string, reason: string) {
    await this.need(client, 'staff');
    const version = await this.load(client, versionId);
    if (!['draft', 'in_review', 'published'].includes(version.status)) throw new ConflictException('This version is already out of use');
    const ownDraft = version.status === 'draft' && version.author_id === userId;
    if (!ownDraft) await this.need(client, 'reviewer', 'Only a content reviewer takes a submitted or published version out of use');
    await client.query("UPDATE content_versions SET status='retired',retired_at=now(),retired_by=$2,retirement_reason=$3 WHERE id=$1", [versionId, userId, reason.trim()]);
    return { status: 'retired' };
  }
  private queueSql = `FROM content_versions v JOIN content_items i ON i.id=v.item_id WHERE v.status='in_review' AND (v.author_kind='ai' OR v.author_id<>$1)`;
  private async queueCount(client: PoolClient, userId: string) { return (await client.query(`SELECT count(*)::int AS n ${this.queueSql}`, [userId])).rows[0].n as number; }
  async queue(client: PoolClient, userId: string) {
    await this.need(client, 'reviewer', 'Only a content reviewer sees the review queue');
    const ids = (await client.query(`SELECT v.id ${this.queueSql} ORDER BY v.submitted_at,v.id LIMIT 100`, [userId])).rows.map(r => r.id as string);
    if (!ids.length) return { items: [], total: 0 };
    const rows = (await client.query(
      `SELECT ${ITEM_FIELDS},${VERSION} FROM ${VERSION_FROM} JOIN content_items i ON i.id=v.item_id JOIN catalogue_indicators c ON c.id=i.indicator_id WHERE v.id=ANY($1) ORDER BY v.submitted_at,v.id`, [ids])).rows;
    return { items: rows.map(r => ({ ...r, stage: stageOf(r.classLevel) })), total: await this.queueCount(client, userId) };
  }
}
