import { GraphQLClient } from 'graphql-request'

const endpoint = '/graphql'

export const graphqlClient = new GraphQLClient(endpoint, {
  credentials: 'include',
})

// GraphQL queries and mutations
export const queries = {
  GET_DOC: /* GraphQL */ `
    query GetDoc($path: String!) {
      doc(path: $path) {
        id
        path
        title
        blocks {
          id
          type
          data
        }
        metadata {
          createdAt
          updatedAt
          createdBy
          tags
          relatedFiles
        }
        versions {
          id
          contentHash
          createdAt
          createdBy
          summary
        }
      }
    }
  `,

  LIST_DOCS: /* GraphQL */ `
    query ListDocs($filter: DocFilter) {
      docs(filter: $filter) {
        id
        path
        title
        updatedAt
        tags
      }
    }
  `,

  SEARCH_DOCS: /* GraphQL */ `
    query SearchDocs($query: String!, $filters: SearchFilters, $limit: Int) {
      search(query: $query, filters: $filters, limit: $limit) {
        results {
          doc {
            id
            path
            title
            updatedAt
            tags
          }
          score
          highlights {
            field
            snippet
          }
        }
        totalCount
      }
    }
  `,

  GET_DOC_VERSIONS: /* GraphQL */ `
    query GetDocVersions($docPath: String!) {
      docVersions(docPath: $docPath) {
        id
        docId
        contentHash
        createdAt
        createdBy
        commitSha
        summary
      }
    }
  `,

  GET_COVERAGE: /* GraphQL */ `
    query GetCoverage {
      docCoverage {
        totalModules
        documentedModules
        coveragePercent
        undocumentedFiles
        recentlyUpdated {
          id
          path
          title
          updatedAt
        }
        staleDocuments {
          id
          path
          title
          updatedAt
        }
      }
    }
  `,

  GET_UNDOCUMENTED: /* GraphQL */ `
    query GetUndocumented {
      undocumentedModules {
        filePath
        name
        lastModified
        hasDocumentation
      }
    }
  `,
}

export const mutations = {
  CREATE_DOC: /* GraphQL */ `
    mutation CreateDoc($input: CreateDocInput!) {
      createDoc(input: $input) {
        id
        path
        title
      }
    }
  `,

  UPDATE_DOC: /* GraphQL */ `
    mutation UpdateDoc($path: String!, $input: UpdateDocInput!) {
      updateDoc(path: $path, input: $input) {
        id
        path
        title
        blocks {
          id
          type
          data
        }
      }
    }
  `,

  DELETE_DOC: /* GraphQL */ `
    mutation DeleteDoc($path: String!) {
      deleteDoc(path: $path)
    }
  `,

  REVERT_TO_VERSION: /* GraphQL */ `
    mutation RevertToVersion($docPath: String!, $versionId: ID!) {
      revertToVersion(docPath: $docPath, versionId: $versionId) {
        id
        path
        title
        blocks {
          id
          type
          data
        }
      }
    }
  `,
}
