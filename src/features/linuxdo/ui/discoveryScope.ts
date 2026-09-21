import type { LinuxDoCategory, LinuxDoTopicSummary } from '../types'

export type LinuxDoDiscoveryScope =
  | { kind: 'category'; category: LinuxDoCategory }
  | { kind: 'tag'; name: string }

interface DiscoveryScopeApi {
  category: (slug: string, id: number) => Promise<LinuxDoTopicSummary[]>
  tag: (name: string) => Promise<LinuxDoTopicSummary[]>
}

export function discoveryScopeKey(scope: LinuxDoDiscoveryScope): string {
  return scope.kind === 'category' ? 'category:' + scope.category.id : 'tag:' + scope.name
}

export function loadDiscoveryScope(
  api: DiscoveryScopeApi,
  scope: LinuxDoDiscoveryScope,
): Promise<LinuxDoTopicSummary[]> {
  return scope.kind === 'category'
    ? api.category(scope.category.slug, scope.category.id)
    : api.tag(scope.name)
}
