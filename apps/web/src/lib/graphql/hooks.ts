import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { graphqlClient, queries, mutations } from './client'

// Hooks for docs
export function useDoc(path: string | null) {
  return useQuery({
    queryKey: ['doc', path],
    queryFn: async () => {
      if (!path) return null
      const data = await graphqlClient.request<{ doc: any }>(queries.GET_DOC, { path })
      return data.doc
    },
    enabled: !!path,
  })
}

export function useDocs(filter?: { tag?: string; path?: string }) {
  return useQuery({
    queryKey: ['docs', filter],
    queryFn: async () => {
      const data = await graphqlClient.request<{ docs: any[] }>(queries.LIST_DOCS, { filter })
      return data.docs
    },
  })
}

export function useSearchDocs(query: string, options?: { filters?: any; limit?: number }) {
  return useQuery({
    queryKey: ['search', query, options],
    queryFn: async () => {
      if (!query.trim()) return { results: [], totalCount: 0 }
      const data = await graphqlClient.request<{ search: any }>(queries.SEARCH_DOCS, {
        query,
        filters: options?.filters,
        limit: options?.limit || 20,
      })
      return data.search
    },
    enabled: query.length > 0,
  })
}

export function useDocVersions(docPath: string | null) {
  return useQuery({
    queryKey: ['docVersions', docPath],
    queryFn: async () => {
      if (!docPath) return []
      const data = await graphqlClient.request<{ docVersions: any[] }>(queries.GET_DOC_VERSIONS, {
        docPath,
      })
      return data.docVersions
    },
    enabled: !!docPath,
  })
}

export function useCoverage() {
  return useQuery({
    queryKey: ['coverage'],
    queryFn: async () => {
      const data = await graphqlClient.request<{ docCoverage: any }>(queries.GET_COVERAGE)
      return data.docCoverage
    },
  })
}

export function useUndocumentedModules() {
  return useQuery({
    queryKey: ['undocumented'],
    queryFn: async () => {
      const data = await graphqlClient.request<{ undocumentedModules: any[] }>(
        queries.GET_UNDOCUMENTED
      )
      return data.undocumentedModules
    },
  })
}

// Mutations
export function useCreateDoc() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      path: string
      title: string
      blocks: Array<{ type: string; data: any }>
      tags?: string[]
      relatedFiles?: string[]
    }) => {
      const data = await graphqlClient.request<{ createDoc: any }>(mutations.CREATE_DOC, { input })
      return data.createDoc
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docs'] })
    },
  })
}

export function useUpdateDoc() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      path,
      input,
    }: {
      path: string
      input: {
        title?: string
        blocks?: Array<{ type: string; data: any }>
        tags?: string[]
        relatedFiles?: string[]
      }
    }) => {
      const data = await graphqlClient.request<{ updateDoc: any }>(mutations.UPDATE_DOC, {
        path,
        input,
      })
      return data.updateDoc
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['doc', variables.path] })
      queryClient.invalidateQueries({ queryKey: ['docs'] })
    },
  })
}

export function useDeleteDoc() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (path: string) => {
      const data = await graphqlClient.request<{ deleteDoc: boolean }>(mutations.DELETE_DOC, {
        path,
      })
      return data.deleteDoc
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docs'] })
    },
  })
}

export function useRevertToVersion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ docPath, versionId }: { docPath: string; versionId: string }) => {
      const data = await graphqlClient.request<{ revertToVersion: any }>(mutations.REVERT_TO_VERSION, {
        docPath,
        versionId,
      })
      return data.revertToVersion
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['doc', variables.docPath] })
      queryClient.invalidateQueries({ queryKey: ['docVersions', variables.docPath] })
    },
  })
}
