import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './routes/__root'
import { HomePage } from './routes/index'
import { DocPage } from './routes/docs.$docPath'
import { CoveragePage } from './routes/coverage'
import { SettingsPage } from './routes/settings'

// Create routes using createRoute with proper parent setup
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

const docsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/docs/$docPath',
  component: DocPage,
})

const coverageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/coverage',
  component: CoveragePage,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
})

// Build the route tree
export const routeTree = rootRoute.addChildren([
  indexRoute,
  docsRoute,
  coverageRoute,
  settingsRoute,
])
