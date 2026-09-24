/**
 * One-way migration from the pre-v2 global category taxonomy.
 *
 * Legacy built-in categories are materialized as custom categories instead of being heuristically
 * mapped onto the new preset-local taxonomy. This preserves a user's exact layout while allowing the
 * official taxonomy to be redesigned without carrying legacy categories in the UI forever.
 */

import { CATEGORIES, CATEGORY_TAXONOMY_VERSION } from './categories'
import { LEGACY_CATEGORY_DEFINITIONS, LEGACY_BUILTIN_PRESET_NAMES } from './legacyTaxonomy'
import { canonicalSourceId, isCustomSourceId, SOURCES } from './registry'

const CURRENT_CATEGORY_IDS = new Set(CATEGORIES.map((category) => category.id))
const KNOWN_SOURCE_IDS = new Set(SOURCES.map((source) => source.id))
const LEGACY_IDS = new Set<string>(LEGACY_CATEGORY_DEFINITIONS.map((category) => category.id))

/** Taxonomy v3 only adds these built-in rails; v2 user layouts must keep them hidden after upgrade. */
const V3_ADDED_CATEGORY_IDS = new Set<string>([
  'cn-select',
  'world-zh-press',
  'world-news-press',
  'biz-startup',
  'tech-news',
  'ai-ecosystem',
])

function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((value): value is string => typeof value === 'string')
}

function sourceIds(raw: unknown, customSourceIds: ReadonlySet<string>): string[] {
  const normalized = stringArray(raw)
    .map((id) => (isCustomSourceId(id) || customSourceIds.has(id) ? id : canonicalSourceId(id)))
    .filter((id) => isCustomSourceId(id) || customSourceIds.has(id) || KNOWN_SOURCE_IDS.has(id))
  return [...new Set(normalized)]
}

