import { searchCatalogs } from '../utils/platforms'

/** Host-side search of the whole SoundCloud and Deezer catalogs. */
export default defineEventHandler((event) => searchCatalogs(String(getQuery(event).q ?? '').slice(0, 100), 40))
