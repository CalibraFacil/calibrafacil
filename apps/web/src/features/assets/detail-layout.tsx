import { Outlet } from '@tanstack/react-router'

/**
 * Layout for the asset view + edit routes. Wayfinding ("back to Ativos", the
 * asset name, "Editar") is provided by the persistent dashboard breadcrumb, so
 * this layout stays a thin passthrough — each child page owns its own chrome.
 */
export function AssetDetailLayout() {
  return <Outlet />
}
