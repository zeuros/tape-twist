import type { Platform } from '#shared/types/music'

export const PLATFORMS: Platform[] = ['soundcloud', 'deezer']
export const PLATFORM_LABEL: Record<Platform, string> = { soundcloud: 'SoundCloud', deezer: 'Deezer' }
export const PLATFORM_SHORT: Record<Platform, string> = { soundcloud: 'SC', deezer: 'DZ' }