function own(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function categoryNameOverride(
  raw: unknown,
  fallback: { label: string; short: string },
): { label: string; short: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const record = raw as Record<string, unknown>
  const label = typeof record.label === 'string' && record.label.trim()
    ? record.label.trim().slice(0, 16)
    : fallback.label
  const short = typeof record.short === 'string' && record.short.trim()
    ? record.short.trim().slice(0, 6)
    : fallback.short
  return { label, short }
}

function legacyCustomId(id: string): string {
  return `legacy-v1-${id}`
}

export interface LegacyLayoutMigrationResult {
  value: Record<string, unknown>
  migrated: boolean
}

/**
 * Upgrade the category-related fields on Preferences or LayoutSnapshot-shaped data.
 *
 * New built-in categories are explicitly hidden for migrated layouts. Otherwise the new taxonomy
 * would be appended by orderedCategories() and suddenly become visible beside the preserved layout.
 */
export function migrateLegacyCategoryLayout(raw: unknown): LegacyLayoutMigrationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { value: {}, migrated: false }
  }

  const input = raw as Record<string, unknown>
  const rawOrder = stringArray(input.categoryOrder)
  const rawHidden = new Set(stringArray(input.hiddenCategoryIds))
  const rawSources =
    input.categorySources && typeof input.categorySources === 'object' && !Array.isArray(input.categorySources)
      ? (input.categorySources as Record<string, unknown>)
      : {}
  const rawNames =
    input.categoryNames && typeof input.categoryNames === 'object' && !Array.isArray(input.categoryNames)
      ? (input.categoryNames as Record<string, unknown>)
      : {}
  const hasLegacyCategoryIds =
    rawOrder.some((id) => LEGACY_IDS.has(id)) ||
    Object.keys(rawSources).some((id) => LEGACY_IDS.has(id))

  if (input.categoryTaxonomyVersion === CATEGORY_TAXONOMY_VERSION && !hasLegacyCategoryIds) {
    return { value: { ...input }, migrated: false }
  }

  // v2 -> v3 keeps the exact user-visible layout. New built-in rails are hidden unless the
  // persisted snapshot already knows about them. Existing ids/source overrides remain untouched.
  if (input.categoryTaxonomyVersion === 2 && !hasLegacyCategoryIds) {
    const hidden = new Set(rawHidden)
    for (const categoryId of V3_ADDED_CATEGORY_IDS) {
      if (
        !rawOrder.includes(categoryId) &&
        !own(rawSources, categoryId) &&
        !own(rawNames, categoryId)
      ) {
        hidden.add(categoryId)
      }
    }
    return {
      migrated: true,
      value: {
        ...input,
        categoryTaxonomyVersion: CATEGORY_TAXONOMY_VERSION,
        hiddenCategoryIds: [...hidden],
      },
    }
  }

  const rawCustom = Array.isArray(input.customCategories)
    ? input.customCategories.filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : []
  const rawCustomSourceIds = new Set(
    Array.isArray(input.customSources)
      ? input.customSources
          .filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === 'object' && !Array.isArray(item),
          )
          .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
          .filter(Boolean)
      : [],
  )

  // New callers may omit the version during object construction. Current category ids are a stronger
  // signal than the missing version, so stamp the version instead of running a legacy migration.
  const looksCurrent =
    !hasLegacyCategoryIds &&
    (rawOrder.some((id) => id !== 'mix' && CURRENT_CATEGORY_IDS.has(id)) ||
      Object.keys(rawSources).some((id) => id !== 'mix' && CURRENT_CATEGORY_IDS.has(id)))
  if (looksCurrent) {
    return {
      migrated: false,
      value: { ...input, categoryTaxonomyVersion: CATEGORY_TAXONOMY_VERSION },
    }
  }

  const customCategories: Record<string, unknown>[] = rawCustom.map((item) => ({ ...item }))
  const existingCustomIds = new Set(
    rawCustom
      .map((item) => (typeof item.id === 'string' ? item.id : ''))
      .filter(Boolean),
  )
  const idMap = new Map<string, string>()

  const hasExplicitHidden = Array.isArray(input.hiddenCategoryIds)

  for (const definition of LEGACY_CATEGORY_DEFINITIONS) {
    const visible = hasExplicitHidden
      ? !rawHidden.has(definition.id)
      : rawOrder.includes(definition.id)
    const customized = own(rawSources, definition.id) || own(rawNames, definition.id)
    if (!visible && !customized) continue

    const resolvedSources = own(rawSources, definition.id)
      ? sourceIds(rawSources[definition.id], rawCustomSourceIds)
      : sourceIds(definition.sourceIds, rawCustomSourceIds)
    if (!resolvedSources.length) continue

    let id = legacyCustomId(definition.id)
    let suffix = 2
    while (existingCustomIds.has(id) || CURRENT_CATEGORY_IDS.has(id)) {
      id = `${legacyCustomId(definition.id)}-${suffix}`
      suffix += 1
    }
    existingCustomIds.add(id)
    idMap.set(definition.id, id)

    const name = categoryNameOverride(rawNames[definition.id], {
      label: definition.label,
      short: definition.short,
    })
    customCategories.push({
      id,
      label: name.label,
      short: name.short,
      caption: '',
      sourceIds: resolvedSources,
      isCustom: true,
    })
  }

  const remapId = (id: string) => idMap.get(id) ?? id

  const categoryOrder = rawOrder.map(remapId)

  // Hide the entire new built-in taxonomy for preserved legacy/user layouts.
  const hidden = new Set<string>(
    CATEGORIES.map((category) => category.id).filter((id) => id !== 'mix'),
  )

  // Preserve the old mix visibility state and all user-custom hidden state.
  if (rawHidden.has('mix')) hidden.add('mix')
  else hidden.delete('mix')

  for (const id of rawHidden) {
    const mapped = remapId(id)
    if (idMap.has(id) || existingCustomIds.has(mapped) || CURRENT_CATEGORY_IDS.has(mapped)) {
      hidden.add(mapped)
    }
  }

  // Legacy categories that used to be visible stay visible after becoming custom categories.
  for (const [legacyId, migratedId] of idMap) {
    if (!rawHidden.has(legacyId)) hidden.delete(migratedId)
  }

  const categorySources: Record<string, unknown> = {}
  for (const [id, ids] of Object.entries(rawSources)) {
    if (LEGACY_IDS.has(id)) continue
    categorySources[remapId(id)] = ids
  }

  const categoryNames: Record<string, unknown> = {}
  for (const [id, value] of Object.entries(rawNames)) {
    if (LEGACY_IDS.has(id)) continue
    categoryNames[remapId(id)] = value
  }

  return {
    migrated: true,
    value: {
      ...input,
      categoryTaxonomyVersion: CATEGORY_TAXONOMY_VERSION,
      categoryOrder,
      hiddenCategoryIds: [...hidden],
      categorySources,
      categoryNames,
      customCategories,
    },
  }
}

export function legacyBuiltinPresetName(id: string): string | undefined {
  return LEGACY_BUILTIN_PRESET_NAMES[id]
}
