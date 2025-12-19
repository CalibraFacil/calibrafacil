import { hc } from 'hono/client'
import type { AppType } from '@calibra-facil/api'

const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export const api = hc<AppType>(baseUrl)
