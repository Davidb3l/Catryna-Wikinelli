import { createSchema } from 'graphql-yoga'
import { DateTimeResolver, JSONResolver } from 'graphql-scalars'
import { docsResolvers } from './resolvers/docs'
import { searchResolvers } from './resolvers/search'
import { versionsResolvers } from './resolvers/versions'

const typeDefs = /* GraphQL */ `
  scalar DateTime
  scalar JSON

  enum BlockType {
    TEXT
    HEADING
    CODE
    CODE_EMBED
    MERMAID
    REACT_FLOW
    WHITEBOARD
    TABLE
    CALLOUT
    DIVIDER
  }

  enum CalloutVariant {
    INFO
    WARNING
    ERROR
    SUCCESS
    NOTE
  }

  type Block {
    id: ID!
    type: BlockType!
    data: JSON!
  }

  type DocMetadata {
    createdAt: DateTime!
    updatedAt: DateTime!
    createdBy: String!
    tags: [String!]!
    relatedFiles: [String!]!
  }

  type Doc {
    id: ID!
    path: String!
    title: String!
    blocks: [Block!]!
    metadata: DocMetadata!
    versions: [DocVersion!]!
    currentVersion: DocVersion
  }

  type DocSummary {
    id: ID!
    path: String!
    title: String!
    updatedAt: DateTime!
    tags: [String!]!
  }

  type DocVersion {
    id: ID!
    docId: ID!
    contentHash: String!
    createdAt: DateTime!
    createdBy: String
    commitSha: String
    summary: String
  }

  type Highlight {
    field: String!
    snippet: String!
  }

  type SearchResult {
    doc: DocSummary!
    score: Float!
    highlights: [Highlight!]!
  }

  type SearchResults {
    results: [SearchResult!]!
    totalCount: Int!
    facets: SearchFacets
  }

  type SearchFacets {
    docTypes: [FacetItem!]
    modules: [FacetItem!]
  }

  type FacetItem {
    value: String!
    count: Int!
  }

  type ModuleInfo {
    filePath: String!
    name: String!
    exports: [String!]!
    lastModified: DateTime!
    hasDocumentation: Boolean!
  }

  type CoverageReport {
    totalModules: Int!
    documentedModules: Int!
    coveragePercent: Float!
    undocumentedFiles: [String!]!
    recentlyUpdated: [DocSummary!]!
    staleDocuments: [DocSummary!]!
  }

  type RegenerationEvent {
    filePath: String!
    status: String!
    docPath: String
    timestamp: DateTime!
  }

  input DocFilter {
    tag: String
    search: String
    path: String
    createdBy: String
  }

  input SearchFilters {
    docTypes: [String!]
    module: String
  }

  input CreateDocInput {
    path: String!
    title: String!
    blocks: [BlockInput!]!
    tags: [String!]
    relatedFiles: [String!]
  }

  input BlockInput {
    type: BlockType!
    data: JSON!
  }

  input UpdateDocInput {
    title: String
    blocks: [BlockInput!]
    tags: [String!]
    relatedFiles: [String!]
  }

  type Query {
    doc(path: String!): Doc
    docs(filter: DocFilter): [DocSummary!]!
    search(query: String!, filters: SearchFilters, limit: Int): SearchResults!
    undocumentedModules: [ModuleInfo!]!
    docCoverage: CoverageReport!
    docVersion(id: ID!): DocVersion
    docVersions(docPath: String!): [DocVersion!]!
  }

  type Mutation {
    createDoc(input: CreateDocInput!): Doc!
    updateDoc(path: String!, input: UpdateDocInput!): Doc!
    deleteDoc(path: String!): Boolean!
    revertToVersion(docPath: String!, versionId: ID!): Doc!
  }

  type Subscription {
    docChanged(path: String): Doc!
    regenerationStatus: RegenerationEvent!
  }
`

export const schema = createSchema({
  typeDefs,
  resolvers: {
    DateTime: DateTimeResolver,
    JSON: JSONResolver,
    Query: {
      ...docsResolvers.Query,
      ...searchResolvers.Query,
      ...versionsResolvers.Query,
    },
    Mutation: {
      ...docsResolvers.Mutation,
      ...versionsResolvers.Mutation,
    },
    Doc: docsResolvers.Doc,
  },
})
